-- ==========================================================================
-- Dupuro Açaí — Migração 007: revendedor lança o próprio pedido
-- Aplicada via MCP do Supabase em 2026-07-06 (registro do que foi aplicado).
--
-- Antes, só o admin podia inserir pedidos (orders_insert_admin). Agora o
-- revendedor aprovado também pode, mas o pedido nasce travado em
-- status = 'enviado' ("Pedido Enviado") — a policy WITH CHECK garante isso
-- no banco, então não dá pra burlar manipulando a requisição no navegador.
-- Só o admin pode mudar o status depois (orders_update_admin, já existente).
-- ==========================================================================

create policy "orders_insert_self" on public.orders
  for insert with check (
    auth.uid() = revendedor_id
    and status = 'enviado'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
  );
