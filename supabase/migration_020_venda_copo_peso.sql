-- ==========================================================================
-- Migration 020 — Venda de copo e self-service no PDV (caixa)
-- ==========================================================================
-- Copo (modo 'copo') e self-service (modo 'peso') não têm estoque por unidade,
-- então a linha do pedido nasce com usa_estoque = false (o gatilho de estoque
-- ignora). A policy da atendente amarra isso ao modo do produto: produto
-- 'embalado' OBRIGA usa_estoque = true (não dá pra vender sem baixar estoque);
-- 'copo'/'peso' OBRIGAM false.
--
-- `detalhes` (jsonb) guarda o que o texto de `itens` não estrutura:
--   copo → { acompanhamentos: [{nome, tipo, preco}], gratis_inclusos, extras_cobrados, extra_unitario }
--   peso → { peso_kg, preco_kg }
-- Serve de base para a impressão da comanda e, depois, para a nota fiscal.
-- ==========================================================================

alter table public.orders
  add column if not exists detalhes jsonb;

drop policy if exists "orders_insert_atendente" on public.orders;
create policy "orders_insert_atendente" on public.orders
  for insert with check (
    public.is_atendente()
    and origem = 'loja'
    and status = 'entregue'
    and usa_estoque = coalesce(
      (select p.modo = 'embalado' from public.products p where p.id = produto_id),
      true
    )
  );
