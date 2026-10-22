-- migration_045: cupom aplicado no pedido do revendedor + nomes das caixas de 10 L.
--
-- Decisões do Kayo (2026-10-22):
--   * o revendedor escolhe o cupom na revisão do pedido; o BANCO confere se o cupom
--     é dele, não foi usado e está na validade, aplica o desconto_percent em cada
--     linha e marca o cupom como usado;
--   * se o pedido for cancelado, o cupom volta (e é gasto de novo se o admin reabrir);
--   * tirar "Sem pedido mínimo :)" do nome das duas caixas de 10 L (existe mínimo
--     por produto; o texto confundia).

update public.products set nome = 'Caixa de Cremes 10 Litros' where id = 4 and nome = 'Caixa de Cremes 10 Litros - Sem pedido mínimo :)';
update public.products set nome = 'Caixa de Açaí 10 Litros'   where id = 16 and nome = 'Caixa de Açaí 10 Litros - Sem pedido mínimo :)';

alter table public.orders add column if not exists cupom_code text;

-- p_entrega ganha a chave opcional "cupom" (código). Resto igual à migration_044.
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
  v_cupom_code text;
  v_cupom record;
  v_pct int := 0;
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
  v_cupom_code := nullif(trim(coalesce(p_entrega->>'cupom', '')), '');
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

  -- Cupom: só o do próprio revendedor, não usado e na validade. Trava a linha
  -- pra dois pedidos ao mesmo tempo não gastarem o mesmo cupom.
  if v_cupom_code is not null then
    select id, code, desconto_percent into v_cupom from public.coupons
     where code = v_cupom_code and revendedor_id = v_uid and not usado
       and (validade is null or validade >= (now() at time zone 'America/Cuiaba')::date)
     for update;
    if not found or coalesce(v_cupom.desconto_percent, 0) not between 1 and 100 then
      raise exception 'Cupom inválido, vencido ou já usado.';
    end if;
    v_pct := v_cupom.desconto_percent;
  end if;

  v_info := jsonb_strip_nulls(jsonb_build_object(
    'tipo', v_tipo, 'data', v_data, 'turno', v_turno, 'pagamento', v_pag,
    'forma', v_forma, 'endereco', case when v_tipo = 'entrega' then v_end end, 'observacao', v_obs,
    'cupom', v_cupom_code, 'desconto_percent', nullif(v_pct, 0)));
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
    -- Valor e descrição saem do catálogo, nunca do navegador; o desconto do cupom
    -- entra em cada linha (o total do pedido = soma das linhas, como sempre).
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, origem, entrega, entrega_info, cupom_code
    ) values (
      v_uid, v_numero,
      (now() at time zone 'America/Cuiaba')::date,
      v_prod.nome || coalesce(' - ' || v_sabor, '') || ' x' || v_qtd,
      round(v_prod.preco * v_qtd * (100 - v_pct) / 100.0, 2), 'enviado',
      v_prod.id, v_qtd, v_sabor, true, 'revendedor', coalesce(v_tipo = 'entrega', false), v_info, v_cupom_code
    );
  end loop;

  if v_cupom_code is not null then
    update public.coupons set usado = true where id = v_cupom.id;
  end if;

  return v_numero;
end;
$$;
revoke execute on function public.criar_pedido_revendedor(jsonb, jsonb) from public, anon;
grant execute on function public.criar_pedido_revendedor(jsonb, jsonb) to authenticated;

-- Pedido cancelado devolve o cupom; reaberto, gasta de novo.
create or replace function public.orders_cupom_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.cupom_code is null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'cancelado' then
    update public.coupons set usado = false where code = new.cupom_code and revendedor_id is not distinct from new.revendedor_id;
  elsif old.status = 'cancelado' then
    update public.coupons set usado = true where code = new.cupom_code and revendedor_id is not distinct from new.revendedor_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_cupom_status() from public, anon, authenticated;
drop trigger if exists orders_cupom_status on public.orders;
create trigger orders_cupom_status after update of status on public.orders
  for each row execute function public.orders_cupom_status();
