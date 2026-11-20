-- migration_072_puri_leads — conversas do assistente Puri em qualificacao_leads
--
-- O que: colunas `origem` ('puri' = conversa criada pela Edge `assistente`),
--   `pagina` (home/revenda/delivery) e `intencao` (última intenção detectada).
-- Contador de mensagens: reutiliza `turns`; `ultimo_texto` guarda só texto
--   já mascarado (telefone/e-mail/CPF/CNPJ/nome).
-- RLS/grants inalterados: anon/authenticated seguem sem acesso (só service_role).

alter table public.qualificacao_leads
  add column if not exists origem text,
  add column if not exists pagina text,
  add column if not exists intencao text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_pagina_chk') then
    alter table public.qualificacao_leads
      add constraint qualificacao_pagina_chk
      check (pagina is null or pagina in ('home','revenda','delivery'));
  end if;
end $$;

create index if not exists qualificacao_origem_criado_idx
  on public.qualificacao_leads (origem, criado_em desc);
