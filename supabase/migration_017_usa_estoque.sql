-- ==========================================================================
-- migration_017 — "Utilizar estoque?" no lançamento de pedidos do admin
--
-- Com usa_estoque = false, o pedido NÃO valida disponibilidade nem altera o
-- estoque em nenhum momento (criação, mudança de status ou exclusão). Serve
-- para lançar pedidos antigos de produtos que hoje estão esgotados.
--
-- Padrão true: comportamento normal (ver migration_016). O revendedor não pode
-- usar false — a policy orders_insert_self obriga usa_estoque = true.
--
-- Aplicada via MCP em 2026-07-10. Este arquivo é o espelho de referência.
-- ==========================================================================

alter table public.orders
  add column if not exists usa_estoque boolean not null default true;

drop policy if exists "orders_insert_self" on public.orders;
create policy "orders_insert_self" on public.orders
  for insert with check (
    auth.uid() = revendedor_id
    and status = 'enviado'
    and usa_estoque = true
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
    and quantidade >= coalesce((select pedido_minimo from public.products where id = produto_id), 1)
  );

create or replace function public.adjust_stock_on_order_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    if new.usa_estoque then
      if public.order_consumes_stock(new.status) then
        perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
      elsif new.status = 'enviado' then
        if public.available_stock(new.produto_id, new.sabor) < new.quantidade then
          raise exception 'Estoque insuficiente' using errcode = '23514';
        end if;
      end if;
    end if;
    return new;

  elsif (tg_op = 'DELETE') then
    if old.usa_estoque and public.order_consumes_stock(old.status) then
      perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    end if;
    return old;

  elsif (tg_op = 'UPDATE') then
    if old.usa_estoque and public.order_consumes_stock(old.status) then
      perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    end if;
    if new.usa_estoque and public.order_consumes_stock(new.status) then
      perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
    end if;
    return new;
  end if;
  return null;
end;
$$;
