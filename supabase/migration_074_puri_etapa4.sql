-- migration_074_puri_etapa4 — Puri etapa 4: fluxo, visita do vendedor, histórico (qualificacao_leads) + RPC admin
-- Idempotente. RLS e grants da tabela INALTERADOS (anon/authenticated sem escrita; só service_role da Edge `assistente`).
-- Colunas estruturadas (nome/telefone/cidade/bairro/visita_*) NUNCA vão a Jev/Haiku/log.

alter table public.qualificacao_leads
  add column if not exists fluxo text,
  add column if not exists movimento text,
  add column if not exists resumo text,
  add column if not exists anotacoes jsonb,
  add column if not exists simulacao jsonb,
  add column if not exists prioridade smallint,
  add column if not exists coerente boolean,
  add column if not exists visita_status text,
  add column if not exists visita_dia text,
  add column if not exists visita_periodo text,
  add column if not exists visita_em timestamptz,
  add column if not exists historico jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_fluxo_chk') then
    alter table public.qualificacao_leads add constraint qualificacao_fluxo_chk
      check (fluxo is null or fluxo in ('duvida','consumir','provar','revender'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_movimento_chk') then
    alter table public.qualificacao_leads add constraint qualificacao_movimento_chk
      check (movimento is null or movimento in ('ate20','20a50','50a100','100mais'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_resumo_chk') then
    alter table public.qualificacao_leads add constraint qualificacao_resumo_chk
      check (resumo is null or char_length(resumo) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_prioridade_chk') then
    alter table public.qualificacao_leads add constraint qualificacao_prioridade_chk
      check (prioridade is null or prioridade between 0 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_visita_status_chk') then
    alter table public.qualificacao_leads add constraint qualificacao_visita_status_chk
      check (visita_status is null or visita_status in ('pedida','agendada','feita','cancelada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_visita_dia_chk') then
    alter table public.qualificacao_leads add constraint qualificacao_visita_dia_chk
      check (visita_dia is null or visita_dia in ('seg','ter','qua','qui','sex'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qualificacao_visita_periodo_chk') then
    alter table public.qualificacao_leads add constraint qualificacao_visita_periodo_chk
      check (visita_periodo is null or visita_periodo in ('manha','tarde'));
  end if;
end $$;

-- Admin muda o andamento da visita (Kayo/Dilene); quem não é admin recebe exceção.
create or replace function public.admin_visita_status(p_lead uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Sem permissão.';
  end if;
  if p_status is null or p_status not in ('pedida','agendada','feita','cancelada') then
    raise exception 'Status inválido.';
  end if;
  update public.qualificacao_leads
     set visita_status = p_status, atualizado_em = now()
   where id = p_lead;
end;
$$;

revoke all on function public.admin_visita_status(uuid, text) from public, anon;
grant execute on function public.admin_visita_status(uuid, text) to authenticated;
