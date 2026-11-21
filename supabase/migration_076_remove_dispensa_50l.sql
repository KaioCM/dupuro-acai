-- migration_076: remove a regra antiga "50 L dispensa o mínimo".
-- A regra de 50 L foi substituída pela de 30 L (litros_minimo_pedido) na migration_070;
-- a chave app_settings 'litros_dispensa_minimo' e a função litros_dispensa_minimo()
-- ficaram órfãs (nenhuma outra função as usa). Kayo autorizou a remoção em 2026-11-21.
-- A chave 'litros_minimo_pedido' (valor 30, regra vigente) NÃO é tocada.

delete from public.app_settings where chave = 'litros_dispensa_minimo';
drop function if exists public.litros_dispensa_minimo();
