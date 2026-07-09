-- ==========================================================================
-- Dupuro Açaí — Migração 015: estoque compartilhado varejo/atacado
-- Aplicada diretamente via MCP do Supabase (este arquivo é o registro).
--
-- Um produto pode "puxar" o estoque de outro (o dono). Assim atacado e varejo
-- do mesmo item usam o MESMO estoque, mesmo com preços/pedido mínimo diferentes.
--   estoque_ref        -> id do produto dono do estoque (varejo).
--   estoque_ref_sabor  -> quando o produto que puxa NÃO é multissabor mas o dono
--                         é, fixa qual sabor do dono ele consome.
-- Vínculos aplicados (podem mudar por produto conforme o catálogo evoluir):
--   13->21, 14->22, 15->23, 18->19, 4->24, 16->24 (sabor 'Açaí').
-- ==========================================================================

alter table public.products
  add column if not exists estoque_ref bigint references public.products(id) on delete set null,
  add column if not exists estoque_ref_sabor text;

update public.products set estoque_ref = 21 where id = 13;
update public.products set estoque_ref = 22 where id = 14;
update public.products set estoque_ref = 23 where id = 15;
update public.products set estoque_ref = 19 where id = 18;
update public.products set estoque_ref = 24 where id = 4;
update public.products set estoque_ref = 24, estoque_ref_sabor = 'Açaí' where id = 16;

-- Estoque por sabor que ficou nos produtos que agora puxam de outro vira lixo
-- (o estoque real vive no dono). Remove pra evitar confusão.
delete from public.product_flavor_stock
where produto_id in (select id from public.products where estoque_ref is not null);

create or replace function public.apply_stock_delta(p_produto_id bigint, p_sabor text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref bigint;
  v_ref_sabor text;
  v_target bigint;
  v_sabor text;
  is_multi boolean;
begin
  if p_produto_id is null or p_delta is null then return; end if;
  select estoque_ref, estoque_ref_sabor into v_ref, v_ref_sabor from public.products where id = p_produto_id;
  v_target := coalesce(v_ref, p_produto_id);
  v_sabor := coalesce(v_ref_sabor, p_sabor);
  select multissabor into is_multi from public.products where id = v_target;
  if is_multi is true and v_sabor is not null then
    update public.product_flavor_stock set estoque = estoque + p_delta
      where produto_id = v_target and sabor = v_sabor;
    if not found and p_delta < 0 then
      raise exception 'Sem estoque para o sabor %', v_sabor using errcode = '23514';
    end if;
  else
    update public.products set estoque = estoque + p_delta where id = v_target;
  end if;
end;
$$;
