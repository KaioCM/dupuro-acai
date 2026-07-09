-- ==========================================================================
-- Dupuro Açaí — Migração 009: categoria de produto (açaí/creme)
-- REVERTIDA pela migration_010_multissabor.sql — a coluna categoria foi
-- removida. Mantido como registro histórico do que foi aplicado.
-- ==========================================================================

alter table public.products
  add column if not exists categoria text not null default 'acai' check (categoria in ('acai', 'creme'));
