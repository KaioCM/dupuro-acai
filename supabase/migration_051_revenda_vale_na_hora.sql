-- migration_051 — Pedido do revendedor vale na hora + pagamento online (2026-10-24)
--
-- Decisão do Kayo: o pedido do revendedor não precisa mais da confirmação do
-- admin — funciona igual ao delivery:
--   · pagar na entrega/retirada (dinheiro com troco, Pix, débito, crédito) ou a
--     prazo (só liberados): o pedido nasce CONFIRMADO ('processando') e o
--     estoque baixa na hora (o trigger de estoque já faz isso);
--   · pagar agora pelo site (Pix ou crédito, Payment Brick do Mercado Pago):
--     o carrinho fica num `revenda_checkouts` (não reserva estoque, como o
--     delivery) e o pedido só é criado quando o pagamento é aprovado.
-- A validação (preço do banco, estoque, pedido mínimo, cupom, dia/turno) é uma
-- só: criar_pedido_revendedor_para(). O checkout online "simula" o pedido nela
-- e desfaz (subtransação), pra validar tudo e saber o total sem duplicar regra.

create or replace function public.criar_pedido_revendedor_para(p_uid uuid, p_rows jsonb, p_entrega jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_numero text; v_volume numeric; v_dispensa boolean; v_falta record; r jsonb; v_prod record;
  v_qtd int; v_sabor text; v_tipo text; v_data date; v_turno text; v_pag text; v_forma text;
  v_end text; v_obs text; v_prazo boolean; v_info jsonb; v_cupom_code text; v_cupom record;
  v_pct int := 0; v_troco numeric; v_total numeric := 0;
begin
  if p_uid is null then raise exception 'Sem sessão ativa.'; end if;
  select pode_prazo into v_prazo from public.profiles where id = p_uid and status = 'aprovado' and role = 'revendedor';
  if not found then raise exception 'Cadastro não aprovado para fazer pedidos.'; end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then raise exception 'O pedido precisa ter ao menos um item.'; end if;
  if p_entrega is null or jsonb_typeof(p_entrega) <> 'object' then raise exception 'Escolha entrega ou retirada, o dia e o turno.'; end if;

  v_tipo  := p_entrega->>'tipo';
  v_turno := p_entrega->>'turno';
  v_pag   := coalesce(nullif(p_entrega->>'pagamento', ''), 'na_entrega');
  v_forma := nullif(p_entrega->>'forma', '');
  v_end   := nullif(trim(coalesce(p_entrega->>'endereco', '')), '');
  v_obs   := nullif(trim(coalesce(p_entrega->>'observacao', '')), '');
  v_cupom_code := nullif(trim(coalesce(p_entrega->>'cupom', '')), '');
  begin v_troco := nullif(p_entrega->>'troco_para', '')::numeric; exception when others then raise exception 'Valor do troco inválido.'; end;
  begin v_data := (p_entrega->>'data')::date; exception when others then raise exception 'Data de entrega inválida.'; end;
  if coalesce(v_tipo, '') not in ('entrega', 'retirada') then raise exception 'Escolha entrega ou retirada.'; end if;
  if v_data is null or not coalesce(public.turno_aberto(v_data, v_turno), false) then raise exception 'Esse dia/turno não está mais disponível. Escolha outro.'; end if;
  if v_pag not in ('na_entrega', 'a_prazo', 'online') then raise exception 'Forma de pagamento inválida.'; end if;
  if v_pag = 'a_prazo' and not v_prazo then raise exception 'Pagamento a prazo não está liberado para a sua conta.'; end if;
  if v_pag <> 'na_entrega' then v_forma := null; v_troco := null; end if;
  if v_forma is not null and v_forma not in ('dinheiro', 'pix', 'cartao', 'debito', 'credito') then raise exception 'Forma de pagamento inválida.'; end if;
  if v_forma is distinct from 'dinheiro' then v_troco := null; end if;
  if v_tipo = 'entrega' and v_end is null then raise exception 'Informe o endereço de entrega.'; end if;
  if length(coalesce(v_end, '')) > 200 or length(coalesce(v_obs, '')) > 300 or coalesce(v_end, '') ~ '[<>]' or coalesce(v_obs, '') ~ '[<>]' then
    raise exception 'Endereço ou observação inválidos.';
  end if;

  if v_cupom_code is not null then
    select id, code, desconto_percent into v_cupom from public.coupons
     where code = v_cupom_code and revendedor_id = p_uid and not usado
       and (validade is null or validade >= (now() at time zone 'America/Cuiaba')::date)
     for update;
    if not found or coalesce(v_cupom.desconto_percent, 0) not between 1 and 100 then raise exception 'Cupom inválido, vencido ou já usado.'; end if;
    v_pct := v_cupom.desconto_percent;
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) e left join public.products p on p.id = (e->>'produto_id')::bigint
              where p.id is null or (e->>'quantidade')::int < 1 or (e->>'quantidade')::int > 99) then
    raise exception 'Item inválido no pedido.';
  end if;
  v_volume := public.volume_do_pedido(p_rows);
  v_dispensa := v_volume >= public.litros_dispensa_minimo();
  if not v_dispensa then
    select p.nome, p.pedido_minimo into v_falta from jsonb_array_elements(p_rows) e
      join public.products p on p.id = (e->>'produto_id')::bigint
     where (e->>'quantidade')::int < coalesce(p.pedido_minimo, 1) limit 1;
    if found then raise exception 'Pedido mínimo de % é % unidades.', v_falta.nome, v_falta.pedido_minimo; end if;
  end if;

  -- Total (mesma conta das linhas) pra conferir o troco.
  select coalesce(sum(round(p.preco * (e->>'quantidade')::int * (100 - v_pct) / 100.0, 2)), 0) into v_total
    from jsonb_array_elements(p_rows) e join public.products p on p.id = (e->>'produto_id')::bigint;
  if v_troco is not null and v_troco < v_total then raise exception 'O troco precisa ser pra um valor maior que o total.'; end if;

  v_info := jsonb_strip_nulls(jsonb_build_object(
    'tipo', v_tipo, 'data', v_data, 'turno', v_turno, 'pagamento', v_pag,
    'forma', v_forma, 'troco_para', v_troco, 'endereco', case when v_tipo = 'entrega' then v_end end, 'observacao', v_obs,
    'cupom', v_cupom_code, 'desconto_percent', nullif(v_pct, 0),
    'mp_payment_id', nullif(p_entrega->>'mp_payment_id', ''), 'pago_metodo', nullif(p_entrega->>'pago_metodo', '')));

  v_numero := public.next_pedido_numero();
  for r in select * from jsonb_array_elements(p_rows) loop
    select id, nome, preco into v_prod from public.products where id = (r->>'produto_id')::bigint;
    v_qtd := (r->>'quantidade')::int;
    v_sabor := nullif(r->>'sabor', '');
    -- 'processando' = confirmado: o trigger de estoque baixa na hora (e recusa se faltar).
    insert into public.orders (revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor,
                               usa_estoque, origem, entrega, entrega_info, cupom_code)
    values (p_uid, v_numero, (now() at time zone 'America/Cuiaba')::date,
            v_prod.nome || coalesce(' - ' || v_sabor, '') || ' x' || v_qtd,
            round(v_prod.preco * v_qtd * (100 - v_pct) / 100.0, 2), 'processando',
            v_prod.id, v_qtd, v_sabor, true, 'revendedor', v_tipo = 'entrega', v_info, v_cupom_code);
  end loop;
  if v_cupom_code is not null then update public.coupons set usado = true where id = v_cupom.id; end if;
  return v_numero;
