-- migration_075: pedido minimo do delivery (R$ 20 em produtos, sem taxa de entrega).
-- Idempotente: so seta se a chave ainda nao existir (o valor pode ser mudado depois).
-- Checado na Edge delivery-checkout (antes do cupom) e avisado no front (delivery/pedido.html).
update delivery_config
   set config = jsonb_set(config, '{pedido_minimo_delivery}', '20'::jsonb, true)
 where id = 1 and not (config ? 'pedido_minimo_delivery');
