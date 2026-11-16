-- ==========================================================================
-- migration_060_nfce_email_contador.sql — cópia de NFC-e por e-mail ao contador
-- ==========================================================================
-- Pedido do contador: toda NFC-e autorizada deve chegar ao e-mail dele. A
-- cópia é agendada no próprio Focus (POST /v2/nfce/{ref}/email, com os
-- e-mails vindos do secret FOCUS_EMAIL_CONTADOR) pela Edge Function
-- `emitir-nfce`. Aqui fica o resultado do agendamento por emissão
-- ({ ok, emails, http, resposta, agendado_em }) — o envio em si é em
-- segundo plano no Focus.
-- ==========================================================================

alter table public.nfce_emissoes add column if not exists email_contador jsonb;
