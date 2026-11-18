-- migration_068_qualificacao_leads — qualificação P3 via chat
--
-- O que: tabela `qualificacao_leads` com política de escrita exclusiva
--   pela Edge service_role e leitura admin via PostgREST (RLS + is_admin).
-- Por quê: fluxos P3 de qualificação de leads da revenda pelo Jev/chat;
--   amostra adiada vira flag (quer_amostra FALSE mantida no 'em_chat'),
--   confirmando vira TRUE para avançar ao cadastro ou convertido.
-- Nota de ordem: migração isolada, sem dependências retroativas; a
--   Edge Function `qualificar-turno` e o front dependem desta estrutura.

create table if not exists public.qualificacao_leads (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'em_chat'
    check (status in ('em_chat','varejo','expansao','potencial','pronto_cadastro','convertido','sem_acao')),
  nome text check (char_length(nome) <= 80),
  negocio text check (char_length(negocio) <= 120),
  telefone text check (char_length(telefone) <= 20),
  cidade text check (char_length(cidade) <= 60),
  bairro text check (char_length(bairro) <= 60),
  segmento text,
  objecao text,
  interesse smallint check (interesse between 0 and 3),
  quer_amostra boolean not null default false,
  turns int not null default 0,
  ultimo_texto text check (ultimo_texto is null or char_length(ultimo_texto) <= 300),
  lead_profile uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.qualificacao_leads enable row level security;

-- =============================================================
-- Políticas
-- =============================================================

drop policy if exists qualificacao_admin_select on public.qualificacao_leads;

create policy qualificacao_admin_select on public.qualificacao_leads
  for select to authenticated using (public.is_admin());

-- SEM política para anon: todo acesso não-admin passa pela Edge
-- Function (service_role). Nada é escrito pelo navegador.

-- =============================================================
-- Grants
-- =============================================================

revoke all on table public.qualificacao_leads from anon, authenticated;
grant select on table public.qualificacao_leads to authenticated;
grant all on table public.qualificacao_leads to service_role;

-- =============================================================
-- Índices (nome explícito, if not exists, _idx)
-- =============================================================

create index if not exists qualificacao_status_idx
  on public.qualificacao_leads (status);

create index if not exists qualificacao_amostra_idx
  on public.qualificacao_leads (quer_amostra) where quer_amostra;

create index if not exists qualificacao_criado_idx
  on public.qualificacao_leads (criado_em desc);

-- =============================================================
-- Trigger: atualiza coluna atualizado_em antes de UPDATE
-- =============================================================

create or replace function public.qualificacao_touch()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists qualificacao_trigger_set_atualizado_em
  on public.qualificacao_leads;

create trigger qualificacao_trigger_set_atualizado_em
  before update on public.qualificacao_leads
  for each row
  execute function public.qualificacao_touch();

revoke execute on function public.qualificacao_touch() from public, anon, authenticated;
