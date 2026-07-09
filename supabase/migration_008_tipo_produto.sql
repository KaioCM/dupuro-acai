-- ==========================================================================
-- Dupuro Açaí — Migração 008: tipo de produto (atacado/varejo)
-- Aplicada diretamente via MCP do Supabase em 2026-07-06 (não precisa rodar
-- manualmente — este arquivo é o registro do que foi aplicado).
-- Cada produto passa a ter um tipo, usado para separar o catálogo do
-- revendedor entre atacado e varejo.
-- ==========================================================================

alter table public.products
  add column if not exists tipo text not null default 'varejo' check (tipo in ('atacado', 'varejo'));
