-- migration_037 — confirma pagamento de pedido do delivery e baixa o estoque.
-- Chamada só pela Edge Function do webhook do Mercado Pago (service role).
-- Idempotente: se o pedido já saiu de 'aguardando_pagamento', não baixa de novo.
-- Estoque baixa na linha DONA (estoque_ref) e por sabor nos multissabor; limita
-- em 0 pra respeitar a trava estoque>=0.
create or replace function public.delivery_confirmar_pagamento(
  p_codigo text, p_payment_id text, p_metodo text, p_mp_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.delivery_pedidos%rowtype; it jsonb; v_src bigint; v_qtd int;
begin
  select * into v from public.delivery_pedidos where codigo = p_codigo for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if v.status <> 'aguardando_pagamento' and v.status <> 'expirado' then
    update public.delivery_pedidos set mp_status = p_mp_status, atualizado_em = now() where id = v.id;
    return jsonb_build_object('ok', true, 'ja_processado', true, 'status', v.status);
  end if;
  for it in select * from jsonb_array_elements(v.itens) loop
    v_qtd := coalesce((it->>'quantidade')::int, 0);
    select coalesce(estoque_ref, id) into v_src from public.products where id = (it->>'produto_id')::bigint;
    if v_src is null then continue; end if;
    if coalesce(it->>'sabor', '') <> '' then
      update public.product_flavor_stock set estoque = greatest(estoque - v_qtd, 0)
       where produto_id = v_src and sabor = it->>'sabor';
    else
      update public.products set estoque = greatest(estoque - v_qtd, 0) where id = v_src;
    end if;
  end loop;
  update public.delivery_pedidos set status = 'pago', pago_em = now(), mp_payment_id = p_payment_id,
    pagamento_metodo = p_metodo, mp_status = p_mp_status, atualizado_em = now()
   where id = v.id;
  return jsonb_build_object('ok', true, 'status', 'pago', 'token', v.token);
end;
$$;
revoke all on function public.delivery_confirmar_pagamento(text, text, text, text) from public, anon, authenticated;
grant execute on function public.delivery_confirmar_pagamento(text, text, text, text) to service_role;
