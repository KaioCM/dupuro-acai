-- 081: Puri Etapa 3 (destinos). Colunas novas em qualificacao_leads (destino, destino_em, esforco, atendido_em),
-- índice em destino e RPC admin_lead_atendido (só admin marca o caso quente como atendido). Os CHECKs de status/fluxo/intencao não mudam.
alter table public.qualificacao_leads
  add column if not exists destino text,
  add column if not exists destino_em timestamptz,
  add column if not exists esforco smallint,
  add column if not exists atendido_em timestamptz;

alter table public.qualificacao_leads
  drop constraint if exists qualificacao_leads_destino_check;
alter table public.qualificacao_leads
  add constraint qualificacao_leads_destino_check
  check (destino is null or destino in ('contato_rapido', 'visita', 'cadastro', 'delivery', 'lista_espera'));

alter table public.qualificacao_leads
  drop constraint if exists qualificacao_leads_esforco_check;
alter table public.qualificacao_leads
  add constraint qualificacao_leads_esforco_check
  check (esforco is null or (esforco >= 0 and esforco <= 3));

create index if not exists qualificacao_leads_destino_idx on public.qualificacao_leads (destino);

create or replace function public.admin_lead_atendido(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  update public.qualificacao_leads set atendido_em = now() where id = p_lead;
end;
$$;

revoke all on function public.admin_lead_atendido(uuid) from public, anon;
grant execute on function public.admin_lead_atendido(uuid) to authenticated;
