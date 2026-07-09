-- ==========================================================================
-- Dupuro Açaí — Migração 011: opção de incluir açaí na lista de sabores
-- Aplicada diretamente via MCP do Supabase (não precisa rodar manualmente —
-- este arquivo é o registro do que foi aplicado).
--
-- Alguns produtos multissabor são só de cremes (ex: "Caixa de Cremes 10
-- Litros") e não devem oferecer "Açaí" como opção de sabor no pedido.
-- ==========================================================================

alter table public.products
  add column if not exists multissabor_incluir_acai boolean not null default true;
