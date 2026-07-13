-- ==========================================================================
-- migration_018 — Papel "atendente" (caixa/PDV da loja) + vendas presenciais
--
-- Cria um papel restrito para a atendente da loja registrar, ela mesma e na
-- hora, as vendas presenciais (balcão avulso ou revendedor retirando). A venda
-- nasce 'entregue' e baixa o estoque imediatamente — sem passar pela análise do
-- admin. A atendente NÃO gerencia produtos/revendedores/cupons, não edita nem
-- exclui pedidos; só registra vendas de loja, vê as vendas do dia e o estoque.
--
-- Aplicada via MCP em 2026-07-13. Este arquivo é o espelho de referência.
-- ==========================================================================

-- 1. Novo papel
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('revendedor', 'admin', 'atendente'));

-- 2. Colunas de origem/autoria nos pedidos
alter table public.orders
  add column if not exists origem text not null default 'revendedor'
    check (origem in ('revendedor', 'admin', 'loja'));
alter table public.orders
  add column if not exists atendente_id uuid references auth.users(id) on delete set null;

-- 3. Quem é atendente aprovado (security definer: ignora RLS ao checar o perfil)
create or replace function public.is_atendente()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'atendente' and status = 'aprovado'
  );
$$;

-- 4. Policies do atendente
-- Insere venda de loja: sempre origem='loja', consome estoque (usa_estoque=true)
-- e já nasce 'entregue' (venda concluída no balcão). Sem pedido mínimo (balcão
-- vende avulso). O gatilho de estoque valida disponibilidade e baixa na hora.
drop policy if exists "orders_insert_atendente" on public.orders;
create policy "orders_insert_atendente" on public.orders
  for insert with check (
    public.is_atendente()
    and origem = 'loja'
    and usa_estoque = true
    and status = 'entregue'
  );

-- Lê as vendas de loja (para o fechamento de caixa do dia).
drop policy if exists "orders_select_atendente" on public.orders;
create policy "orders_select_atendente" on public.orders
  for select using (public.is_atendente() and origem = 'loja');

-- Lista revendedores aprovados (para vincular uma venda de balcão a um revendedor).
drop policy if exists "profiles_select_atendente" on public.profiles;
create policy "profiles_select_atendente" on public.profiles
  for select using (public.is_atendente() and role = 'revendedor' and status = 'aprovado');
