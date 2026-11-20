-- Migração 069 (hotfix) — criar_pedido_revendedor_para: corrige erro em pedido SEM cupom
--
-- BUG VIVO (achado em 2026-11-19): a função viva falha em QUALQUER pedido sem cupom com
--   'record "v_cupom" is not assigned yet'
-- porque o jsonb_build_object de v_info avaliava `case when v_cupom_code is not null then v_cupom.tipo end`
-- e o plpgsql resolve o campo do record v_cupom (nunca atribuído quando não há cupom) antes do case.
--
-- CORREÇÃO: variável escalar v_cupom_tipo (text), preenchida no bloco do cupom logo após o
-- select ... for update bem-sucedido, e usada no jsonb_build_object no lugar de v_cupom.tipo.
-- As demais referências a v_cupom.* estão todas dentro de `if v_cupom_code is not null` (ok).
-- v_cot.km continua protegido por `case when v_tipo = 'entrega'` (v_cot só é lido quando atribuído).
--
-- Base: definição VIVA em 2026-11-19 (pg_get_functiondef). ÚNICA mudança: v_cupom_tipo.
-- Grants vivos: postgres + service_role (EXECUTE); reafirmados abaixo.

create or replace function public.criar_pedido_revendedor_para(p_uid uuid, p_rows jsonb, p_entrega jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_numero text; v_volume numeric; v_dispensa boolean; v_falta record; r jsonb; v_prod record;
  v_qtd int; v_sabor text; v_tipo text; v_data date; v_turno text; v_pag text; v_forma text;
  v_end text; v_obs text; v_prazo boolean; v_info jsonb; v_cupom_code text; v_cupom record;
  v_pct int := 0; v_troco numeric; v_total numeric := 0; v_lat double precision; v_lng double precision;
  v_cot public.entrega_cotacoes; v_cot_id uuid; v_taxa numeric := 0; v_cupom_tipo text;
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

-- Grants vivos (postgres + service_role): função interna, fora de public/anon/authenticated.
revoke all on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) to service_role;
