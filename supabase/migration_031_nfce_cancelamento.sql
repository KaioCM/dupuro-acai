-- ==========================================================================
-- migration_031_nfce_cancelamento.sql — cancelamento de NFC-e
-- ==========================================================================
-- Guarda o resultado do cancelamento de um cupom no SEFAZ (via Focus). O
-- cancelamento é feito pela Edge Function `cancelar-nfce`, que muda o status
-- da emissão para 'cancelado' (já previsto no check da migration_030) e grava
-- aqui o retorno + o momento. Prazo legal em MT: 30 min após a autorização.
-- ==========================================================================

alter table public.nfce_emissoes add column if not exists cancelamento jsonb;
alter table public.nfce_emissoes add column if not exists cancelado_em timestamptz;
