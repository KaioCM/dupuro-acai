-- ==========================================================================
-- Dupuro Açaí — Migração 012: controle de estoque por produto
-- Aplicada diretamente via MCP do Supabase (não precisa rodar manualmente —
-- este arquivo é o registro do que foi aplicado).
--
-- Estoque é gerenciado exclusivamente pelo admin (aba Produtos). O cliente
-- não vê o número, só é impedido de pedir quando o estoque chega a 0.
-- Cada pedido criado/editado/excluído ajusta o estoque automaticamente via
-- trigger, para que a regra valha independente de quem/como o pedido é
-- criado (revendedor pelo dashboard ou admin pelo painel).
-- ==========================================================================

alter table public.products
  add column if not exists estoque integer not null default 0 check (estoque >= 0);

-- security definer: revendedores não têm permissão de update em products
-- (products_update_admin), mas precisam poder decrementar estoque ao criar
-- o próprio pedido. A trigger roda com os privilégios do dono da função,
-- contornando essa RLS apenas para o ajuste de estoque.
create or replace function public.adjust_stock_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if new.produto_id is not null and new.quantidade is not null then
      update public.products set estoque = estoque - new.quantidade where id = new.produto_id;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.produto_id is not null and old.quantidade is not null then
      update public.products set estoque = estoque + old.quantidade where id = old.produto_id;
    end if;
    return old;
  elsif (tg_op = 'UPDATE') then
    if old.produto_id is not null and old.quantidade is not null then
      update public.products set estoque = estoque + old.quantidade where id = old.produto_id;
    end if;
    if new.produto_id is not null and new.quantidade is not null then
      update public.products set estoque = estoque - new.quantidade where id = new.produto_id;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_adjust_stock on public.orders;
create trigger orders_adjust_stock
  after insert or update or delete on public.orders
  for each row execute function public.adjust_stock_on_order_change();