end $$;
revoke execute on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) from public, anon, authenticated;

-- O que o painel chama (na entrega/retirada ou a prazo). Online vai pelo checkout.
create or replace function public.criar_pedido_revendedor(p_rows jsonb, p_entrega jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_entrega->>'pagamento', '') = 'online' then raise exception 'Pagamento online começa pelo botão Pagar agora.'; end if;
  return public.criar_pedido_revendedor_para(auth.uid(), p_rows, p_entrega);
end $$;

create table if not exists public.revenda_checkouts (
  id bigint generated always as identity primary key,
  token uuid not null unique default gen_random_uuid(),
  revendedor_id uuid not null references public.profiles(id) on delete cascade,
  rows jsonb not null,
  entrega jsonb not null,
  total numeric(10,2) not null,
  status text not null default 'aguardando' check (status in ('aguardando', 'pago', 'erro', 'expirado')),
  numero text,                          -- PED-XXXX criado quando o pagamento aprova
  mp_payment_id text,
  mp_status text,
  erro text,
  criado_em timestamptz not null default now(),
  pago_em timestamptz
);
alter table public.revenda_checkouts enable row level security;
create policy revenda_checkouts_dono on public.revenda_checkouts for select to authenticated
  using (revendedor_id = (select auth.uid()) or (select public.is_admin()));

