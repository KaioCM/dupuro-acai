-- migration_040: registrar uma leva de produção SOMA no estoque (por sabor).
--
-- Antes a leva só guardava custo (producoes / producao_gastos / producao_itens)
-- e o estoque tinha de ser lançado de novo à mão em Produtos. Agora:
--   * producao_itens ganha a coluna sabor (obrigatória pra produto multissabor);
--   * salvar_producao grava cabeçalho + gastos + itens numa transação só e aplica
--     no estoque só a DIFERENÇA entre os itens novos e os antigos (editar 40 → 42
--     soma 2, mesmo que parte das 40 já tenha sido vendida);
--   * excluir_producao tira do estoque o que a leva tinha somado. Se esse estoque
--     já foi vendido, o CHECK estoque >= 0 recusa e nada é apagado.
-- Só produto 'embalado' tem estoque por unidade; copo/peso ficam de fora.

alter table public.producao_itens add column if not exists sabor text;

-- Diferença de estoque entre dois conjuntos de itens, aplicada em ordem fixa
-- (produto, sabor) pra duas gravações simultâneas nunca travarem uma à outra.
create or replace function public.producao_aplicar_delta(p_antes jsonb, p_depois jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  for r in
    select x.produto_id, x.sabor, sum(x.qtd)::int as delta
    from (
      select (e->>'produto_id')::bigint as produto_id, nullif(e->>'sabor', '') as sabor,
             -round(coalesce((e->>'quantidade')::numeric, 0)) as qtd
        from jsonb_array_elements(coalesce(p_antes, '[]'::jsonb)) e
      union all
      select (e->>'produto_id')::bigint, nullif(e->>'sabor', ''),
             round(coalesce((e->>'quantidade')::numeric, 0))
        from jsonb_array_elements(coalesce(p_depois, '[]'::jsonb)) e
    ) x
    join public.products p on p.id = x.produto_id and p.modo = 'embalado'
    group by x.produto_id, x.sabor
    having sum(x.qtd) <> 0
    order by x.produto_id, x.sabor nulls first
  loop
    -- Sabor que ainda não tem linha de estoque: cria com 0, senão a soma se perde
    -- (apply_stock_delta só atualiza linhas existentes).
    if r.delta > 0 and r.sabor is not null then
      insert into public.product_flavor_stock (produto_id, sabor, estoque)
      select coalesce(p.estoque_ref, p.id), r.sabor, 0
        from public.products p
        join public.products alvo on alvo.id = coalesce(p.estoque_ref, p.id) and alvo.multissabor
       where p.id = r.produto_id and p.estoque_ref_sabor is null
      on conflict (produto_id, sabor) do nothing;
    end if;
    perform public.apply_stock_delta(r.produto_id, r.sabor, r.delta);
  end loop;
end;
$$;

-- p_itens = [{ produto_id, produto_nome, sabor, quantidade, litros_unit }]
-- p_gastos = [{ descricao, categoria, valor }]
create or replace function public.salvar_producao(p_id bigint, p_header jsonb, p_gastos jsonb, p_itens jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint := p_id;
  v_antes jsonb;
  v_faltando text;
begin
  if not public.is_admin() then
    raise exception 'Só admin registra produção' using errcode = '42501';
  end if;

  -- Produto multissabor precisa do sabor: é ele que diz qual estoque sobe.
  select string_agg(distinct p.nome, ', ') into v_faltando
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
    join public.products p on p.id = (e->>'produto_id')::bigint
   where p.multissabor and p.estoque_ref_sabor is null and nullif(e->>'sabor', '') is null;
  if v_faltando is not null then
    raise exception 'Escolha o sabor de: %', v_faltando using errcode = '23514';
  end if;

  if v_id is null then
    insert into public.producoes (data, rotulo, observacao)
    values (nullif(p_header->>'data', '')::date, nullif(p_header->>'rotulo', ''), nullif(p_header->>'observacao', ''))
    returning id into v_id;
    v_antes := '[]'::jsonb;
  else
    update public.producoes
       set data = nullif(p_header->>'data', '')::date,
           rotulo = nullif(p_header->>'rotulo', ''),
           observacao = nullif(p_header->>'observacao', '')
     where id = v_id;
    if not found then raise exception 'Leva % não existe', v_id using errcode = 'P0002'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'sabor', sabor, 'quantidade', quantidade)), '[]'::jsonb)
      into v_antes from public.producao_itens where producao_id = v_id;
    delete from public.producao_gastos where producao_id = v_id;
    delete from public.producao_itens where producao_id = v_id;
  end if;

  insert into public.producao_gastos (producao_id, descricao, categoria, valor)
  select v_id, nullif(e->>'descricao', ''), e->>'categoria', coalesce((e->>'valor')::numeric, 0)
    from jsonb_array_elements(coalesce(p_gastos, '[]'::jsonb)) e;

  insert into public.producao_itens (producao_id, produto_id, produto_nome, sabor, quantidade, litros_unit)
  select v_id, (e->>'produto_id')::bigint, nullif(e->>'produto_nome', ''), nullif(e->>'sabor', ''),
         coalesce((e->>'quantidade')::numeric, 0), coalesce((e->>'litros_unit')::numeric, 0)
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e;

  perform public.producao_aplicar_delta(v_antes, p_itens);
  return v_id;
end;
$$;

create or replace function public.excluir_producao(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_antes jsonb;
begin
  if not public.is_admin() then
    raise exception 'Só admin apaga produção' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'sabor', sabor, 'quantidade', quantidade)), '[]'::jsonb)
    into v_antes from public.producao_itens where producao_id = p_id;
  perform public.producao_aplicar_delta(v_antes, '[]'::jsonb);
  delete from public.producoes where id = p_id; -- gastos e itens saem em cascata
end;
$$;

-- Só o admin logado chama as duas de fora; a de delta é interna.
revoke execute on function public.producao_aplicar_delta(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.salvar_producao(bigint, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.excluir_producao(bigint) from public, anon;
grant execute on function public.salvar_producao(bigint, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.excluir_producao(bigint) to authenticated;
