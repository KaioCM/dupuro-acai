-- migration_077_puri_uso_ambiente.sql — Puri, reforma Etapa 0 (base técnica). NÃO aplicada ao escrever este arquivo.
-- (a) qualificacao_leads.ambiente: separa conversas do dev e da produção ('prod' por padrão).
-- (b) puri_uso: uma linha por chamada de IA (Anthropic/Jev) com tokens e custo em USD; a Edge grava com service role.
-- (c) puri_custo_mes(): gasto do mês (fuso America/Cuiaba, dev+prod) e teto, só para admin;
--     puri_custo_mes_interno(): mesma conta para a Edge (só service_role), usada na trava de custo.
-- (d) app_settings.puri_teto_usd = 5 (USD/mês) se ainda não existir. app_settings(chave text, valor numeric, atualizado_em) não tem PK.

alter table public.qualificacao_leads
  add column if not exists ambiente text not null default 'prod' check (ambiente in ('dev','prod'));

create table if not exists public.puri_uso (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  ambiente text not null check (ambiente in ('dev','prod')),
  servico text not null check (servico in ('anthropic','jev')),
  funcao text,
  modelo text,
  input_tokens int,
  output_tokens int,
  cache_write_tokens int,
  cache_read_tokens int,
  estimado boolean not null default false,
  custo_usd numeric(12,6)
);
create index if not exists puri_uso_criado_em_idx on public.puri_uso (criado_em);

alter table public.puri_uso enable row level security;
drop policy if exists puri_uso_admin_select on public.puri_uso;
create policy puri_uso_admin_select on public.puri_uso for select to authenticated using (public.is_admin());
revoke all on public.puri_uso from anon, authenticated;
grant select on public.puri_uso to authenticated;
revoke all on sequence public.puri_uso_id_seq from anon, authenticated;

create or replace function public.puri_custo_mes_interno()
returns table (gasto numeric, teto numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    coalesce((select sum(u.custo_usd) from public.puri_uso u
              where u.criado_em >= (date_trunc('month', now() at time zone 'America/Cuiaba') at time zone 'America/Cuiaba')), 0)::numeric,
    coalesce((select s.valor from public.app_settings s where s.chave = 'puri_teto_usd' limit 1), 5)::numeric
$$;
revoke all on function public.puri_custo_mes_interno() from public, anon, authenticated;
grant execute on function public.puri_custo_mes_interno() to service_role;

create or replace function public.puri_custo_mes()
returns table (gasto numeric, teto numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query select * from public.puri_custo_mes_interno();
end $$;
revoke all on function public.puri_custo_mes() from public, anon;
grant execute on function public.puri_custo_mes() to authenticated;

insert into public.app_settings (chave, valor)
select 'puri_teto_usd', 5
where not exists (select 1 from public.app_settings where chave = 'puri_teto_usd');
