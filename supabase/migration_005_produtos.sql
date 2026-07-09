-- ==========================================================================
-- Dupuro Açaí — Migração 005: catálogo de produtos
-- Aplicada diretamente via MCP do Supabase em 2026-07-06 (não precisa rodar
-- manualmente — este arquivo é o registro do que foi aplicado).
-- Produtos com nome/preço/imagem gerenciados pelo admin; pedidos passam a
-- referenciar um produto + quantidade (1 a 99) com valor calculado.
-- ==========================================================================

-- 1. Tabela de produtos
create table if not exists public.products (
  id bigint generated always as identity primary key,
  nome text not null,
  preco numeric(10,2) not null check (preco >= 0),
  imagem_url text,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;

-- Qualquer usuário logado pode ver o catálogo; só admin gerencia.
create policy "products_select_authenticated" on public.products
  for select using (auth.uid() is not null);

create policy "products_insert_admin" on public.products
  for insert with check (public.is_admin());

create policy "products_update_admin" on public.products
  for update using (public.is_admin());

create policy "products_delete_admin" on public.products
  for delete using (public.is_admin());

-- 2. Pedidos passam a referenciar produto + quantidade.
--    itens (texto) e valor continuam preenchidos (snapshot) para histórico:
--    se um produto for apagado depois, o pedido antigo não perde a descrição.
alter table public.orders
  add column if not exists produto_id bigint references public.products(id) on delete set null;

alter table public.orders
  add column if not exists quantidade int check (quantidade between 1 and 99);

-- 3. Bucket público para imagens de produto (upload restrito ao admin)
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do nothing;

drop policy if exists "produtos_storage_insert_admin" on storage.objects;
create policy "produtos_storage_insert_admin" on storage.objects
  for insert with check (bucket_id = 'produtos' and public.is_admin());

drop policy if exists "produtos_storage_delete_admin" on storage.objects;
create policy "produtos_storage_delete_admin" on storage.objects
  for delete using (bucket_id = 'produtos' and public.is_admin());
