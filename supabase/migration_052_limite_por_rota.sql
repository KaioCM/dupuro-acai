-- migration_052 — Limite de entregas por rota (2026-10-24)
-- Pedido do Kayo: 10 entregas por rota (dia + período) por enquanto, delivery +
-- revenda juntos; retirada na fábrica não conta. Configurável em
-- delivery_config.config.limite_por_rota. Pagamento online em andamento
-- (delivery aguardando ou checkout de revenda) segura a vaga por 30 min.

update public.delivery_config set config = config || '{"limite_por_rota": 10}'::jsonb where id = 1 and not (config ? 'limite_por_rota');

create or replace function public.limite_por_rota() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (config->>'limite_por_rota')::int from public.delivery_config where id = 1), 10);
$$;

create or replace function public.turno_ocupacao(p_data date, p_turno text) returns int
language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.delivery_pedidos
      where data_entrega = p_data and periodo = p_turno
        and (status in ('pago', 'em_rota', 'entregue') or (status = 'aguardando_pagamento' and criado_em > now() - interval '30 minutes')))
  + (select count(distinct numero) from public.orders
      where origem = 'revendedor' and status in ('enviado', 'processando', 'entregue')
        and entrega_info->>'tipo' = 'entrega' and entrega_info->>'data' = p_data::text and entrega_info->>'turno' = p_turno)
  + (select count(*) from public.revenda_checkouts
      where status = 'aguardando' and criado_em > now() - interval '30 minutes'
        and entrega->>'tipo' = 'entrega' and entrega->>'data' = p_data::text and entrega->>'turno' = p_turno)
  )::int;
$$;

create or replace function public.turno_lotado(p_data date, p_turno text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.turno_ocupacao(p_data, p_turno) >= public.limite_por_rota();
$$;

create or replace function public.delivery_turnos_lotados() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d::date::text || '|' || t), '{}')
    from generate_series((now() at time zone 'America/Cuiaba')::date, (now() at time zone 'America/Cuiaba')::date + 10, interval '1 day') d
    cross join (values ('manha'), ('tarde')) v(t)
   where public.turno_lotado(d::date, t);
$$;

revoke execute on function public.turno_ocupacao(date, text) from public, anon, authenticated;
revoke execute on function public.turno_lotado(date, text) from public, anon, authenticated;
revoke execute on function public.limite_por_rota() from public, anon, authenticated;
grant execute on function public.delivery_turnos_lotados() to anon, authenticated;

-- criar_pedido_revendedor_para (migration_051) ganhou, antes do "Informe o endereço":
--   if v_tipo = 'entrega' and nullif(p_entrega->>'mp_payment_id', '') is null and public.turno_lotado(v_data, v_turno) then
--     raise exception 'Esse turno de entrega lotou. Escolha outro dia ou turno (ou retire na fábrica).';
--   end if;
-- (a confirmação de um pagamento online já aprovado não é barrada: a vaga foi segurada no checkout).
-- 052b: revenda_iniciar_checkout expira o checkout 'aguardando' anterior do mesmo
-- revendedor antes de validar (tentar de novo não ocupa duas vagas).
