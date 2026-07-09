-- ==========================================================================
-- Dupuro Açaí — Migração 014: quantidade mínima de pedido por produto
-- Aplicada diretamente via MCP do Supabase (este arquivo é o registro).
--
-- O admin define, por produto, a menor quantidade que o revendedor pode pedir.
-- Padrão 1 (sem mínimo). Enforçado na UI e também na policy de pedido do
-- próprio revendedor (orders_insert_self), pra não dar pra burlar pelo console.
-- ==========================================================================

alter table public.products
  add column if not exists pedido_minimo integer not null default 1 check (pedido_minimo between 1 and 99);

drop policy if exists "orders_insert_self" on public.orders;
create policy "orders_insert_self" on public.orders
  for insert with check (
    auth.uid() = revendedor_id
    and status = 'enviado'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
    and quantidade >= coalesce((select pedido_minimo from public.products where id = produto_id), 1)
  );
