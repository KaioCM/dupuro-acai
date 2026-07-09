-- ==========================================================================
-- Dupuro Açaí — Migração 013: estoque por sabor (produtos multissabor)
-- Aplicada diretamente via MCP do Supabase (este arquivo é o registro).
--
-- Produtos multissabor ("genéricos") passam a ter estoque controlado por sabor
-- (Açaí + cada creme), sem precisar criar um produto por sabor. Produtos comuns
-- continuam com o estoque único em products.estoque.
-- ==========================================================================

create table if not exists public.product_flavor_stock (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.products(id) on delete cascade,
  sabor text not null,
  estoque integer not null default 0 check (estoque >= 0),
  unique (produto_id, sabor)
);

alter table public.product_flavor_stock enable row level security;

-- Revendedor aprovado precisa LER (pra saber quais sabores têm estoque). Só o
-- admin escreve. O trigger de estoque roda com security definer, então
-- consegue decrementar mesmo para o revendedor.
create policy "pfs_select_authenticated" on public.product_flavor_stock
  for select using (auth.uid() is not null);
create policy "pfs_insert_admin" on public.product_flavor_stock
  for insert with check (public.is_admin());
create policy "pfs_update_admin" on public.product_flavor_stock
  for update using (public.is_admin());
create policy "pfs_delete_admin" on public.product_flavor_stock
  for delete using (public.is_admin());

-- Ajusta o estoque certo: do SABOR (se o produto é multissabor e veio sabor) ou
-- do PRODUTO (caso comum). security definer para funcionar no pedido do
-- revendedor, que não tem update direto nessas tabelas.
create or replace function public.apply_stock_delta(p_produto_id bigint, p_sabor text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
declare is_multi boolean;
begin
  if p_produto_id is null or p_delta is null then return; end if;
  select multissabor into is_multi from public.products where id = p_produto_id;
  if is_multi is true and p_sabor is not null then
    update public.product_flavor_stock set estoque = estoque + p_delta
      where produto_id = p_produto_id and sabor = p_sabor;
    -- sabor sem linha de estoque (não ofertado) + tentativa de baixa = bloqueia
    if not found and p_delta < 0 then
      raise exception 'Sem estoque para o sabor %', p_sabor using errcode = '23514';
    end if;
  else
    update public.products set estoque = estoque + p_delta where id = p_produto_id;
  end if;
end;
$$;

-- Trigger de pedido reescrito para usar o helper. O gatilho orders_adjust_stock
-- já existe (migração 012) apontando para esta função.
create or replace function public.adjust_stock_on_order_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    return old;
  elsif tg_op = 'UPDATE' then
    perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
    return new;
  end if;
  return null;
end;
$$;

-- Backfill: cria linhas de estoque (0) para os sabores aplicáveis de cada
-- produto multissabor já existente (Açaí só se multissabor_incluir_acai).
insert into public.product_flavor_stock (produto_id, sabor, estoque)
select p.id, s.sabor, 0
from public.products p
cross join (values
  ('Açaí'),('Creme de Morango'),('Creme de Paçoca'),('Creme de Maracujá'),
  ('Creme de Cupuaçu'),('Creme de Pistache'),('Creme de Ninho'),('Creme de Banana')
) as s(sabor)
where p.multissabor is true
  and (s.sabor <> 'Açaí' or p.multissabor_incluir_acai is not false)
on conflict (produto_id, sabor) do nothing;
