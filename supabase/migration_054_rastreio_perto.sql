-- migration_054 — Rastreio estilo Mercado Livre (pedido do Kayo, 2026-10-26)
-- (053 = cupons do delivery, arquivo guardado e ainda não aplicado.)
-- delivery_rastreio passa a devolver rota.fase:
--   longe     → "Seu pedido saiu para entrega" + horário previsto (sem mapa, sem nº de entregas)
--   perto     → entregador a até raio_mapa_km (padrão 5, em linha reta) mas ainda em outra entrega:
--               "seu pedido está próximo…" + mapa COM o entregador (decisão do Kayo)
--   a_caminho → a próxima parada é a do cliente: "seu pedido está a caminho" + mapa (qualquer distância)
-- O ponto do entregador só vai em perto/a_caminho e com GPS fresco (< 3 min).
-- 'faltam' e 'proxima' continuam no retorno pra página antiga em cache não quebrar.

create or replace function public.delivery_rastreio(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.delivery_pedidos%rowtype; pa record; v_rota jsonb := null; v_faltam int; v_pos record;
  v_raio numeric; v_dist numeric; v_fase text;
begin
  select * into p from public.delivery_pedidos where token = p_token;
  if not found then return null; end if;
  select rp.*, r.status as rota_status into pa
    from public.rota_paradas rp join public.rotas r on r.id = rp.rota_id
   where rp.tipo = 'delivery' and rp.ref = p.codigo
   order by r.id desc limit 1;
  if found and pa.rota_status = 'em_andamento' and pa.status = 'pendente' then
    select count(*) into v_faltam from public.rota_paradas
     where rota_id = pa.rota_id and status = 'pendente' and ordem < pa.ordem;
    select lat, lng, atualizado_em into v_pos from public.rota_posicao
     where rota_id = pa.rota_id and atualizado_em > now() - interval '3 minutes';
    if v_pos.lat is not null and pa.lat is not null then
      v_dist := 2 * 6371 * asin(sqrt(power(sin(radians(pa.lat - v_pos.lat) / 2), 2) +
                cos(radians(v_pos.lat)) * cos(radians(pa.lat)) * power(sin(radians(pa.lng - v_pos.lng) / 2), 2)));
    end if;
    select coalesce((config->>'raio_mapa_km')::numeric, 5) into v_raio from public.delivery_config where id = 1;
    v_fase := case when v_faltam = 0 then 'a_caminho'
                   when v_dist <= coalesce(v_raio, 5) then 'perto'
                   else 'longe' end;
    v_rota := jsonb_build_object('fase', v_fase, 'faltam', v_faltam, 'eta', pa.eta);
    if v_fase <> 'longe' then
      v_rota := v_rota || jsonb_build_object('proxima', v_faltam = 0, 'destino', jsonb_build_object('lat', pa.lat, 'lng', pa.lng),
        'entregador', case when v_pos.lat is not null then jsonb_build_object('lat', v_pos.lat, 'lng', v_pos.lng, 'em', v_pos.atualizado_em) end);
    end if;
  end if;
  return jsonb_build_object(
    'codigo', p.codigo, 'status', p.status, 'periodo', p.periodo, 'data_entrega', p.data_entrega,
    'cliente', split_part(p.cliente_nome, ' ', 1), 'itens', p.itens,
    'subtotal', p.subtotal, 'taxa', p.taxa, 'total', p.total,
    'na_entrega', p.pagar_na_entrega, 'forma_entrega', p.forma_entrega, 'troco_para', p.troco_para,
    'pago_em', p.pago_em, 'saiu_em', p.saiu_em, 'entregue_em', p.entregue_em, 'criado_em', p.criado_em,
    'rota', v_rota);
end $$;
revoke all on function public.delivery_rastreio(uuid) from public;
grant execute on function public.delivery_rastreio(uuid) to anon, authenticated;
