-- ==========================================================================
-- Migration 019 — Copo com acompanhamentos + self-service por peso
-- ==========================================================================
-- A loja física vende, além dos produtos embalados, açaí no copo/tigela:
--   • modo 'copo'  → preço fixo (300ml, 400ml...), com direito a N acompanhamentos
--                    grátis; cada extra custa `acomp_extra_preco` (hoje R$ 1,00).
--   • modo 'peso'  → self-service: o cliente monta e pesa; `preco` é o R$/kg.
--   • modo 'embalado' → o que já existe (caixas, potes, bebidas).
-- Produtos 'copo'/'peso' são exclusivos da loja: não aparecem para o revendedor
-- (filtro no cliente.js) e não entram no controle de estoque por unidade.
-- ==========================================================================

alter table public.products
  add column if not exists modo text not null default 'embalado'
    check (modo in ('embalado', 'copo', 'peso')),
  -- Quantos acompanhamentos gratuitos o copo dá direito (0 = nenhum).
  add column if not exists acomp_gratis integer not null default 0
    check (acomp_gratis >= 0 and acomp_gratis <= 20),
  -- Preço de cada acompanhamento gratuito escolhido ALÉM da cota.
  add column if not exists acomp_extra_preco numeric(10,2) not null default 0
    check (acomp_extra_preco >= 0);

-- Lista única de acompanhamentos da loja (leite condensado, granola, etc.).
--   tipo 'gratuito' → entra na cota do copo; excedente cobra acomp_extra_preco.
--   tipo 'pago'     → sempre cobra `preco`, fora da cota (ex: Nutella, morango).
create table if not exists public.acompanhamentos (
  id bigint generated always as identity primary key,
  nome text not null,
  tipo text not null default 'gratuito' check (tipo in ('gratuito', 'pago')),
  preco numeric(10,2) not null default 0 check (preco >= 0),
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.acompanhamentos enable row level security;

drop policy if exists "acompanhamentos_select_authenticated" on public.acompanhamentos;
create policy "acompanhamentos_select_authenticated" on public.acompanhamentos
  for select using (auth.uid() is not null);

drop policy if exists "acompanhamentos_insert_admin" on public.acompanhamentos;
create policy "acompanhamentos_insert_admin" on public.acompanhamentos
  for insert with check (public.is_admin());

drop policy if exists "acompanhamentos_update_admin" on public.acompanhamentos;
create policy "acompanhamentos_update_admin" on public.acompanhamentos
  for update using (public.is_admin());

drop policy if exists "acompanhamentos_delete_admin" on public.acompanhamentos;
create policy "acompanhamentos_delete_admin" on public.acompanhamentos
  for delete using (public.is_admin());
