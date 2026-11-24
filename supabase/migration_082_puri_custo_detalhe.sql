-- migration_082_puri_custo_detalhe.sql — custo do mês da Puri detalhado por ambiente, serviço e função. Só leitura.
-- Mesmo recorte de mês (America/Cuiaba), security definer, search_path e checagem is_admin() de puri_custo_mes() (migration_077).

create or replace function public.puri_custo_mes_detalhe()
returns table (ambiente text, servico text, funcao text, chamadas bigint, custo_usd numeric, tem_estimado boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query
    select u.ambiente, u.servico, coalesce(u.funcao, 'sem_funcao'), count(*)::bigint,
           coalesce(sum(u.custo_usd), 0)::numeric, coalesce(bool_or(u.estimado), false)
    from public.puri_uso u
    where u.criado_em >= (date_trunc('month', now() at time zone 'America/Cuiaba') at time zone 'America/Cuiaba')
    group by u.ambiente, u.servico, coalesce(u.funcao, 'sem_funcao')
    order by u.ambiente, u.servico, 5 desc;
end $$;
revoke all on function public.puri_custo_mes_detalhe() from public, anon;
grant execute on function public.puri_custo_mes_detalhe() to authenticated;
