-- migration_049 — Delivery: pagamento na entrega (2026-10-24)
--
-- Pedido do Kayo: além de pagar online (Pix/crédito pelo Mercado Pago), o
-- cliente pode pagar na entrega (dinheiro, débito, crédito ou Pix na
-- maquininha). Decisões: vale na hora (entra na rota e baixa o estoque como o
-- pago online); dinheiro pergunta se precisa de troco; o admin marca "Entregue
-- e recebido" escolhendo como recebeu (fica no pedido, separado do caixa da loja).
-- Status continua 'pago' = confirmado/na rota; quem diz se falta receber é
-- pagar_na_entrega + recebido_em.

alter table public.delivery_pedidos
  add column if not exists pagar_na_entrega boolean not null default false,
  add column if not exists forma_entrega text check (forma_entrega in ('dinheiro', 'debito', 'credito', 'pix')),
  add column if not exists troco_para numeric(10,2) check (troco_para is null or troco_para > 0),
  add column if not exists recebido_forma text check (recebido_forma in ('dinheiro', 'debito', 'credito', 'pix')),
  add column if not exists recebido_em timestamptz;

create or replace function public.delivery_rastreio(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', codigo, 'status', status, 'periodo', periodo, 'data_entrega', data_entrega,
    'cliente', split_part(cliente_nome, ' ', 1), 'itens', itens,
    'subtotal', subtotal, 'taxa', taxa, 'total', total,
    'na_entrega', pagar_na_entrega, 'forma_entrega', forma_entrega, 'troco_para', troco_para,
    'pago_em', pago_em, 'saiu_em', saiu_em, 'entregue_em', entregue_em, 'criado_em', criado_em)
  from public.delivery_pedidos where token = p_token;
$$;

-- Cancelar uma entrega já confirmada (trote, cliente desistiu): devolve o
-- estoque. Pedido pago online NÃO é estornado aqui — o admin devolve no MP.
create or replace function public.delivery_cancelar(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.delivery_pedidos%rowtype; it jsonb; v_src bigint; v_qtd int;
begin
  if not public.is_admin() then raise exception 'Sem permissão.'; end if;
  select * into v from public.delivery_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v.status not in ('pago', 'em_rota', 'aguardando_pagamento') then raise exception 'Esse pedido não pode mais ser cancelado.'; end if;
  if v.status in ('pago', 'em_rota') then
    for it in select * from jsonb_array_elements(v.itens) loop
      v_qtd := coalesce((it->>'quantidade')::int, 0);
      select coalesce(estoque_ref, id) into v_src from public.products where id = (it->>'produto_id')::bigint;
      if v_src is null then continue; end if;
      if coalesce(it->>'sabor', '') <> '' then
        update public.product_flavor_stock set estoque = estoque + v_qtd where produto_id = v_src and sabor = it->>'sabor';
      else
        update public.products set estoque = estoque + v_qtd where id = v_src;
      end if;
    end loop;
  end if;
  update public.delivery_pedidos set status = 'cancelado', atualizado_em = now() where id = v.id;
  return jsonb_build_object('ok', true, 'pago_online', v.status in ('pago', 'em_rota') and not v.pagar_na_entrega);
end $$;
revoke execute on function public.delivery_cancelar(bigint) from public, anon;
grant execute on function public.delivery_cancelar(bigint) to authenticated;
