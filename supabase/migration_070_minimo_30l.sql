-- Migração 070 — pedido mínimo do revendedor: 30 L por pedido, primeiro pedido livre
--
-- REGRA NOVA (atacado / revendedor):
--   1. O pedido precisa somar no mínimo `litros_minimo_pedido()` litros (padrão 30 L, editável pelo admin
--      em app_settings.chave = 'litros_minimo_pedido'). Caixas de 5 L e 10 L somam; produtos com litros = 0
--      (granola/complementos) podem ir junto. Fora do primeiro pedido, pedido de 0 L (só granola/complementos)
--      é bloqueado; o PRIMEIRO pedido é totalmente livre, inclusive só com itens de 0 L (decisão do gestor).
--   2. products.pedido_minimo NÃO é mais cobrado no pedido do revendedor (a coluna continua existindo).
--   3. PRIMEIRO PEDIDO SEM MÍNIMO: revendedor sem nenhum pedido não cancelado em public.orders
--      (qualquer origem, inclusive lançado pelo admin) pode pedir qualquer quantidade.
--   4. Mercado Pago: o mínimo é checado ANTES de cobrar (revenda_iniciar_checkout simula o pedido com
--      criar_pedido_revendedor_para, sem mp_payment_id). Depois de pago, revenda_confirmar_checkout chama a
--      mesma função com pagamento = 'online' + mp_payment_id: nesse caso o mínimo NÃO é reaplicado
--      (nunca cobrar sem entregar, mesmo que o revendedor tenha deixado de ser "primeiro" no intervalo).
--      O navegador não consegue usar esse atalho: criar_pedido_revendedor (wrapper público) recusa
--      pagamento = 'online', e criar_pedido_revendedor_para só é executável por service_role.
--   5. `for update` no perfil do revendedor serializa pedidos simultâneos do mesmo revendedor
--      (evita dois "primeiros pedidos" em paralelo).
--   RESSALVAS CONHECIDAS: (a) dois revenda_iniciar_checkout simultâneos de um revendedor sem pedidos podem
--   passar na simulação e, se ambos forem pagos, saem sem mínimo (custo aceito de "nunca cobrar sem entregar");
--   (b) pedido lançado pelo admin, ou cancelado, muda o status de "primeiro pedido" (comportamento desejado).
--
-- Pré-requisito: migration_069_hotfix_cupom_tipo.sql já aplicada (v_cupom_tipo; esta função parte do corpo corrigido).
--
-- NÃO remove litros_dispensa_minimo() nem a chave 'litros_dispensa_minimo' (o front atual ainda chama;
-- sai numa limpeza futura).

-- 1) Configuração editável (mesma tabela/padrão de litros_dispensa_minimo)
insert into public.app_settings (chave, valor) values ('litros_minimo_pedido', 30)
on conflict (chave) do nothing;

create or replace function public.litros_minimo_pedido()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select valor from public.app_settings where chave = 'litros_minimo_pedido'), 30);
$$;
revoke all on function public.litros_minimo_pedido() from public, anon;
grant execute on function public.litros_minimo_pedido() to authenticated, service_role;

-- 2) Primeiro pedido: nenhum pedido não cancelado do revendedor (qualquer origem)
create or replace function public.revendedor_primeiro_pedido(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and not exists (select 1 from public.orders where revendedor_id = p_uid and status <> 'cancelado');
$$;
revoke all on function public.revendedor_primeiro_pedido(uuid) from public, anon, authenticated;
grant execute on function public.revendedor_primeiro_pedido(uuid) to service_role;

-- 3) Para o painel do revendedor mostrar o aviso "seu primeiro pedido não tem mínimo"
create or replace function public.sou_primeiro_pedido()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.revendedor_primeiro_pedido(auth.uid());
$$;
revoke all on function public.sou_primeiro_pedido() from public, anon;
grant execute on function public.sou_primeiro_pedido() to authenticated;

