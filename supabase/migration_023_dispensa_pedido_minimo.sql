-- ==========================================================================
-- Migration 023 — Pedido grande dispensa o pedido mínimo dos demais produtos
-- ==========================================================================
-- Regra do Kayo: cliente que puxa volume (ex.: 15–30 caixas de 10 L por semana)
-- pode completar o pedido com 1 unidade de qualquer item, sem respeitar o
-- pedido mínimo daquele item. Os dois exemplos dados (5 caixas de 10 L OU
-- 10 caixas de 5 L) são o MESMO volume: 50 litros. Então a regra é por volume:
--   volume do pedido = soma(products.litros × quantidade)
--   volume >= app_settings['litros_dispensa_minimo'] (padrão 50) → dispensa
-- Assim misturas também contam (3 de 10 L + 4 de 5 L = 50 L) e não depende de
-- amarrar a regra em nomes de produto.
--
-- POR QUE UMA FUNÇÃO: a policy orders_insert_self valida `quantidade >=
-- pedido_minimo` LINHA A LINHA e não enxerga os outros itens do mesmo pedido —
-- ela nunca saberia que o pedido inteiro passou de 50 L. A criação do pedido do
-- revendedor passa a ser feita por esta função security definer, que valida o
-- carrinho todo. A policy antiga continua valendo para inserts diretos (mais
-- restritiva), então nada afrouxa por fora.
-- ==========================================================================

-- Volume de cada produto, em litros por unidade (0 = não conta volume, ex.: granola).
alter table public.products
  add column if not exists litros numeric(10,3) not null default 0 check (litros >= 0);

-- Configurações simples do sistema (chave/valor numérico).
create table if not exists public.app_settings (
  chave text primary key,
  valor numeric not null,
  atualizado_em timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_authenticated" on public.app_settings;
create policy "app_settings_select_authenticated" on public.app_settings
  for select using (auth.uid() is not null);

drop policy if exists "app_settings_write_admin" on public.app_settings;
create policy "app_settings_write_admin" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (chave, valor)
values ('litros_dispensa_minimo', 50)
on conflict (chave) do nothing;

-- Limite de litros que dispensa os mínimos (com fallback se a linha sumir).
create or replace function public.litros_dispensa_minimo()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select valor from public.app_settings where chave = 'litros_dispensa_minimo'), 50);
$$;

-- Volume total (litros) de um carrinho no formato [{produto_id, quantidade}, ...].
create or replace function public.volume_do_pedido(p_rows jsonb)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.litros * (e->>'quantidade')::int), 0)
  from jsonb_array_elements(p_rows) e
  join public.products p on p.id = (e->>'produto_id')::bigint;
$$;

-- Cria o pedido do revendedor validando o CARRINHO INTEIRO (mínimos + dispensa
-- por volume), gerando o número e inserindo tudo numa transação só.
-- p_rows: [{produto_id, quantidade, sabor, itens, valor}, ...]
create or replace function public.criar_pedido_revendedor(p_rows jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_numero text;
  v_volume numeric;
  v_dispensa boolean;
  v_falta record;
  r jsonb;
begin
  if v_uid is null then
    raise exception 'Sem sessão ativa.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'aprovado' and role = 'revendedor'
  ) then
    raise exception 'Cadastro não aprovado para fazer pedidos.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;

  -- Quantidades válidas e produtos existentes.
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    left join public.products p on p.id = (e->>'produto_id')::bigint
    where p.id is null
       or (e->>'quantidade')::int < 1
       or (e->>'quantidade')::int > 99
  ) then
    raise exception 'Item inválido no pedido.';
  end if;

  v_volume := public.volume_do_pedido(p_rows);
  v_dispensa := v_volume >= public.litros_dispensa_minimo();

  -- Pedido mínimo por item — só cobrado quando o pedido NÃO atingiu o volume.
  if not v_dispensa then
    select p.nome, p.pedido_minimo into v_falta
    from jsonb_array_elements(p_rows) e
    join public.products p on p.id = (e->>'produto_id')::bigint
    where (e->>'quantidade')::int < coalesce(p.pedido_minimo, 1)
    limit 1;
    if found then
      raise exception 'Pedido mínimo de % é % unidades.', v_falta.nome, v_falta.pedido_minimo;
    end if;
  end if;

  v_numero := public.next_pedido_numero();

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, origem
    ) values (
      v_uid, v_numero,
      (now() at time zone 'America/Cuiaba')::date,
      r->>'itens', (r->>'valor')::numeric, 'enviado',
      (r->>'produto_id')::bigint, (r->>'quantidade')::int,
      nullif(r->>'sabor', ''), true, 'revendedor'
    );
  end loop;

  return v_numero;
end;
$$;

grant execute on function public.litros_dispensa_minimo() to authenticated;
grant execute on function public.volume_do_pedido(jsonb) to authenticated;
grant execute on function public.criar_pedido_revendedor(jsonb) to authenticated;

-- Volume dos produtos atuais (o admin ajusta depois na aba Produtos).
update public.products set litros = 10   where nome ilike '%10 litros%' and litros = 0;
update public.products set litros = 5    where nome ilike '%5 litros%'  and litros = 0;
update public.products set litros = 2    where nome ilike '%2 litros%'  and litros = 0;
update public.products set litros = 1    where nome ilike '%1 litro%'   and litros = 0;
update public.products set litros = 0.5  where nome = 'Pote de 500ml'   and litros = 0;
update public.products set litros = 5    where nome = 'Pote de 500ml - 10 Unidades' and litros = 0;
