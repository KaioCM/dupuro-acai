-- migration_065 — origem do cupom: separar cupons de campanha (pesquisa) dos
-- gerados manualmente pelo admin, sem schema novo além de uma coluna.
-- A UI do admin passa a mostrar/filtrar por origem (lote front posterior).
--
-- Nota de ordem: esta migração DEVE ser executada antes da 066, pois o INSERT
-- dentro de pesquisa_registrar alimenta a coluna origem='pesquisa'.
-- Se a tabela não tiver origem quando a RPC for chamada, o INSERT falha.

alter table public.coupons add column if not exists origem text;
