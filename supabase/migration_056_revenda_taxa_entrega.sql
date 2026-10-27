-- migration_056 — Taxa de entrega no pedido do revendedor (pedido do Kayo, 2026-10-27)
-- Antes o revendedor recebia em qualquer distância sem pagar entrega (PED-1035, 19,6 km).
-- Decisão do Kayo: mesma regra do delivery (delivery_config.taxa: base até km_base +
-- por_km, arredonda em R$0,50) e o mesmo limite (max_km, 20 km); mais longe = só Retirada.
-- · entrega_cotacoes: cada cotação que a Edge Function delivery-cotacao calcula (km, taxa,
--   ponto). Só service_role escreve/lê; o pedido referencia pelo id (vale 2h).
-- · criar_pedido_revendedor_para: entrega exige cotacao_id válido; taxa e ponto saem da
--   cotação (o lat/lng do navegador deixa de valer); grava uma linha 'Taxa de entrega' no
--   pedido (sem produto, usa_estoque = false). Base: a versão da 055.

create table if not exists public.entrega_cotacoes (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lng double precision not null,
  km numeric(6,1) not null,
  taxa numeric(10,2) not null check (taxa >= 0),
  impreciso boolean not null default false,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '2 hours'
);
alter table public.entrega_cotacoes enable row level security;
revoke all on public.entrega_cotacoes from anon, authenticated;
create index if not exists entrega_cotacoes_criado_idx on public.entrega_cotacoes (criado_em);

create or replace function public.criar_pedido_revendedor_para(p_uid uuid, p_rows jsonb, p_entrega jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_numero text; v_volume numeric; v_dispensa boolean; v_falta record; r jsonb; v_prod record;
  v_qtd int; v_sabor text; v_tipo text; v_data date; v_turno text; v_pag text; v_forma text;
  v_end text; v_obs text; v_prazo boolean; v_info jsonb; v_cupom_code text; v_cupom record;
  v_pct int := 0; v_troco numeric; v_total numeric := 0; v_lat double precision; v_lng double precision;
  v_cot public.entrega_cotacoes; v_cot_id uuid; v_taxa numeric := 0;
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
  -- Entrega: taxa e ponto vêm da cotação gravada pela Edge Function delivery-cotacao
  -- (mesma regra do delivery, até max_km). O navegador só manda o id da cotação.
  -- Pagamento online aprovado (mp_payment_id) pode confirmar com a cotação já vencida.
  if v_tipo = 'entrega' then
    begin v_cot_id := nullif(p_entrega->>'cotacao_id', '')::uuid; exception when others then v_cot_id := null; end;
    select * into v_cot from public.entrega_cotacoes where id = v_cot_id
       and (expira_em > now() or nullif(p_entrega->>'mp_payment_id', '') is not null);
    if not found then raise exception 'Calcule a taxa de entrega de novo: atualize a página e confira o endereço.'; end if;
    v_taxa := v_cot.taxa; v_lat := v_cot.lat; v_lng := v_cot.lng;
  end if;
  if coalesce(v_tipo, '') not in ('entrega', 'retirada') then raise exception 'Escolha entrega ou retirada.'; end if;
  if v_data is null or not coalesce(public.turno_aberto(v_data, v_turno), false) then raise exception 'Esse dia/turno não está mais disponível. Escolha outro.'; end if;
  if v_pag not in ('na_entrega', 'a_prazo', 'online') then raise exception 'Forma de pagamento inválida.'; end if;
  if v_pag = 'a_prazo' and not v_prazo then raise exception 'Pagamento a prazo não está liberado para a sua conta.'; end if;
  if v_pag <> 'na_entrega' then v_forma := null; v_troco := null; end if;
  if v_forma is not null and v_forma not in ('dinheiro', 'pix', 'cartao', 'debito', 'credito') then raise exception 'Forma de pagamento inválida.'; end if;
  if v_forma is distinct from 'dinheiro' then v_troco := null; end if;
  if v_tipo = 'entrega' and nullif(p_entrega->>'mp_payment_id', '') is null and public.turno_lotado(v_data, v_turno) then raise exception 'Esse turno de entrega lotou. Escolha outro dia ou turno (ou retire na fábrica).'; end if;
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

  select coalesce(sum(round(p.preco * (e->>'quantidade')::int * (100 - v_pct) / 100.0, 2)), 0) into v_total
    from jsonb_array_elements(p_rows) e join public.products p on p.id = (e->>'produto_id')::bigint;
  v_total := v_total + v_taxa;
  if v_troco is not null and v_troco < v_total then raise exception 'O troco precisa ser pra um valor maior que o total.'; end if;

  v_info := jsonb_strip_nulls(jsonb_build_object(
    'tipo', v_tipo, 'data', v_data, 'turno', v_turno, 'pagamento', v_pag,
    'forma', v_forma, 'troco_para', v_troco, 'endereco', case when v_tipo = 'entrega' then v_end end, 'observacao', v_obs,
    'lat', v_lat, 'lng', v_lng, 'taxa_entrega', case when v_tipo = 'entrega' then v_taxa end, 'km', case when v_tipo = 'entrega' then v_cot.km end,
    'cupom', v_cupom_code, 'desconto_percent', nullif(v_pct, 0),
    'mp_payment_id', nullif(p_entrega->>'mp_payment_id', ''), 'pago_metodo', nullif(p_entrega->>'pago_metodo', '')));

  v_numero := public.next_pedido_numero();
  for r in select * from jsonb_array_elements(p_rows) loop
    select id, nome, preco into v_prod from public.products where id = (r->>'produto_id')::bigint;
    v_qtd := (r->>'quantidade')::int;
    v_sabor := nullif(r->>'sabor', '');
    insert into public.orders (revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor,
                               usa_estoque, origem, entrega, entrega_info, cupom_code)
    values (p_uid, v_numero, (now() at time zone 'America/Cuiaba')::date,
            v_prod.nome || coalesce(' - ' || v_sabor, '') || ' x' || v_qtd,
            round(v_prod.preco * v_qtd * (100 - v_pct) / 100.0, 2), 'processando',
            v_prod.id, v_qtd, v_sabor, true, 'revendedor', v_tipo = 'entrega', v_info, v_cupom_code);
  end loop;
  -- Taxa de entrega: uma linha do pedido sem produto e sem estoque, pra entrar em todo total
  -- (painel, admin, rota, pagamento online). Cupom não desconta a taxa.
  if v_tipo = 'entrega' and v_taxa > 0 then
    insert into public.orders (revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor,
                               usa_estoque, origem, entrega, entrega_info, cupom_code)
    values (p_uid, v_numero, (now() at time zone 'America/Cuiaba')::date,
            'Taxa de entrega (' || replace(trim(to_char(v_cot.km, 'FM990.0')), '.', ',') || ' km)', v_taxa, 'processando',
            null, 1, null, false, 'revendedor', true, v_info, v_cupom_code);
  end if;
  if v_cupom_code is not null then update public.coupons set usado = true where id = v_cupom.id; end if;
  return v_numero;
end $$;
revoke execute on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) from public, anon, authenticated;