-- 4) Criação do pedido (parte do corpo corrigido pela 069_hotfix; mudanças: for update, v_min/v_pago, bloco do mínimo)
create or replace function public.criar_pedido_revendedor_para(p_uid uuid, p_rows jsonb, p_entrega jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_numero text; v_volume numeric; v_min numeric; v_pago boolean; r jsonb; v_prod record;
  v_qtd int; v_sabor text; v_tipo text; v_data date; v_turno text; v_pag text; v_forma text;
  v_end text; v_obs text; v_prazo boolean; v_info jsonb; v_cupom_code text; v_cupom record;
  v_pct int := 0; v_troco numeric; v_total numeric := 0; v_lat double precision; v_lng double precision;
  v_cot public.entrega_cotacoes; v_cot_id uuid; v_taxa numeric := 0; v_cupom_tipo text;
begin
  if p_uid is null then raise exception 'Sem sessão ativa.'; end if;
  select pode_prazo into v_prazo from public.profiles where id = p_uid and status = 'aprovado' and role = 'revendedor' for update;
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
    select id, code, desconto_percent, tipo into v_cupom from public.coupons
     where code = v_cupom_code and revendedor_id = p_uid and not usado
       and (validade is null or validade >= (now() at time zone 'America/Cuiaba')::date)
     for update;
    if not found then raise exception 'Cupom inválido, vencido ou já usado.'; end if;
    v_cupom_tipo := v_cupom.tipo;
    if v_cupom.tipo = 'frete' then
      if v_tipo <> 'entrega' then raise exception 'Cupom de taxa grátis só vale em pedidos com entrega.'; end if;
      v_taxa := 0;
    else
      if coalesce(v_cupom.desconto_percent, 0) not between 1 and 100 then raise exception 'Cupom inválido, vencido ou já usado.'; end if;
      v_pct := v_cupom.desconto_percent;
    end if;
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) e left join public.products p on p.id = (e->>'produto_id')::bigint
              where p.id is null or (e->>'quantidade')::int < 1 or (e->>'quantidade')::int > 99) then
    raise exception 'Item inválido no pedido.';
  end if;
  -- Mínimo do atacado: pedido soma >= litros_minimo_pedido() L (30 por padrão). Isento: primeiro pedido do
  -- revendedor e pedido já pago online (mp_payment_id; só o service_role chega aqui com pagamento 'online').
  v_volume := public.volume_do_pedido(p_rows);
  v_pago := v_pag = 'online' and nullif(p_entrega->>'mp_payment_id', '') is not null;
  if not v_pago and not public.revendedor_primeiro_pedido(p_uid) then
    v_min := public.litros_minimo_pedido();
    if v_volume <= 0 or v_volume < v_min then
      raise exception 'O pedido mínimo é de % L (ex.: % caixas de 10 L ou % de 5 L). Seu pedido tem % L.',
        replace(trim_scale(v_min)::text, '.', ','), ceil(v_min / 10)::int, ceil(v_min / 5)::int,
        replace(trim_scale(v_volume)::text, '.', ',');
    end if;
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
    'cupom_tipo', v_cupom_tipo,
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
  if v_tipo = 'entrega' and v_taxa > 0 then
    insert into public.orders (revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor,
                               usa_estoque, origem, entrega, entrega_info, cupom_code)
    values (p_uid, v_numero, (now() at time zone 'America/Cuiaba')::date,
            'Taxa de entrega (' || replace(trim(to_char(v_cot.km, 'FM990.0')), '.', ',') || ' km)', v_taxa, 'processando',
            null, 1, null, false, 'revendedor', true, v_info, v_cupom_code);
  end if;
  if v_cupom_code is not null then update public.coupons set usado = true, usado_por = v_numero where id = v_cupom.id; end if;
  return v_numero;
end $function$;

-- create or replace preserva os grants; reafirma só service_role (função interna)
revoke all on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) to service_role;

-- revenda_iniciar_checkout / revenda_confirmar_checkout / criar_pedido_revendedor NÃO mudam:
--   iniciar  -> simula com criar_pedido_revendedor_para sem mp_payment_id => mínimo checado antes de cobrar;
--   confirmar -> passa mp_payment_id + pagamento 'online' => mínimo não reaplicado após o pagamento.
