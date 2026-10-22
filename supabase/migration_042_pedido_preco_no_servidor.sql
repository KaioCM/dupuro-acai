-- migration_042: preço do pedido calculado no banco + travas menores do caixa.
--
-- FALHAS CORRIGIDAS (auditoria de 2026-10-22, todas provadas com transação
-- impersonando o papel e ROLLBACK, usando a conta revendedor-teste):
--
-- 1. criar_pedido_revendedor confiava no `valor` e no texto `itens` vindos do
--    navegador. Um revendedor aprovado criava, pela API, um pedido de R$ 0,01
--    com descrição "CAIXA FALSA x50" (quantidade real 1). Agora o banco calcula
--    valor = products.preco × quantidade e monta o texto do item.
-- 2. A policy orders_insert_self deixava o revendedor inserir direto em orders
--    escolhendo valor, origem ('loja'), forma de pagamento, caixa_sessao_id etc.
--    O painel não usa mais esse caminho (usa a função acima) → policy removida.
-- 3. sincronizar_venda_offline e caixa_substituir_venda aceitavam
--    usa_estoque=false para produto embalado → venda sem baixar estoque. Agora
--    usa_estoque segue a mesma regra da policy orders_insert_atendente
--    (só embalado baixa), que é o que o caixa.js já manda.
-- 4. orders_insert_atendente não amarrava atendente_id → atendente podia
--    registrar venda em nome de outro. Agora exige atendente_id = auth.uid().
-- 5. Revendedor conseguia trocar o próprio profiles.email (o admin vê esse
--    e-mail nas listas). Entra no trigger profiles_protege_controle.

-- 1 -------------------------------------------------------------------------
create or replace function public.criar_pedido_revendedor(p_rows jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_numero text;
  v_volume numeric;
  v_dispensa boolean;
  v_falta record;
  r jsonb;
  v_prod record;
  v_qtd int;
  v_sabor text;
begin
  if v_uid is null then
    raise exception 'Sem sessão ativa.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'aprovado' and role = 'revendedor'
  ) then
    raise exception 'Cadastro não aprovado para fazer pedidos.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    left join public.products p on p.id = (e->>'produto_id')::bigint
    where p.id is null
       or (e->>'quantidade')::int < 1
       or (e->>'quantidade')::int > 99
  ) then
    raise exception 'Item inválido no pedido.';
  end if;

  v_volume := public.volume_do_pedido(p_rows);
  v_dispensa := v_volume >= public.litros_dispensa_minimo();

  if not v_dispensa then
    select p.nome, p.pedido_minimo into v_falta
    from jsonb_array_elements(p_rows) e
    join public.products p on p.id = (e->>'produto_id')::bigint
    where (e->>'quantidade')::int < coalesce(p.pedido_minimo, 1)
    limit 1;
    if found then
      raise exception 'Pedido mínimo de % é % unidades.', v_falta.nome, v_falta.pedido_minimo;
    end if;
  end if;

  v_numero := public.next_pedido_numero();

  for r in select * from jsonb_array_elements(p_rows) loop
    select id, nome, preco into v_prod from public.products where id = (r->>'produto_id')::bigint;
    v_qtd := (r->>'quantidade')::int;
    v_sabor := nullif(r->>'sabor', '');
    -- Valor e descrição saem do catálogo, nunca do navegador. O texto segue o
    -- formato que o dashboard já montava: "Nome - Sabor x3".
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, origem
    ) values (
      v_uid, v_numero,
      (now() at time zone 'America/Cuiaba')::date,
      v_prod.nome || coalesce(' - ' || v_sabor, '') || ' x' || v_qtd,
      v_prod.preco * v_qtd, 'enviado',
      v_prod.id, v_qtd, v_sabor, true, 'revendedor'
    );
  end loop;

  return v_numero;
end;
$$;

-- 2 -------------------------------------------------------------------------
drop policy if exists "orders_insert_self" on public.orders;

-- 3 -------------------------------------------------------------------------
create or replace function public.sincronizar_venda_offline(p_rows jsonb, p_client_uuid uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
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
      nullif(r->>'sabor', ''),
      -- Mesma regra da policy orders_insert_atendente: só embalado baixa estoque.
      coalesce((select p.modo = 'embalado' from public.products p where p.id = nullif(r->>'produto_id', '')::bigint), false),
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

create or replace function public.caixa_substituir_venda(p_numero text, p_motivo text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
      -- Mesma regra da policy orders_insert_atendente: só embalado baixa estoque.
      coalesce((select p.modo = 'embalado' from public.products p where p.id = nullif(r->>'produto_id', '')::bigint), false),
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

-- 4 -------------------------------------------------------------------------
alter policy "orders_insert_atendente" on public.orders
  with check (
    is_atendente()
    and atendente_id = auth.uid()
    and origem = 'loja'
    and status = 'entregue'
    and usa_estoque = coalesce((select p.modo = 'embalado' from public.products p where p.id = orders.produto_id), false)
  );

-- 5 -------------------------------------------------------------------------
create or replace function public.profiles_protege_controle()
returns trigger
language plpgsql
-- security INVOKER de propósito: current_user precisa ser quem fez o update
-- (authenticated), não o dono da função. is_admin() já é definer por conta própria.
set search_path to 'public'
as $$
begin
  -- service_role (Edge Functions) e o próprio banco passam; usuário comum, só se for admin.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.created_at is distinct from old.created_at
     or new.conta_teste is distinct from old.conta_teste
     or new.email is distinct from old.email then
    raise exception 'Só um administrador pode mudar acesso, aprovação ou e-mail' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_protege_controle() from public, anon, authenticated;
