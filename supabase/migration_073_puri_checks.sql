-- migration_073_puri_checks — valores permitidos em qualificacao_leads.origem / intencao (Edge `assistente`)
-- Idempotente. RLS e grants inalterados. Linhas antigas (origem/intencao nulos) passam no check.

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_origem_chk') then
    alter table public.qualificacao_leads
      add constraint qualificacao_origem_chk
      check (origem is null or origem in ('puri'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_intencao_chk') then
    alter table public.qualificacao_leads
      add constraint qualificacao_intencao_chk
      check (intencao is null or intencao in ('revender','consumir','provar','duvida','humano','incerto'));
  end if;
end $$;
