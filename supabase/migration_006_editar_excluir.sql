-- ==========================================================================
-- Dupuro Açaí — Migração 006: editar/excluir pedidos e revendedores
-- Aplicada via MCP do Supabase em 2026-07-06 (registro do que foi aplicado).
--
-- Duas mudanças:
-- 1. Admin pode apagar pedidos (política de delete que faltava).
-- 2. revendedor_id em orders/coupons vira opcional com ON DELETE SET NULL,
--    pelo mesmo motivo do produto_id em orders: se a conta do revendedor for
--    excluída (ver Edge Function admin-delete-reseller), o histórico de
--    pedidos/cupons NÃO é apagado junto — só perde a referência ao dono
--    (aparece como "revendedor removido" no painel). Preserva registro
--    financeiro/contábil mesmo depois de remover a conta.
-- ==========================================================================

create policy "orders_delete_admin" on public.orders
  for delete using (public.is_admin());

alter table public.orders drop constraint orders_revendedor_id_fkey;
alter table public.orders alter column revendedor_id drop not null;
alter table public.orders
  add constraint orders_revendedor_id_fkey
  foreign key (revendedor_id) references auth.users(id) on delete set null;

alter table public.coupons drop constraint coupons_revendedor_id_fkey;
alter table public.coupons alter column revendedor_id drop not null;
alter table public.coupons
  add constraint coupons_revendedor_id_fkey
  foreign key (revendedor_id) references auth.users(id) on delete set null;
