-- 078: registro das decisões do Jev e das reescritas na Puri (reforma da Puri, Etapa 1).
-- A Edge `assistente` grava aqui, por lead, as últimas 60 entradas {t, e (etapa), r (rótulo), v (valor/probabilidade), x (efeito)}.
-- NUNCA guarda texto do cliente: só rótulos, números e códigos de motivo.
alter table public.qualificacao_leads add column if not exists jev_log jsonb not null default '[]'::jsonb;
comment on column public.qualificacao_leads.jev_log is 'Decisões do Jev e motivos de reescrita da Puri (últimas 60 entradas; só rótulos, números e códigos; sem texto do cliente).';
