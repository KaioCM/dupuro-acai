-- ==========================================================================
-- migration_032 — Pagamento dividido no caixa (pedido da atendente)
-- ==========================================================================
-- Uma venda pode ser paga em VÁRIAS formas (ex.: metade crédito, metade
-- dinheiro). Guardamos a divisão numa coluna `pagamentos` jsonb = lista de
-- {forma, valor} da VENDA inteira, repetida em cada linha (igual forma_pagamento
-- já é). `null` = pagamento simples (usa forma_pagamento). forma_pagamento
-- continua com a forma "principal" (maior valor) pra compatibilidade (tag,
-- relatórios antigos, tPag da NFC-e).
--
-- O ponto crítico é o fechamento do caixa: a "parte em dinheiro" de uma venda
-- dividida NÃO é o valor todo das linhas — é só a fatia em dinheiro. Um helper
-- explode `pagamentos` por venda (deduplicando por numero, já que ele se repete
-- por linha) e cai no forma_pagamento sobre o total quando a venda não tem
-- divisão (vendas antigas). resumo_caixa/fechar_caixa agregam sobre ele.
-- ==========================================================================

alter table public.orders add column if not exists pagamentos jsonb;

-- (forma, valor) de cada fatia de pagamento das vendas de uma sessão de caixa.
-- 1 linha por forma em vendas divididas; 1 linha (forma única, total) nas demais.
create or replace function public.caixa_formas_pagamento(p_sessao_id bigint)
returns table(forma text, valor numeric)
language sql stable security definer set search_path = public as $$
  with vendas as (
    select numero,
           max(forma_pagamento) as forma,
           (array_agg(pagamentos) filter (where pagamentos is not null))[1] as pagamentos,
           sum(valor) as total
      from public.orders
      where caixa_sessao_id = p_sessao_id and status <> 'cancelado'
      group by numero
  )
  select coalesce(p.forma, coalesce(v.forma, 'sem')) as forma,
         coalesce(p.valor, v.total) as valor
    from vendas v
    left join lateral (
      select el->>'forma' as forma, (el->>'valor')::numeric as valor
        from jsonb_array_elements(v.pagamentos) el
    ) p on true;
$$;

create or replace function public.fechar_caixa(p_sessao_id bigint, p_dinheiro_contado numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fundo numeric; v_total numeric; v_dinheiro numeric; v_qtd int; v_esperado numeric; v_dif numeric; v_por_forma jsonb; v_resumo jsonb;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  select fundo_troco into v_fundo from public.caixa_sessoes where id = p_sessao_id and status = 'aberta';
  if not found then raise exception 'Caixa não está aberto.'; end if;
  select coalesce(sum(valor), 0), count(distinct numero)
    into v_total, v_qtd
    from public.orders where caixa_sessao_id = p_sessao_id and status <> 'cancelado';
  select coalesce(sum(valor) filter (where forma = 'dinheiro'), 0)
    into v_dinheiro from public.caixa_formas_pagamento(p_sessao_id);
  select coalesce(jsonb_object_agg(forma, s), '{}'::jsonb) into v_por_forma from (
    select forma, sum(valor) as s from public.caixa_formas_pagamento(p_sessao_id) group by forma
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

create or replace function public.resumo_caixa(p_sessao_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_fundo numeric; v_total numeric; v_dinheiro numeric; v_qtd int; v_por_forma jsonb;
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
  return jsonb_build_object(
    'total', v_total, 'qtd', v_qtd, 'por_forma', v_por_forma,
    'fundo_troco', coalesce(v_fundo, 0), 'dinheiro_esperado', coalesce(v_fundo, 0) + v_dinheiro
  );
end;
$$;

grant execute on function public.caixa_formas_pagamento(bigint) to authenticated;
grant execute on function public.fechar_caixa(bigint, numeric) to authenticated;
grant execute on function public.resumo_caixa(bigint) to authenticated;

-- ---------- Edição/sync carregam a divisão ----------
-- caixa_substituir_venda: reinsere as linhas; passa a levar `pagamentos` (mesma
-- lista repetida por linha, como forma_pagamento).
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
      produto_id, quantidade, sabor, usa_estoque, detalhes, forma_pagamento, pagamentos, caixa_sessao_id, origem, atendente_id
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
      v_sessao,
      'loja', auth.uid()
    );
  end loop;
  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'editou', p_motivo, v_snap, auth.uid());
end;
$$;

-- sincronizar_venda_offline: idem, carrega `pagamentos` das vendas divididas
-- feitas offline.
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
      forma_pagamento, pagamentos, caixa_sessao_id, origem, atendente_id, client_uuid
    ) values (
      nullif(r->>'revendedor_id', '')::uuid, v_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint, nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''), coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      nullif(r->>'forma_pagamento', ''),
      case when r ? 'pagamentos' and jsonb_typeof(r->'pagamentos') = 'array' then r->'pagamentos' else null end,
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
