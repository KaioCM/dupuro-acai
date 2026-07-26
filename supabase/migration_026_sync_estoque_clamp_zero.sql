-- Decisão do Kayo: manter a trava estoque >= 0. Na sincronização de venda
-- offline (flag dupuro.sync_offline='on'), o estoque é LIMITADO em 0 em vez de
-- ir a negativo — a venda é registrada, mas o estoque fica "otimista". Fora do
-- sync (flag off), comportamento idêntico ao de hoje (venda ONLINE do balcão
-- sem estoque continua bloqueada pela trava). Aplicada via MCP; espelho.
create or replace function public.apply_stock_delta(p_produto_id bigint, p_sabor text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref bigint;
  v_ref_sabor text;
  v_target bigint;
  v_sabor text;
  is_multi boolean;
  v_sync boolean := coalesce(current_setting('dupuro.sync_offline', true), 'off') = 'on';
begin
  if p_produto_id is null or p_delta is null then return; end if;
  select estoque_ref, estoque_ref_sabor into v_ref, v_ref_sabor from public.products where id = p_produto_id;
  v_target := coalesce(v_ref, p_produto_id);
  v_sabor := coalesce(v_ref_sabor, p_sabor);
  select multissabor into is_multi from public.products where id = v_target;
  if is_multi is true and v_sabor is not null then
    if v_sync then
      update public.product_flavor_stock set estoque = greatest(0, estoque + p_delta)
        where produto_id = v_target and sabor = v_sabor;
    else
      update public.product_flavor_stock set estoque = estoque + p_delta
        where produto_id = v_target and sabor = v_sabor;
      if not found and p_delta < 0 then
        raise exception 'Sem estoque para o sabor %', v_sabor using errcode = '23514';
      end if;
    end if;
  else
    if v_sync then
      update public.products set estoque = greatest(0, estoque + p_delta) where id = v_target;
    else
      update public.products set estoque = estoque + p_delta where id = v_target;
    end if;
  end if;
end;
$$;
