-- ==========================================================================
-- migration_016 — Estoque só é consumido após a confirmação do admin
--
-- Antes: o gatilho orders_adjust_stock baixava estoque em TODO insert de
-- orders. Como o pedido do revendedor nasce com status 'enviado', o estoque
-- era consumido antes de qualquer análise do admin.
--
-- Agora: só 'processando' e 'entregue' consomem estoque. Um pedido 'enviado'
-- (aguardando confirmação) não mexe no estoque — apenas valida que havia
-- quantidade disponível no momento do pedido. Cancelar devolve o estoque.
--
-- Aplicada via MCP em 2026-07-09. Este arquivo é o espelho de referência.
-- ==========================================================================

create or replace function public.order_consumes_stock(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('processando', 'entregue');
$$;

create or replace function public.available_stock(p_produto_id bigint, p_sabor text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ref bigint; v_ref_sabor text; v_target bigint; v_sabor text;
  is_multi boolean; v_estoque int;
begin
  if p_produto_id is null then return 0; end if;
  select estoque_ref, estoque_ref_sabor into v_ref, v_ref_sabor
    from public.products where id = p_produto_id;
  v_target := coalesce(v_ref, p_produto_id);
  v_sabor := coalesce(v_ref_sabor, p_sabor);
  select multissabor into is_multi from public.products where id = v_target;
  if is_multi is true and v_sabor is not null then
    select estoque into v_estoque from public.product_flavor_stock
      where produto_id = v_target and sabor = v_sabor;
  else
    select estoque into v_estoque from public.products where id = v_target;
  end if;
  return coalesce(v_estoque, 0);
end;
$$;

create or replace function public.adjust_stock_on_order_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    if public.order_consumes_stock(new.status) then
      perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
    elsif new.status = 'enviado' then
      if public.available_stock(new.produto_id, new.sabor) < new.quantidade then
        raise exception 'Estoque insuficiente' using errcode = '23514';
      end if;
    end if;
    return new;

  elsif (tg_op = 'DELETE') then
    if public.order_consumes_stock(old.status) then
      perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    end if;
    return old;

  elsif (tg_op = 'UPDATE') then
    if public.order_consumes_stock(old.status) then
      perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    end if;
    if public.order_consumes_stock(new.status) then
      perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
    end if;
    return new;
  end if;
  return null;
end;
$$;

-- Correção de dados (roda uma única vez): os pedidos que, pela nova regra, NÃO
-- consomem estoque ('enviado'/'cancelado') já haviam baixado estoque pela regra
-- antiga. Devolve essas quantidades para não contar em dobro na confirmação.
do $$
declare r record;
begin
  for r in select produto_id, sabor, quantidade from public.orders
           where status in ('enviado', 'cancelado')
  loop
    perform public.apply_stock_delta(r.produto_id, r.sabor, r.quantidade);
  end loop;
end $$;
