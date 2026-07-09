-- ==========================================================================
-- Dupuro Açaí — Migração 004: cupons passam a ser exclusivos do admin
-- Rodar no SQL Editor do projeto Supabase (depois de schema.sql,
-- migration_002_aprovacao.sql e migration_003_admin.sql).
-- Antes, o próprio revendedor gerava seus cupons. Agora só o admin gera
-- (e pode apagar) cupons — o revendedor continua só visualizando os seus.
-- ==========================================================================

drop policy if exists "coupons_insert_own_approved" on public.coupons;

create policy "coupons_insert_admin" on public.coupons
  for insert with check (public.is_admin());

create policy "coupons_delete_admin" on public.coupons
  for delete using (public.is_admin());
