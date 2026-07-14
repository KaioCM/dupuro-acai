-- ==========================================================================
-- Migration 021 — Numeração de pedidos e vendas (sem colisão)
-- ==========================================================================
-- PROBLEMA: cada camada calculava o próximo número lendo `orders` pelo cliente,
-- ou seja, enxergando só o que o RLS libera para aquele papel:
--   • atendente vê só origem='loja'   → gerava PED-1007 sem saber que já existia
--     um PED-1010 de revendedor (colisão à frente);
--   • revendedor vê só os pedidos dele → dois revendedores geram o MESMO número.
-- Resultado: dois registros diferentes com o mesmo `numero` (o fechamento de
-- caixa e, depois, a nota fiscal agrupam por número — bagunça certa).
--
-- SOLUÇÃO: o número passa a ser calculado no banco por funções `security
-- definer`, que enxergam TODAS as linhas (ignoram RLS), e cada canal tem a sua
-- faixa própria:
--   • pedido de revendedor/admin → PED-XXXX
--   • venda de loja (caixa)      → VND-XXXX
-- Assim as duas sequências nunca se cruzam. As funções são `stable` (só leem):
-- podem ser chamadas para pré-visualizar o número sem "gastar" nada.
-- Vendas de loja antigas seguem com número PED- (histórico preservado).
-- ==========================================================================

create or replace function public.next_pedido_numero()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select 'PED-' || (
    coalesce(max((regexp_match(numero, '^PED-(\d+)$'))[1]::int), 1000) + 1
  )::text
  from public.orders;
$$;

create or replace function public.next_venda_numero()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select 'VND-' || lpad((
    coalesce(max((regexp_match(numero, '^VND-(\d+)$'))[1]::int), 0) + 1
  )::text, 4, '0')
  from public.orders;
$$;

grant execute on function public.next_pedido_numero() to authenticated;
grant execute on function public.next_venda_numero() to authenticated;
