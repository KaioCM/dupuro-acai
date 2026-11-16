-- migration_059 — "Delivery pago" era mentira pra pedido pago na entrega
-- O status 'pago' no delivery significa "confirmado / na fila da rota" (migration_049,
-- decisão do Kayo: vale na hora) — mas o trigger da migration_046 enqueueava o modelo
-- dupuro_delivery_pago ("Recebemos o pagamento do pedido DLV-…") e o aviso interno
-- "Delivery pago" em TODA confirmação, inclusive quando o cliente escolheu pagar na
-- entrega e o dinheiro ainda não entrou. Agora:
--   • online (pagar_na_entrega = false) → igual antes (cliente é avisado que recebeu);
--   • na entrega (pagar_na_entrega = true) → só o aviso interno, com o rótulo certo
--     ("Delivery confirmado (pagar na entrega)"); nenhum WhatsApp afirmando pagamento
--     recebido (o "saiu para entrega" e o "entregue" vêm depois de qualquer jeito).
-- Também limpa a fila: pedidos já enfileirados com o modelo errado saem dela.
create or replace function public.wa_delivery_evento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel text := case when new.aceita_whatsapp then public.wa_telefone(new.cliente_telefone) end;
  v_quando text := public.wa_quando(new.data_entrega, new.periodo);
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'pago' then
    if new.pagar_na_entrega then
      -- dinheiro ainda não entrou: nada de "recebemos o pagamento" pro cliente
      perform public.wa_aviso_interno('delivery:' || new.codigo, 'Delivery confirmado (pagar na entrega)',
        new.codigo || ' de ' || new.cliente_nome || ', ' || public.wa_brl(new.total) || ' a receber na entrega' || coalesce(', entrega ' || v_quando, ''),
        'delivery', new.codigo, 'pago');
    else
      perform public.wa_enfileirar('delivery_pago:' || new.codigo, 'dupuro_delivery_pago', v_tel,
        jsonb_build_array(initcap(split_part(trim(new.cliente_nome), ' ', 1)), new.codigo, coalesce(v_quando, 'no horário combinado')),
        'delivery', new.codigo, 'pago', interval '0', new.token::text);
      perform public.wa_aviso_interno('delivery:' || new.codigo, 'Delivery pago',
        new.codigo || ' de ' || new.cliente_nome || ', ' || public.wa_brl(new.total) || coalesce(', entrega ' || v_quando, ''),
        'delivery', new.codigo, 'pago');
    end if;
  elsif new.status = 'em_rota' then
    perform public.wa_enfileirar('delivery_saiu:' || new.codigo, 'dupuro_delivery_saiu', v_tel,
      jsonb_build_array(new.codigo), 'delivery', new.codigo, 'em_rota', interval '60 seconds', new.token::text);
  elsif new.status = 'entregue' then
    perform public.wa_enfileirar('delivery_entregue:' || new.codigo, 'dupuro_delivery_entregue', v_tel,
      jsonb_build_array(new.codigo), 'delivery', new.codigo, 'entregue', interval '60 seconds');
  end if;
  return new;
end;
$$;

-- o trigger já existe (migration_046); recriar a função basta. drop/create só por garantia:
drop trigger if exists wa_delivery_evento on public.delivery_pedidos;
create trigger wa_delivery_evento after update of status on public.delivery_pedidos
  for each row execute function public.wa_delivery_evento();

-- fila antiga: o que já foi enfileirado com a mentira "recebemos o pagamento" não deve sair
delete from public.whatsapp_envios
where modelo = 'dupuro_delivery_pago'
  and status in ('pendente', 'enviando', 'erro')
  and origem_ref in (select codigo from public.delivery_pedidos where pagar_na_entrega);
