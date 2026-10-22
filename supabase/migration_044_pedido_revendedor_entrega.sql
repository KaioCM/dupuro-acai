-- migration_044: pedido do revendedor com entrega/retirada, dia, turno e pagamento.
--
-- Decisões do Kayo (2026-10-22):
--   * o revendedor escolhe ENTREGA ou RETIRADA na fábrica, o DIA e o TURNO;
--   * turnos iguais aos do delivery: manhã (pedir até 7h) e tarde (pedir até 11h),
--     segunda a sábado, no fuso de Cuiabá;
--   * pagamento na entrega/retirada (dinheiro, Pix ou cartão); "a prazo" SÓ para
--     revendedor liberado pelo admin (profiles.pode_prazo, travado no trigger).
-- Tudo validado aqui no banco: o navegador só sugere.

alter table public.profiles add column if not exists pode_prazo boolean not null default false;
alter table public.profiles add column if not exists endereco text;
do $$ begin
  alter table public.profiles add constraint profiles_endereco_sem_html
    check (endereco is null or (length(endereco) <= 200 and endereco !~ '[<>]'));
exception when duplicate_object then null; end $$;

-- pode_prazo entra na lista do que só admin muda (o resto da regra não muda).
create or replace function public.profiles_protege_controle()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.created_at is distinct from old.created_at
     or new.conta_teste is distinct from old.conta_teste
     or new.email is distinct from old.email
     or new.pode_prazo is distinct from old.pode_prazo then
    raise exception 'Só um administrador pode mudar acesso, aprovação, e-mail ou pagamento a prazo' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Turno ainda aberto pra pedir? (mesma regra do delivery: manhã até 7h, tarde até 11h)
create or replace function public.turno_aberto(p_data date, p_turno text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select p_turno in ('manha', 'tarde')
     and extract(isodow from p_data) between 1 and 6
     and p_data <= (now() at time zone 'America/Cuiaba')::date + 14
     and (
       p_data > (now() at time zone 'America/Cuiaba')::date
       or (p_data = (now() at time zone 'America/Cuiaba')::date
           and (now() at time zone 'America/Cuiaba')::time < case p_turno when 'manha' then time '07:00' else time '11:00' end)
     );
$$;

drop function if exists public.criar_pedido_revendedor(jsonb);

-- p_entrega = { tipo: 'entrega'|'retirada', data: 'AAAA-MM-DD', turno: 'manha'|'tarde',
--               pagamento: 'na_entrega'|'a_prazo', forma: 'dinheiro'|'pix'|'cartao'|null,
--               endereco: text (obrigatório na entrega), observacao: text|null }
create or replace function public.criar_pedido_revendedor(p_rows jsonb, p_entrega jsonb default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_numero text;
  v_volume numeric;
  v_dispensa boolean;
  v_falta record;
  r jsonb;
  v_prod record;
  v_qtd int;
  v_sabor text;
  v_tipo text;
  v_data date;
  v_turno text;
  v_pag text;
  v_forma text;
  v_end text;
  v_obs text;
  v_prazo boolean;
  v_info jsonb;
begin
  if v_uid is null then
    raise exception 'Sem sessão ativa.';
  end if;
  select pode_prazo into v_prazo from public.profiles
   where id = v_uid and status = 'aprovado' and role = 'revendedor';
  if not found then
    raise exception 'Cadastro não aprovado para fazer pedidos.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;

  -- Entrega / retirada. Sem p_entrega (painel antigo ainda aberto em algum
  -- celular) o pedido segue como antes, sem esses dados; o painel novo sempre manda.
  if p_entrega is not null then
  if jsonb_typeof(p_entrega) <> 'object' then
    raise exception 'Escolha entrega ou retirada, o dia e o turno.';
  end if;
  v_tipo  := p_entrega->>'tipo';
  v_turno := p_entrega->>'turno';
  v_pag   := coalesce(nullif(p_entrega->>'pagamento', ''), 'na_entrega');
  v_forma := nullif(p_entrega->>'forma', '');
  v_end   := nullif(trim(coalesce(p_entrega->>'endereco', '')), '');
  v_obs   := nullif(trim(coalesce(p_entrega->>'observacao', '')), '');
  begin
    v_data := (p_entrega->>'data')::date;
  exception when others then
    raise exception 'Data de entrega inválida.';
  end;
  if coalesce(v_tipo, '') not in ('entrega', 'retirada') then
    raise exception 'Escolha entrega ou retirada.';
  end if;
  if v_data is null or not coalesce(public.turno_aberto(v_data, v_turno), false) then
    raise exception 'Esse dia/turno não está mais disponível. Escolha outro.';
  end if;
  if v_pag not in ('na_entrega', 'a_prazo') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if v_pag = 'a_prazo' and not v_prazo then
    raise exception 'Pagamento a prazo não está liberado para a sua conta.';
  end if;
  if v_forma is not null and v_forma not in ('dinheiro', 'pix', 'cartao') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if v_tipo = 'entrega' and v_end is null then
    raise exception 'Informe o endereço de entrega.';
  end if;
  if length(coalesce(v_end, '')) > 200 or length(coalesce(v_obs, '')) > 300
     or coalesce(v_end, '') ~ '[<>]' or coalesce(v_obs, '') ~ '[<>]' then
    raise exception 'Endereço ou observação inválidos.';
  end if;
  v_info := jsonb_strip_nulls(jsonb_build_object(
    'tipo', v_tipo, 'data', v_data, 'turno', v_turno, 'pagamento', v_pag,
    'forma', v_forma, 'endereco', case when v_tipo = 'entrega' then v_end end, 'observacao', v_obs));
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    left join public.products p on p.id = (e->>'produto_id')::bigint
    where p.id is null
       or (e->>'quantidade')::int < 1
       or (e->>'quantidade')::int > 99
  ) then
    raise exception 'Item inválido no pedido.';
  end if;

  v_volume := public.volume_do_pedido(p_rows);
  v_dispensa := v_volume >= public.litros_dispensa_minimo();

  if not v_dispensa then
    select p.nome, p.pedido_minimo into v_falta
    from jsonb_array_elements(p_rows) e
    join public.products p on p.id = (e->>'produto_id')::bigint
    where (e->>'quantidade')::int < coalesce(p.pedido_minimo, 1)
    limit 1;
    if found then
      raise exception 'Pedido mínimo de % é % unidades.', v_falta.nome, v_falta.pedido_minimo;
    end if;
  end if;

  v_numero := public.next_pedido_numero();

  for r in select * from jsonb_array_elements(p_rows) loop
    select id, nome, preco into v_prod from public.products where id = (r->>'produto_id')::bigint;
    v_qtd := (r->>'quantidade')::int;
    v_sabor := nullif(r->>'sabor', '');
    -- Valor e descrição saem do catálogo, nunca do navegador.
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, origem, entrega, entrega_info
    ) values (
      v_uid, v_numero,
      (now() at time zone 'America/Cuiaba')::date,
      v_prod.nome || coalesce(' - ' || v_sabor, '') || ' x' || v_qtd,
      v_prod.preco * v_qtd, 'enviado',
      v_prod.id, v_qtd, v_sabor, true, 'revendedor', coalesce(v_tipo = 'entrega', false), v_info
    );
  end loop;

  return v_numero;
end;
$$;
revoke execute on function public.criar_pedido_revendedor(jsonb, jsonb) from public, anon;
grant execute on function public.criar_pedido_revendedor(jsonb, jsonb) to authenticated;
revoke execute on function public.turno_aberto(date, text) from public, anon;
grant execute on function public.turno_aberto(date, text) to authenticated;
