-- Migração 071 — wrapper público do pedido do revendedor não aceita campos do Mercado Pago
--
-- PROBLEMA: public.criar_pedido_revendedor(p_rows, p_entrega) é executável por `authenticated` (chamado pelo
--   navegador) e repassava p_entrega inteiro para criar_pedido_revendedor_para. Ele recusava
--   pagamento = 'online', mas deixava passar `mp_payment_id` e `pago_metodo`. Dentro de
--   criar_pedido_revendedor_para, a presença de mp_payment_id (a) aceita cotação de entrega expirada,
--   (b) pula a trava turno_lotado e (c) grava mp_payment_id/pago_metodo em entrega_info (dado falso de
--   pagamento). Só o caminho do Mercado Pago (revenda_confirmar_checkout, service_role) pode mandar esses campos.
--
-- CORREÇÃO: o wrapper descarta 'mp_payment_id' e 'pago_metodo' de p_entrega antes de repassar. Resto idêntico
--   ao corpo vivo (inclusive a recusa de 'online'). p_entrega null segue null (a função interna já recusa).
--   revenda_iniciar_checkout (também executável por authenticated) já remove essas chaves; não muda.
--
-- Pré-requisito: migration_070 aplicada.

create or replace function public.criar_pedido_revendedor(p_rows jsonb, p_entrega jsonb default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(p_entrega->>'pagamento', '') = 'online' then raise exception 'Pagamento online começa pelo botão Pagar agora.'; end if;
  if p_entrega is not null and jsonb_typeof(p_entrega) = 'object' then
    p_entrega := p_entrega - 'mp_payment_id' - 'pago_metodo';
  end if;
  return public.criar_pedido_revendedor_para(auth.uid(), p_rows, p_entrega);
end $function$;

revoke all on function public.criar_pedido_revendedor(jsonb, jsonb) from public, anon;
grant execute on function public.criar_pedido_revendedor(jsonb, jsonb) to authenticated, service_role;
