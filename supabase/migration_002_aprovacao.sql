-- ==========================================================================
-- Dupuro Açaí — Migração 002: cadastro com aprovação de admin
-- Rodar no SQL Editor do projeto Supabase (o mesmo projeto onde já rodou schema.sql).
-- Adiciona o fluxo: cliente se cadastra sozinho → status 'pendente' → admin aprova.
-- ==========================================================================

-- 1. Coluna de status em profiles
alter table public.profiles
  add column if not exists status text not null default 'pendente'
  check (status in ('pendente', 'aprovado', 'rejeitado'));

-- Usuários que já existem (ex: o revendedor de teste criado manualmente) já
-- devem estar liberados, senão o próprio teste que você já fez para de funcionar.
update public.profiles set status = 'aprovado' where status = 'pendente';

-- 2. Trigger passa a copiar nome/empresa/telefone/cidade do cadastro (enviados
--    via options.data no auth.signUp do site) para dentro de profiles.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, nome, empresa, telefone, cidade)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'empresa',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'cidade'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 3. Pedidos e cupons só ficam visíveis/gerenciáveis depois de aprovado.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own_approved" on public.orders
  for select using (
    auth.uid() = revendedor_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
  );

drop policy if exists "coupons_select_own" on public.coupons;
create policy "coupons_select_own_approved" on public.coupons
  for select using (
    auth.uid() = revendedor_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
  );

drop policy if exists "coupons_insert_own" on public.coupons;
create policy "coupons_insert_own_approved" on public.coupons
  for insert with check (
    auth.uid() = revendedor_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
  );

-- ==========================================================================
-- Como aprovar um novo revendedor a partir de agora:
-- Table Editor → profiles → filtrar status = 'pendente' → editar a linha →
-- mudar status para 'aprovado' (ou 'rejeitado' para recusar).
-- ==========================================================================
