-- ==========================================================================
-- migration_033 — Taxa de entrega + marcar venda como entrega (pedido atendente)
-- ==========================================================================
-- A atendente marca uma venda como ENTREGA (delivery) e informa a taxa de
-- entrega, digitada na hora. Decisões do Kayo:
--  - a taxa entra como uma LINHA na venda (produto_id null, itens
--    'Taxa de entrega', usa_estoque false) → soma no total naturalmente e
--    aparece na comanda/relatório sem tratamento especial;
--  - a venda guarda um flag `entrega` + `entrega_info` jsonb ({nome, endereco})
--    pra organizar as entregas depois (entrega pode existir com taxa 0 = frete
--    grátis, por isso o flag é independente da linha de taxa).
--
-- A linha de taxa não tem produto. A policy orders_insert_atendente amarrava
-- usa_estoque ao modo do produto e caía em `true` quando não havia produto —
-- o que BARRARIA a linha de taxa (ela é usa_estoque false). Trocamos o default
-- do coalesce pra `false`: linha sem produto exige usa_estoque false (serviço),
-- linha de produto segue amarrada ao modo. Não muda nada nas vendas de produto
-- (elas sempre têm produto_id).
-- ==========================================================================

alter table public.orders add column if not exists entrega boolean not null default false;
alter table public.orders add column if not exists entrega_info jsonb;

drop policy if exists "orders_insert_atendente" on public.orders;
create policy "orders_insert_atendente" on public.orders
  for insert with check (
    public.is_atendente()
    and origem = 'loja'
    and status = 'entregue'
    and usa_estoque = coalesce(
      (select p.modo = 'embalado' from public.products p where p.id = produto_id),
      false
    )
  );

-- Edição e sync carregam o flag de entrega + info.
create or replace function public.caixa_substituir_venda(p_numero text, p_motivo text, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_snap jsonb; v_sessao bigint; r jsonb;
begin
  if not public.caixa_pode_mexer(p_numero) then
    raise exception 'Sem permissão para editar esta venda.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'A venda precisa ter ao menos um item.';
  end if;
  select jsonb_agg(to_jsonb(o)) into v_snap
    from public.orders o where o.numero = p_numero and o.origem = 'loja';
  select caixa_sessao_id into v_sessao
    from public.orders where numero = p_numero and origem = 'loja' limit 1;
  delete from public.orders where numero = p_numero and origem = 'loja';
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, detalhes, forma_pagamento, pagamentos,
      entrega, entrega_info, caixa_sessao_id, origem, atendente_id
    ) values (
      nullif(r->>'revendedor_id', '')::uuid,
      p_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint,
      nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''),
      coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      nullif(r->>'forma_pagamento', ''),
      case when r ? 'pagamentos' and jsonb_typeof(r->'pagamentos') = 'array' then r->'pagamentos' else null end,
      coalesce((r->>'entrega')::boolean, false),
      case when r ? 'entrega_info' and jsonb_typeof(r->'entrega_info') = 'object' then r->'entrega_info' else null end,
      v_sessao,
      'loja', auth.uid()
    );
  end loop;
  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'editou', p_motivo, v_snap, auth.uid());
end;
$$;

create or replace function public.sincronizar_venda_offline(p_rows jsonb, p_client_uuid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_numero text; v_existente text; r jsonb; v_primeira boolean := true;
begin
  if not (public.is_atendente() or public.is_admin()) then
    raise exception 'Sem permissão para sincronizar vendas.';
  end if;
  if p_client_uuid is null then raise exception 'client_uuid obrigatório.'; end if;
  select numero into v_existente from public.orders where client_uuid = p_client_uuid limit 1;
  if v_existente is not null then return v_existente; end if;

  perform set_config('dupuro.sync_offline', 'on', true);
  v_numero := public.next_venda_numero();
  for r in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, detalhes,
      forma_pagamento, pagamentos, entrega, entrega_info, caixa_sessao_id, origem, atendente_id, client_uuid
    ) values (
      nullif(r->>'revendedor_id', '')::uuid, v_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint, nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''), coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      nullif(r->>'forma_pagamento', ''),
      case when r ? 'pagamentos' and jsonb_typeof(r->'pagamentos') = 'array' then r->'pagamentos' else null end,
      coalesce((r->>'entrega')::boolean, false),
      case when r ? 'entrega_info' and jsonb_typeof(r->'entrega_info') = 'object' then r->'entrega_info' else null end,
      nullif(r->>'caixa_sessao_id', '')::bigint,
      'loja', auth.uid(),
      case when v_primeira then p_client_uuid else null end
    );
    v_primeira := false;
  end loop;
  return v_numero;
end;
$$;
grant execute on function public.sincronizar_venda_offline(jsonb, uuid) to authenticated;
