-- migration_048 — Retirada e reforço de dinheiro no caixa (2026-10-24)
--
-- Pedido do Kayo: com o caixa aberto as meninas tiram dinheiro pra ir ao mercado
-- (banana, algo em falta) e a conta quebrava no fechamento. Agora:
--   retirada  = dinheiro que saiu da gaveta (categoria + observação obrigatórias);
--               quem volta com troco registra a devolução NA MESMA retirada;
--   reforco   = dinheiro que entrou na gaveta (ex.: mais troco no meio do dia).
-- O dinheiro esperado no fechamento = fundo + vendas em dinheiro + reforços
-- − (retiradas − troco devolvido). Atendente faz sozinha; tudo fica gravado
-- (quem, quando) e o admin vê. Só com o caixa aberto e com internet.

create table if not exists public.caixa_movimentos (
  id bigint generated always as identity primary key,
  sessao_id bigint not null references public.caixa_sessoes(id),
  tipo text not null check (tipo in ('retirada', 'reforco')),
  categoria text not null check (categoria in ('compra_loja', 'fornecedor', 'dono', 'troco', 'outro')),
  observacao text not null check (length(btrim(observacao)) between 2 and 200 and observacao !~ '[<>]'),
  valor numeric(10,2) not null check (valor > 0),
  devolvido numeric(10,2) not null default 0 check (devolvido >= 0 and devolvido <= valor),
  devolvido_em timestamptz,
  atendente_id uuid not null default auth.uid() references public.profiles(id),
  criado_em timestamptz not null default now(),
  anulado_em timestamptz,
  check (tipo = 'retirada' or devolvido = 0)
);
create index if not exists caixa_movimentos_sessao on public.caixa_movimentos (sessao_id);
alter table public.caixa_movimentos enable row level security;
create policy caixa_movimentos_select on public.caixa_movimentos for select to authenticated
  using ((select public.is_atendente()) or (select public.is_admin()));
-- Escrita só pelas funções abaixo (conferem caixa aberto e papel).

create or replace function public.caixa_movimentar(p_tipo text, p_valor numeric, p_categoria text, p_obs text)
returns public.caixa_movimentos language plpgsql security definer set search_path = public as $$
declare v_sessao bigint; v_row public.caixa_movimentos;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  select id into v_sessao from public.caixa_sessoes where status = 'aberta' limit 1;
  if v_sessao is null then raise exception 'Abra o caixa antes de mexer no dinheiro.'; end if;
  if p_tipo = 'reforco' then p_categoria := coalesce(p_categoria, 'troco'); end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if length(btrim(coalesce(p_obs, ''))) < 2 then raise exception 'Escreva o motivo (ex.: banana no mercado).'; end if;
  insert into public.caixa_movimentos (sessao_id, tipo, categoria, observacao, valor)
  values (v_sessao, p_tipo, p_categoria, btrim(p_obs), round(p_valor, 2)) returning * into v_row;
  return v_row;
end $$;

-- Troco devolvido de uma retirada (valor total devolvido, pode corrigir).
create or replace function public.caixa_devolver_troco(p_id bigint, p_devolvido numeric)
returns public.caixa_movimentos language plpgsql security definer set search_path = public as $$
declare v_row public.caixa_movimentos;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  select m.* into v_row from public.caixa_movimentos m join public.caixa_sessoes s on s.id = m.sessao_id
   where m.id = p_id and m.tipo = 'retirada' and m.anulado_em is null and s.status = 'aberta' for update of m;
  if not found then raise exception 'Essa retirada não está mais no caixa aberto.'; end if;
  if coalesce(p_devolvido, -1) < 0 or p_devolvido > v_row.valor then raise exception 'O troco devolvido vai de R$ 0 até o valor retirado.'; end if;
  update public.caixa_movimentos set devolvido = round(p_devolvido, 2), devolvido_em = case when p_devolvido > 0 then now() end
   where id = p_id returning * into v_row;
  return v_row;
end $$;

