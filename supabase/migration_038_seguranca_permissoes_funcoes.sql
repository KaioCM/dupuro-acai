-- migration_038 — Segurança: quem pode executar cada função (2026-10-20)
-- ============================================================================
-- Achado na auditoria: por padrão o Postgres dá EXECUTE pra PUBLIC, então
-- funções SECURITY DEFINER internas eram chamáveis por QUALQUER visitante via
-- /rest/v1/rpc com a chave pública do site — ex.: apply_stock_delta deixava
-- zerar/inflar o estoque, caixa_formas_pagamento expunha totais do caixa.
--
-- Regra daqui pra frente:
--   * internas (só chamadas por triggers ou por outras funções definer, que
--     rodam como o dono) → ninguém de fora executa;
--   * telas logadas (caixa/admin/revendedor) → só `authenticated` (a função
--     já checa o papel por dentro);
--   * públicas de propósito (delivery) → anon também.
-- Nenhuma policy de RLS usa as funções revogadas (conferido em pg_policies),
-- e trigger não checa EXECUTE na hora de disparar.
-- ============================================================================

-- 1) Internas: só o dono (postgres) e o service_role.
revoke execute on function public.apply_stock_delta(bigint, text, integer) from public, anon, authenticated;
revoke execute on function public.available_stock(bigint, text) from public, anon, authenticated;
revoke execute on function public.caixa_formas_pagamento(bigint) from public, anon, authenticated;
revoke execute on function public.caixa_pode_mexer(text) from public, anon, authenticated;
revoke execute on function public.volume_do_pedido(jsonb) from public, anon, authenticated;
revoke execute on function public.adjust_stock_on_order_change() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.order_consumes_stock(text) from public, anon, authenticated;
revoke execute on function public.check_limite_promocoes() from public, anon, authenticated;

-- 2) Só usuário logado (a função confere atendente/admin/revendedor por dentro).
do $$
declare f text;
begin
  foreach f in array array[
    'public.abrir_caixa(numeric)',
    'public.fechar_caixa(bigint, numeric)',
    'public.resumo_caixa(bigint)',
    'public.caixa_sessao_aberta()',
    'public.caixa_cancelar_venda(text, text)',
    'public.caixa_substituir_venda(text, text, jsonb)',
    'public.criar_pedido_revendedor(jsonb)',
    'public.sincronizar_venda_offline(jsonb, uuid)',
    'public.next_pedido_numero()',
    'public.next_venda_numero()',
    'public.litros_dispensa_minimo()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 3) Públicas de propósito (site do delivery, sem login): delivery_catalogo,
--    delivery_rastreio — mantidas. is_admin/is_atendente ficam liberadas porque
--    as policies de RLS as chamam (só dizem algo sobre o próprio usuário).

-- 4) search_path fixo (aviso do linter) nas duas que faltavam.
alter function public.order_consumes_stock(text) set search_path = public;
alter function public.check_limite_promocoes() set search_path = public;

-- 5) Funções NOVAS deixam de nascer abertas pra visitante: quem precisar ser
--    pública (ex.: RPC do delivery) recebe GRANT ... TO anon explícito.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;

-- 6) O cadastro (Supabase Auth) roda como supabase_auth_admin: garante que o
--    trigger de perfil continua disparando (aplicado como migração à parte).
grant execute on function public.handle_new_user() to supabase_auth_admin;
