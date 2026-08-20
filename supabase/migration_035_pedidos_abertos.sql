-- ==========================================================================
-- migration_035 — Pedidos em aberto (slots) no caixa
-- ==========================================================================
-- Slots de pedido que a atendente tira SEM pagamento na hora (delivery aguardando,
-- consumo na loja que paga ao sair, retirada). É um "carrinho guardado": NÃO é
-- venda ainda, NÃO gera VND e NÃO baixa estoque — isso só acontece quando ela
-- FINALIZA (o pedido volta pro carrinho e passa pelo fluxo normal de registro).
-- Guardado no banco pra aparecer em qualquer PC/aba da loja.
create table if not exists public.caixa_pedidos_abertos (
  id bigint generated always as identity primary key,
  label text not null,                        -- nome/apelido do cliente (rótulo do slot)
  atendente_id uuid references public.profiles(id) on delete set null,
  sale_target text not null default 'balcao', -- 'balcao' | 'revendedor'
  revendedor_id uuid references public.profiles(id) on delete set null,
  carrinho jsonb not null,                    -- itens no formato do carrinho do caixa
  entrega boolean not null default false,
  entrega_info jsonb,                         -- { nome, endereco }
  taxa numeric(10,2) not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.caixa_pedidos_abertos enable row level security;

-- Atendente e admin (equipe da loja) gerenciam todos os slots — turnos diferentes
-- precisam enxergar o mesmo pedido aberto.
drop policy if exists pedidos_abertos_all on public.caixa_pedidos_abertos;
create policy pedidos_abertos_all on public.caixa_pedidos_abertos
  for all to authenticated
  using (public.is_atendente() or public.is_admin())
  with check (public.is_atendente() or public.is_admin());

create index if not exists idx_pedidos_abertos_criado on public.caixa_pedidos_abertos (criado_em);