-- Valida o carrinho (simula o pedido e desfaz) e guarda o checkout pra pagar online.
create or replace function public.revenda_iniciar_checkout(p_rows jsonb, p_entrega jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ent jsonb; v_num text; v_total numeric; v_tok uuid;
begin
  if v_uid is null then raise exception 'Sem sessão ativa.'; end if;
  v_ent := (coalesce(p_entrega, '{}'::jsonb) - 'forma' - 'troco_para' - 'mp_payment_id' - 'pago_metodo') || jsonb_build_object('pagamento', 'online');
  begin
    v_num := public.criar_pedido_revendedor_para(v_uid, p_rows, v_ent);
    select coalesce(sum(valor), 0) into v_total from public.orders where numero = v_num;
    raise exception using errcode = 'P0001', message = '__simulacao_ok__';
  exception when sqlstate 'P0001' then
    if sqlerrm <> '__simulacao_ok__' then raise; end if;
  end;
  update public.revenda_checkouts set status = 'expirado' where status = 'aguardando' and criado_em < now() - interval '3 hours';
  insert into public.revenda_checkouts (revendedor_id, rows, entrega, total) values (v_uid, p_rows, v_ent, v_total)
    returning token into v_tok;
  return jsonb_build_object('token', v_tok, 'total', v_total);
end $$;
grant execute on function public.revenda_iniciar_checkout(jsonb, jsonb) to authenticated;

-- Pagamento aprovado (só service_role: revenda-pagar e o webhook): cria o pedido.
-- Idempotente. Se algo mudou (estoque acabou, cupom usado) o pagamento fica
-- marcado 'erro' pro admin resolver (devolver ou combinar).
create or replace function public.revenda_confirmar_checkout(p_token uuid, p_payment_id text, p_metodo text, p_valor numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.revenda_checkouts%rowtype; v_num text; v_err text;
begin
  select * into c from public.revenda_checkouts where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if c.status = 'pago' then return jsonb_build_object('ok', true, 'numero', c.numero, 'ja_processado', true); end if;
  if coalesce(p_valor, 0) + 0.009 < c.total then
    update public.revenda_checkouts set mp_payment_id = p_payment_id, mp_status = 'valor_divergente', status = 'erro', erro = 'Valor pago menor que o total' where id = c.id;
    return jsonb_build_object('ok', false, 'erro', 'valor_divergente');
  end if;
  begin
    v_num := public.criar_pedido_revendedor_para(c.revendedor_id, c.rows,
      c.entrega || jsonb_build_object('mp_payment_id', p_payment_id, 'pago_metodo', p_metodo));
  exception when others then
    v_err := sqlerrm;
  end;
  if v_num is null then
    update public.revenda_checkouts set mp_payment_id = p_payment_id, mp_status = 'approved', status = 'erro', erro = v_err where id = c.id;
    return jsonb_build_object('ok', false, 'erro', v_err);
  end if;
  update public.revenda_checkouts set status = 'pago', numero = v_num, mp_payment_id = p_payment_id, mp_status = 'approved', pago_em = now() where id = c.id;
  return jsonb_build_object('ok', true, 'numero', v_num);
end $$;
revoke execute on function public.revenda_confirmar_checkout(uuid, text, text, numeric) from public, anon, authenticated;
