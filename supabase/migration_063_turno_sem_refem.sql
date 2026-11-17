-- migration_063 — turno_sem_refem: spam do mesmo telefone não sequestra vagas
--
-- O problema: cada pedido 'aguardando_pagamento' nos últimos 30 min conta como uma
-- vaga no turno, mesmo que venha do mesmo WhatsApp. Um único número com 10 requisições
-- ocuparia o limite todo. A mesma coisa para checkout de revendedor (contava linhas).
--
-- Mudança: contar telefones únicos na parte de delivery_em_espera e IDs únicos na
-- parte de revenda_checkouts. Pedidos já confirmados continuam contando por linha
-- (pagamento real = entrega real, faz sentido somar).
-- Turno_lotado vigente = migration_053 (data_bloqueada OR ocupacao >= limite);
-- esta migração reescreve SOMENTE turno_ocupacao; turno_lotado permanece intacto.
-- Base: corpo idêntico a migration_052:14-27, única diferença é count(distinct …)
--   substituto de count(*) nas partes 'aguardando'. Se algum campo (telefone / revendedor_id)
--   vier null, o coalesce+concat garante que cada linha mapeia pra um bucket distinto.

create or replace function public.turno_ocupacao(p_data date, p_turno text) returns int
language sql stable security definer set search_path = public as $$
  select (
    -- delivery: pagados contam por linha; não-pagos contam por telefone único
    -- (spam do mesmo número não ocupa mais de uma vaga)
    (select count(*) from public.delivery_pedidos
      where data_entrega = p_data and periodo = p_turno
        and status in ('pago', 'em_rota', 'entregue'))
  + (select coalesce(count(distinct coalesce(nullif(cliente_telefone, ''), 'sem-tel-' || id::text)), 0) from public.delivery_pedidos
      where data_entrega = p_data and periodo = p_turno
        and status = 'aguardando_pagamento' and criado_em > now() - interval '30 minutes')
  + (select count(distinct numero) from public.orders
      where origem = 'revendedor' and status in ('enviado', 'processando', 'entregue')
        and entrega_info->>'tipo' = 'entrega' and entrega_info->>'data' = p_data::text and entrega_info->>'turno' = p_turno)
  + (select coalesce(count(distinct coalesce(nullif(revendedor_id::text, ''), 'sem-dono-' || id::text)), 0) from public.revenda_checkouts
      where status = 'aguardando' and criado_em > now() - interval '30 minutes'
        and entrega->>'tipo' = 'entrega' and entrega->>'data' = p_data::text and entrega->>'turno' = p_turno)
  )::int;
$$;

revoke execute on function public.turno_ocupacao(date, text) from public, anon, authenticated;
grant execute on function public.turno_ocupacao(date, text) to service_role;
