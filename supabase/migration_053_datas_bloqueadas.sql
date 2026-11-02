-- migration_053: dias sem entrega (feriado) — delivery_config.config.datas_bloqueadas.
--
-- Lista de datas 'AAAA-MM-DD' em delivery_config.config->'datas_bloqueadas'.
-- Numa data bloqueada:
--  * turno_lotado() responde true nos dois turnos → some do delivery
--    (delivery_turnos_lotados alimenta delivery.js e o painel do revendedor) e o
--    servidor recusa (delivery-checkout e criar_pedido_revendedor_para já chamam
--    turno_lotado).
--  * turno_aberto() responde false → o banco recusa também a RETIRADA do
--    revendedor nesse dia.
-- Sem mudar front nem Edge Function. Primeiro uso: 02/11/2026 (Finados).

create or replace function public.data_bloqueada(p_data date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select config->'datas_bloqueadas' ? p_data::text from public.delivery_config limit 1), false);
$$;
revoke execute on function public.data_bloqueada(date) from public, anon;
grant execute on function public.data_bloqueada(date) to authenticated, service_role;

create or replace function public.turno_lotado(p_data date, p_turno text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.data_bloqueada(p_data)
      or public.turno_ocupacao(p_data, p_turno) >= public.limite_por_rota();
$$;

create or replace function public.turno_aberto(p_data date, p_turno text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select p_turno in ('manha', 'tarde')
     and extract(isodow from p_data) between 1 and 6
     and not public.data_bloqueada(p_data)
     and p_data <= (now() at time zone 'America/Cuiaba')::date + 14
     and (
       p_data > (now() at time zone 'America/Cuiaba')::date
       or (p_data = (now() at time zone 'America/Cuiaba')::date
           and (now() at time zone 'America/Cuiaba')::time < case p_turno when 'manha' then time '07:00' else time '11:00' end)
     );
$$;