-- Lançou errado: anula (some da conta, fica no histórico).
create or replace function public.caixa_anular_movimento(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  update public.caixa_movimentos m set anulado_em = now()
    from public.caixa_sessoes s
   where m.id = p_id and s.id = m.sessao_id and s.status = 'aberta' and m.anulado_em is null;
  if not found then raise exception 'Esse lançamento não está mais no caixa aberto.'; end if;
end $$;

-- Soma da sessão: retiradas líquidas (já sem o troco devolvido) e reforços.
create or replace function public.caixa_movimentos_resumo(p_sessao_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'retiradas', coalesce(sum(valor - devolvido) filter (where tipo = 'retirada'), 0),
    'reforcos', coalesce(sum(valor) filter (where tipo = 'reforco'), 0),
    'movimentos', coalesce(jsonb_agg(jsonb_build_object(
        'tipo', tipo, 'categoria', categoria, 'observacao', observacao, 'valor', valor,
        'devolvido', devolvido, 'criado_em', criado_em) order by criado_em), '[]'::jsonb))
  from public.caixa_movimentos where sessao_id = p_sessao_id and anulado_em is null;
$$;

create or replace function public.resumo_caixa(p_sessao_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_fundo numeric; v_total numeric; v_dinheiro numeric; v_qtd int; v_por_forma jsonb; v_mov jsonb;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  select fundo_troco into v_fundo from public.caixa_sessoes where id = p_sessao_id;
  select coalesce(sum(valor), 0), count(distinct numero)
    into v_total, v_qtd
    from public.orders where caixa_sessao_id = p_sessao_id and status <> 'cancelado';
  select coalesce(sum(valor) filter (where forma = 'dinheiro'), 0)
    into v_dinheiro from public.caixa_formas_pagamento(p_sessao_id);
  select coalesce(jsonb_object_agg(forma, s), '{}'::jsonb) into v_por_forma from (
    select forma, sum(valor) as s from public.caixa_formas_pagamento(p_sessao_id) group by forma
  ) t;
  v_mov := public.caixa_movimentos_resumo(p_sessao_id);
  return jsonb_build_object(
    'total', v_total, 'qtd', v_qtd, 'por_forma', v_por_forma,
    'fundo_troco', coalesce(v_fundo, 0),
    'retiradas', (v_mov->>'retiradas')::numeric, 'reforcos', (v_mov->>'reforcos')::numeric, 'movimentos', v_mov->'movimentos',
    'dinheiro_esperado', coalesce(v_fundo, 0) + v_dinheiro + (v_mov->>'reforcos')::numeric - (v_mov->>'retiradas')::numeric
  );
end $$;

create or replace function public.fechar_caixa(p_sessao_id bigint, p_dinheiro_contado numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fundo numeric; v_resumo jsonb; v_esperado numeric; v_dif numeric;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  select fundo_troco into v_fundo from public.caixa_sessoes where id = p_sessao_id and status = 'aberta' for update;
  if not found then raise exception 'Caixa não está aberto.'; end if;
  v_resumo := public.resumo_caixa(p_sessao_id);
  v_esperado := (v_resumo->>'dinheiro_esperado')::numeric;
  v_dif := coalesce(p_dinheiro_contado, 0) - v_esperado;
  v_resumo := v_resumo || jsonb_build_object('dinheiro_contado', coalesce(p_dinheiro_contado, 0), 'diferenca', v_dif);
  update public.caixa_sessoes set status = 'fechada', fechada_em = now(),
    dinheiro_contado = p_dinheiro_contado, dinheiro_esperado = v_esperado,
    diferenca = v_dif, resumo = v_resumo
    where id = p_sessao_id;
  return v_resumo;
end $$;

revoke execute on function public.caixa_movimentos_resumo(bigint) from public, anon, authenticated;
revoke execute on function public.caixa_movimentar(text, numeric, text, text) from public, anon;
revoke execute on function public.caixa_devolver_troco(bigint, numeric) from public, anon;
revoke execute on function public.caixa_anular_movimento(bigint) from public, anon;
grant execute on function public.caixa_movimentar(text, numeric, text, text) to authenticated;
grant execute on function public.caixa_devolver_troco(bigint, numeric) to authenticated;
grant execute on function public.caixa_anular_movimento(bigint) to authenticated;
