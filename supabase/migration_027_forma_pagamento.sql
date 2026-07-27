-- Forma de pagamento da venda (dinheiro/débito/crédito/pix). Aplicada via MCP;
-- espelho. Fica em cada linha da venda (mesmo numero), como os outros campos de
-- cabeçalho. Detalhe do TEF (nsu/autorização) do cartão integrado vai, quando
-- houver, em orders.detalhes.pagamento (não persistido enquanto o TEF é manual/simulação).
alter table public.orders add column if not exists forma_pagamento text
  check (forma_pagamento in ('dinheiro','debito','credito','pix'));

-- A RPC de sync offline passa a carregar a forma_pagamento das linhas.
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
      forma_pagamento, origem, atendente_id, client_uuid
    ) values (
      nullif(r->>'revendedor_id', '')::uuid, v_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint, nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''), coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      nullif(r->>'forma_pagamento', ''),
      'loja', auth.uid(),
      case when v_primeira then p_client_uuid else null end
    );
    v_primeira := false;
  end loop;
  return v_numero;
end;
$$;

-- Editar venda (caixa_substituir_venda) também carrega a forma_pagamento.
create or replace function public.caixa_substituir_venda(p_numero text, p_motivo text, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
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
      produto_id, quantidade, sabor, usa_estoque, detalhes, forma_pagamento, origem, atendente_id
    ) values (
      nullif(r->>'revendedor_id', '')::uuid, p_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint, nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''), coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      nullif(r->>'forma_pagamento', ''),
      'loja', auth.uid()
    );
  end loop;

  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'editou', p_motivo, v_snap, auth.uid());
end;
$$;