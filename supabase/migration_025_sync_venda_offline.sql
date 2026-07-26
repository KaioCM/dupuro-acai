-- Sincronização de vendas feitas offline (app da loja). Aplicada via MCP; este
-- arquivo é o espelho. Ver também migration_026 (clamp do estoque em 0).

-- 1) client_uuid: id gerado no cliente, torna o reenvio da sync idempotente.
alter table public.orders add column if not exists client_uuid uuid;
create unique index if not exists orders_client_uuid_key on public.orders(client_uuid) where client_uuid is not null;

-- 2) RPC de sync: numera com VND real, insere as linhas (origem loja/entregue) e
-- é idempotente pelo client_uuid. security definer (checa papel dentro).
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
      origem, atendente_id, client_uuid
    ) values (
      nullif(r->>'revendedor_id', '')::uuid, v_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint, nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''), coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      'loja', auth.uid(),
      case when v_primeira then p_client_uuid else null end
    );
    v_primeira := false;
  end loop;
  return v_numero;
end;
$$;
grant execute on function public.sincronizar_venda_offline(jsonb, uuid) to authenticated;
