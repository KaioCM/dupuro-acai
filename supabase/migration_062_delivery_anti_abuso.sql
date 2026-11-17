-- migration_062 — anti-abuso delivery / expiração via pg_cron
--
-- O que: cria um bucket de taxa genérico (rate_buckets + rate_check), adiciona
--   revoke na tabela delivery_pedidos e revenda_checkouts (agora só RLS protege,
--   mas permissão de tabela também precisa estar fechada paraanon/authenticated),
--   e programa no pg_cron a limpeza real de pedidos expirados (antes era
--   preguiçosa dentro da checkout).
-- Por quê: sem trava, spam de requisições anônimas ocupa vagas do turno no banco
--   e pode lotar entregabelamente o dia inteiro. Expiração dependente de outro
--   checkout deixa pedidos "reféns" por horas se ninguém abrir o site.
-- Observações sobre a política de tabelas: grep zero grant/revoke em
--   supabase/*.sql para delivery_pedidos e revenda_checkouts — elas herdam as
--   permissões padrão do Supabase (anon+authenticated podem ver tudo). RLS já
--   impede escrita acidental, mas quem faz SELECT * direto ainda enxerga dados
--   pessoais (telefone, endereço). Revogar explicitamente fecha essa brecha.

-- ---------- bucket de taxa ----------
create table if not exists public.rate_buckets (
  key text primary key,
  marks int not null default 0,
  janela_inicio timestamptz not null default now()
);

alter table public.rate_buckets enable row level security;
-- Nenhuma policy: anon/authenticated não leem nada; service_role ignora RLS.

-- ---------- função de verificação (operação única atomic upsert) ----------
create or replace function public.rate_check(p_key text, p_max int, p_janela_seg int)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_marks int;
begin
  update public.rate_buckets
     set marks = case when janela_inicio >= now() - make_interval(secs => p_janela_seg)
                      then marks + 1 else 1 end,
         janela_inicio = case when janela_inicio < now() - make_interval(secs => p_janela_seg)
                             then now() else janela_inicio end
   where key = p_key
   returning marks into v_marks;

  if found then
    return v_marks <= p_max;
  end if;

  -- Nenhuma linha existia: insere marca 1 com janela fresca.
  -- ON CONFLICT DO UPDATE garante atomicidade sem race entre dois inserts simultâneos.
  insert into public.rate_buckets (key, marks, janela_inicio)
    values (p_key, 1, now())
    on conflict (key) do update set
      marks = excluded.marks,
      janela_inicio = excluded.janela_inicio;
  return true;  -- primeira marca sempre passa
end $$;

-- Ninguém executa exceto service_role (funções internas)
revoke execute on function public.rate_check(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_check(text, int, int) to service_role;

-- Tabela rate_buckets: access só via service_role (a função é security definer;
--   a tabela em si é leitura extra-segurança caso alguém descubra caminho indireto)
revoke all on public.rate_buckets from public, anon, authenticated;
grant all on public.rate_buckets to service_role;

-- ---------- permissão de tabela (endurecimento contra anon + grant mínimo ao admin) ----------
-- Painel admin (papel authenticated + RLS is_admin) lê delivery_pedidos e revenda_checkouts
-- por PostgREST: precisa de grant de TABELA (RLS sozinha não basta; grant vem antes da policy).
-- Endurecimento real: anon perde todo acesso direto; authenticated recebe só o estrito:
-- SELECT/UPDATE em delivery_pedidos (sem insert/delete — criação é Edge/service_role,
-- cancelamento é RPC) e SELECT em revenda_checkouts (resolução é manual/Edge).
revoke all on public.delivery_pedidos   from anon;
revoke all on public.revenda_checkouts  from anon;
grant select, update on public.delivery_pedidos  to authenticated;
grant select         on public.revenda_checkouts to authenticated;

-- ---------- expiração real via pg_cron ----------
select cron.unschedule('delivery-expirar') where exists (select 1 from cron.job where jobname = 'delivery-expirar');

select cron.schedule('delivery-expirar', '*/10 * * * *', $cron$
  update public.delivery_pedidos
    set status = 'expirado', atualizado_em = now()
    where status = 'aguardando_pagamento'
      and criado_em < now() - interval '3 hours';

  update public.revenda_checkouts
    set status = 'expirado'
    where status = 'aguardando'
      and criado_em < now() - interval '3 hours';
$cron$);

-- A confirmação tardia de PIX continua funcionando: delivery_confirmar_pagamento
-- aceita status 'aguardando_pagamento' | 'expirado'. Não alterar a RPC.
