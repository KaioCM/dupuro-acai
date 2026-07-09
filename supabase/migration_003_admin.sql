-- ==========================================================================
-- Dupuro Açaí — Migração 003: painel admin
-- Rodar no SQL Editor do projeto Supabase (o mesmo onde já rodou schema.sql
-- e migration_002_aprovacao.sql).
-- Adiciona um papel de admin que pode: aprovar/rejeitar cadastros, ver todos
-- os revendedores, criar/atualizar pedidos e ver todos os cupons.
-- ==========================================================================

-- 1. Coluna de papel (role) em profiles
alter table public.profiles
  add column if not exists role text not null default 'revendedor'
  check (role in ('revendedor', 'admin'));

-- 2. Função auxiliar que verifica se o usuário logado é admin, sem disparar
--    recursão nas próprias políticas de RLS de profiles (security definer
--    roda com privilégios do dono da função, ignorando RLS).
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable set search_path = public;

-- 3. Profiles: admin pode ver e atualizar (aprovar/rejeitar) qualquer perfil,
--    além do próprio.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own_or_admin" on public.profiles
  for update using (auth.uid() = id or public.is_admin());

-- 4. Orders: admin pode ver, criar e atualizar pedidos de qualquer revendedor
--    (substitui a necessidade de mexer direto no Table Editor).
drop policy if exists "orders_select_own_approved" on public.orders;
create policy "orders_select_own_approved_or_admin" on public.orders
  for select using (
    (
      auth.uid() = revendedor_id
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
    )
    or public.is_admin()
  );

create policy "orders_insert_admin" on public.orders
  for insert with check (public.is_admin());

create policy "orders_update_admin" on public.orders
  for update using (public.is_admin());

-- 5. Coupons: admin pode ver todos (visão geral), geração continua sendo
--    exclusiva do próprio revendedor aprovado.
drop policy if exists "coupons_select_own_approved" on public.coupons;
create policy "coupons_select_own_approved_or_admin" on public.coupons
  for select using (
    (
      auth.uid() = revendedor_id
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
    )
    or public.is_admin()
  );

-- ==========================================================================
-- Como tornar a conta kayocamargo@outlook.com admin (rode isso uma vez,
-- depois de confirmar que essa conta já existe em profiles):
--
-- update public.profiles
-- set role = 'admin', status = 'aprovado'
-- where email = 'kayocamargo@outlook.com';
-- ==========================================================================
