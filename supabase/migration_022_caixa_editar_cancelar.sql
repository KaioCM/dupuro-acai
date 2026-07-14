-- ==========================================================================
-- Migration 022 — Caixa edita/cancela a venda do dia (com motivo obrigatório)
-- ==========================================================================
-- A atendente passa a poder CANCELAR ou EDITAR uma venda de loja, mas só as de
-- HOJE (fechamento do dia) e sempre com um motivo. Decisões do Kayo:
--   • "Excluir" = CANCELAR mantendo o registro: a venda vira status 'cancelado'
--     (some do total, mas continua na lista do dia com o motivo à vista) e o
--     estoque volta (o gatilho de estoque devolve ao sair de 'entregue').
--   • Alcance: só as vendas do próprio dia (admin pode qualquer data).
--
-- Tudo passa por funções security definer (não dá pra burlar pelo cliente): elas
-- checam papel + "é de hoje" e gravam auditoria. `order_audits` guarda o motivo
-- e o estado anterior de forma durável — o admin audita depois.
-- ==========================================================================

alter table public.orders
  add column if not exists cancel_motivo text;

-- Trilha de auditoria de alterações/cancelamentos de venda de loja.
create table if not exists public.order_audits (
  id bigint generated always as identity primary key,
  numero text not null,
  acao text not null check (acao in ('cancelou', 'editou')),
  motivo text not null,
  snapshot jsonb,                 -- estado anterior das linhas (antes da mudança)
  atendente_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.order_audits enable row level security;

-- Só o admin (dona) lê a trilha inteira. A atendente não precisa reler; a
-- gravação acontece dentro das funções security definer (ignoram RLS).
drop policy if exists "order_audits_select_admin" on public.order_audits;
create policy "order_audits_select_admin" on public.order_audits
  for select using (public.is_admin());

-- Quem pode mexer numa venda: admin (qualquer data) ou atendente, desde que
-- TODAS as linhas daquele número sejam de loja e do dia de hoje (fuso da loja).
create or replace function public.caixa_pode_mexer(p_numero text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.orders o where o.numero = p_numero and o.origem = 'loja'
    ) and (
      public.is_admin() or (
        public.is_atendente() and not exists (
          select 1 from public.orders o
          where o.numero = p_numero and o.origem = 'loja'
            and (o.created_at at time zone 'America/Cuiaba')::date
                <> (now() at time zone 'America/Cuiaba')::date
        )
      )
    );
$$;

-- Cancela a venda: marca as linhas como 'cancelado' (estoque volta pelo gatilho)
-- e registra o motivo na linha e na auditoria.
create or replace function public.caixa_cancelar_venda(p_numero text, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_snap jsonb;
begin
  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if not public.caixa_pode_mexer(p_numero) then
    raise exception 'Sem permissão para cancelar esta venda.';
  end if;

  select jsonb_agg(to_jsonb(o)) into v_snap
    from public.orders o where o.numero = p_numero and o.origem = 'loja';

  update public.orders
     set status = 'cancelado', cancel_motivo = p_motivo
   where numero = p_numero and origem = 'loja' and status <> 'cancelado';

  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'cancelou', p_motivo, v_snap, auth.uid());
end;
$$;

-- Substitui os itens da venda (edição): apaga as linhas atuais e recria a partir
-- de p_rows, mantendo o MESMO número. Roda numa transação só (atômico): o gatilho
-- devolve o estoque das linhas apagadas e consome o das novas. Guarda o estado
-- anterior + motivo na auditoria.
create or replace function public.caixa_substituir_venda(p_numero text, p_motivo text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_snap jsonb; r jsonb;
begin
  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Informe o motivo da alteração.';
  end if;
  if not public.caixa_pode_mexer(p_numero) then
    raise exception 'Sem permissão para editar esta venda.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'A venda precisa ter ao menos um item.';
  end if;

  select jsonb_agg(to_jsonb(o)) into v_snap
    from public.orders o where o.numero = p_numero and o.origem = 'loja';

  delete from public.orders where numero = p_numero and origem = 'loja';

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, detalhes, origem, atendente_id
    ) values (
      nullif(r->>'revendedor_id', '')::uuid,
      p_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens',
      (r->>'valor')::numeric,
      'entregue',
      nullif(r->>'produto_id', '')::bigint,
      nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''),
      coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      'loja',
      auth.uid()
    );
  end loop;

  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'editou', p_motivo, v_snap, auth.uid());
end;
$$;

grant execute on function public.caixa_pode_mexer(text) to authenticated;
grant execute on function public.caixa_cancelar_venda(text, text) to authenticated;
grant execute on function public.caixa_substituir_venda(text, text, jsonb) to authenticated;
