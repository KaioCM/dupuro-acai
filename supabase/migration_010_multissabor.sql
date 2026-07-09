-- ==========================================================================
-- Dupuro Açaí — Migração 010: sabor por pedido (substitui a ideia de
-- categoria fixa açaí/creme no produto, ver migration_009)
-- Aplicada diretamente via MCP do Supabase (não precisa rodar manualmente —
-- este arquivo é o registro do que foi aplicado).
--
-- Alguns produtos são genéricos ("Caixa de 10 Litros") e podem ser tanto
-- açaí quanto um dos cremes — o revendedor escolhe o sabor na hora do
-- pedido, não o admin na hora de cadastrar o produto.
-- ==========================================================================

alter table public.products drop column if exists categoria;

-- Marca produtos cujo sabor (açaí ou um dos cremes) é escolhido pelo
-- revendedor no momento do pedido, em vez de fixo no nome do produto.
alter table public.products
  add column if not exists multissabor boolean not null default false;

-- Guarda o sabor escolhido nesse pedido específico (nulo para produtos
-- que já têm o sabor fixo no nome, como "Caixa de Açaí 10 Litros").
alter table public.orders
  add column if not exists sabor text;
