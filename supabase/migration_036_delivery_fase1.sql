-- ==========================================================================
-- migration_036 — Dupuro Delivery (Fase 1: config, pedidos, catálogo, rastreio)
-- ==========================================================================
-- Configuração única (linha id=1) do delivery: origem (loja), tabela de taxa
-- por km, janelas manhã/tarde com horário de corte, dias de entrega e quais
-- produtos aparecem. Leitura pública (são preços/regras do site); só admin edita.
create table if not exists public.delivery_config (
  id int primary key default 1 check (id = 1),
  config jsonb not null,
  atualizado_em timestamptz not null default now()
);
insert into public.delivery_config (id, config) values (1, jsonb_build_object(
  'ativo', true,
  'origem', jsonb_build_object('endereco', 'Av. Prof. Edna Maria Albuquerque Affi, 16 - Jardim Imperial, Cuiabá - MT, 78076-001', 'lat', null, 'lng', null),
  'taxa', jsonb_build_object('base', 5, 'km_base', 3, 'por_km', 1.5, 'max_km', 15),
  'janelas', jsonb_build_object(
    'manha', jsonb_build_object('inicio', '08:00', 'fim', '12:00', 'corte', '07:00'),
    'tarde', jsonb_build_object('inicio', '13:00', 'fim', '17:00', 'corte', '11:00')),
  'dias', jsonb_build_array(1, 2, 3, 4, 5, 6),
  'produtos', jsonb_build_array(21, 22, 23, 24, 35)
)) on conflict (id) do nothing;

alter table public.delivery_config enable row level security;
drop policy if exists delivery_config_select on public.delivery_config;
create policy delivery_config_select on public.delivery_config for select to anon, authenticated using (true);
drop policy if exists delivery_config_admin on public.delivery_config;
create policy delivery_config_admin on public.delivery_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Pedidos do delivery (cabeçalho + itens em jsonb). Cliente é anônimo: NÃO
-- tem policy pra anon — criação/pagamento passam por Edge Function (service
-- role) e o acompanhamento pela RPC delivery_rastreio(token).
create sequence if not exists public.delivery_numero_seq start 1;
create table if not exists public.delivery_pedidos (
  id bigint generated always as identity primary key,
  codigo text not null unique default ('DLV-' || lpad(nextval('public.delivery_numero_seq')::text, 4, '0')),
  token uuid not null unique default gen_random_uuid(),   -- link de acompanhamento
  cliente_nome text not null,
  cliente_telefone text not null,
  endereco text not null,
  complemento text,
  lat double precision,
  lng double precision,
  distancia_km numeric(6,2),
  taxa numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  itens jsonb not null,                                    -- [{produto_id,nome,sabor,quantidade,preco}]
  periodo text not null check (periodo in ('manha', 'tarde')),
  data_entrega date not null,
  status text not null default 'aguardando_pagamento'
    check (status in ('aguardando_pagamento', 'pago', 'em_rota', 'entregue', 'cancelado', 'expirado')),
  pagamento_metodo text,
  mp_preference_id text,
  mp_payment_id text,
  mp_status text,
  pago_em timestamptz,
  rota_ordem int,
  saiu_em timestamptz,
  entregue_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_delivery_rota on public.delivery_pedidos (data_entrega, periodo, status);
alter table public.delivery_pedidos enable row level security;
drop policy if exists delivery_pedidos_admin on public.delivery_pedidos;
create policy delivery_pedidos_admin on public.delivery_pedidos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Catálogo público do delivery: só os produtos da config, com estoque resolvido
-- pela linha dona (estoque_ref) e por sabor nos multissabor.
create or replace function public.delivery_catalogo()
returns jsonb language sql stable security definer set search_path = public as $$
  with cfg as (select config from public.delivery_config where id = 1),
  ids as (select (jsonb_array_elements_text(config->'produtos'))::bigint as id from cfg)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'nome', p.nome, 'preco', p.preco, 'imagem_url', p.imagem_url, 'litros', p.litros,
    'multissabor', p.multissabor,
    'estoque', case when p.multissabor then null else src.estoque end,
    'sabores', case when p.multissabor then (
       select coalesce(jsonb_agg(jsonb_build_object('sabor', f.sabor, 'estoque', f.estoque) order by f.sabor), '[]'::jsonb)
       from public.product_flavor_stock f
       where f.produto_id = src.id and (p.multissabor_incluir_acai or f.sabor <> 'Açaí')
    ) else '[]'::jsonb end
  ) order by p.preco), '[]'::jsonb)
  from ids
  join public.products p on p.id = ids.id
  join public.products src on src.id = coalesce(p.estoque_ref, p.id);
$$;
grant execute on function public.delivery_catalogo() to anon, authenticated;

-- Acompanhamento público pelo token (só o necessário — sem telefone/endereço).
create or replace function public.delivery_rastreio(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', codigo, 'status', status, 'periodo', periodo, 'data_entrega', data_entrega,
    'cliente', split_part(cliente_nome, ' ', 1), 'itens', itens,
    'subtotal', subtotal, 'taxa', taxa, 'total', total,
    'pago_em', pago_em, 'saiu_em', saiu_em, 'entregue_em', entregue_em, 'criado_em', criado_em)
  from public.delivery_pedidos where token = p_token;
$$;
grant execute on function public.delivery_rastreio(uuid) to anon, authenticated;
