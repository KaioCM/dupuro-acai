-- Sessão de caixa (abrir/fechar). Vendas ficam amarradas à sessão aberta.
-- Aplicada via MCP; espelho. Ver 028b (sessão nas vendas) e 028c (resumo).
create table if not exists public.caixa_sessoes (
  id bigint generated always as identity primary key,
  atendente_id uuid references auth.users(id) on delete set null,
  status text not null default 'aberta' check (status in ('aberta','fechada')),
  fundo_troco numeric(12,2) not null default 0,
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz,
  dinheiro_contado numeric(12,2),
  dinheiro_esperado numeric(12,2),
  diferenca numeric(12,2),
  resumo jsonb,
  created_at timestamptz not null default now()
);
-- No máximo UMA sessão aberta no sistema por vez.
create unique index if not exists caixa_sessao_unica_aberta on public.caixa_sessoes (status) where status = 'aberta';

alter table public.orders add column if not exists caixa_sessao_id bigint references public.caixa_sessoes(id) on delete set null;
create index if not exists orders_caixa_sessao_idx on public.orders(caixa_sessao_id);

alter table public.caixa_sessoes enable row level security;
create policy caixa_sessoes_select on public.caixa_sessoes
  for select using (public.is_admin() or atendente_id = auth.uid());

create or replace function public.caixa_sessao_aberta()
returns table(id bigint, fundo_troco numeric, aberta_em timestamptz, atendente_id uuid)
language sql stable security definer set search_path = public as $$
  select id, fundo_troco, aberta_em, atendente_id from public.caixa_sessoes where status = 'aberta' limit 1;
$$;

create or replace function public.abrir_caixa(p_fundo numeric)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  if exists (select 1 from public.caixa_sessoes where status = 'aberta') then
    raise exception 'Já existe um caixa aberto.';
  end if;
  insert into public.caixa_sessoes (atendente_id, status, fundo_troco)
  values (auth.uid(), 'aberta', coalesce(p_fundo, 0)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fechar_caixa(p_sessao_id bigint, p_dinheiro_contado numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fundo numeric; v_total numeric; v_dinheiro numeric; v_qtd int; v_esperado numeric; v_dif numeric; v_por_forma jsonb; v_resumo jsonb;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  select fundo_troco into v_fundo from public.caixa_sessoes where id = p_sessao_id and status = 'aberta';
  if not found then raise exception 'Caixa não está aberto.'; end if;

  select coalesce(sum(valor), 0),
         coalesce(sum(valor) filter (where forma_pagamento = 'dinheiro'), 0),
         count(distinct numero)
    into v_total, v_dinheiro, v_qtd
    from public.orders where caixa_sessao_id = p_sessao_id and status <> 'cancelado';

  select coalesce(jsonb_object_agg(forma, s), '{}'::jsonb) into v_por_forma from (
    select coalesce(forma_pagamento, 'sem') as forma, sum(valor) as s
      from public.orders where caixa_sessao_id = p_sessao_id and status <> 'cancelado'
      group by coalesce(forma_pagamento, 'sem')
  ) t;

  v_esperado := v_fundo + v_dinheiro;
  v_dif := coalesce(p_dinheiro_contado, 0) - v_esperado;
  v_resumo := jsonb_build_object(
    'total', v_total, 'qtd', v_qtd, 'por_forma', v_por_forma,
    'fundo_troco', v_fundo, 'dinheiro_esperado', v_esperado,
    'dinheiro_contado', coalesce(p_dinheiro_contado, 0), 'diferenca', v_dif
  );

  update public.caixa_sessoes set status = 'fechada', fechada_em = now(),
    dinheiro_contado = p_dinheiro_contado, dinheiro_esperado = v_esperado,
    diferenca = v_dif, resumo = v_resumo
    where id = p_sessao_id;

  return v_resumo;
end;
$$;

grant execute on function public.caixa_sessao_aberta() to authenticated;
grant execute on function public.abrir_caixa(numeric) to authenticated;
grant execute on function public.fechar_caixa(bigint, numeric) to authenticated;
