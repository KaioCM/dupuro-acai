-- migration_050 — Rotas de entrega + mapa ao vivo (2026-10-24)
--
-- Pedido do Kayo: no admin, uma parte de Rotas por dia e período (manhã/tarde)
-- juntando delivery e revenda, na ordem mais rápida (otimizador VROOM do
-- OpenRouteService, Edge Function `rota`; o Jev confere os endereços), saindo e
-- voltando pra fábrica. O entregador abre a rota no celular e "Iniciar rota"
-- manda o GPS; o cliente vê o mapa só quando for a vez dele (antes: "faltam N
-- entregas antes da sua").

create table if not exists public.rotas (
  id bigint generated always as identity primary key,
  dia date not null,
  periodo text not null check (periodo in ('manha', 'tarde')),
  status text not null default 'planejada' check (status in ('planejada', 'em_andamento', 'concluida')),
  distancia_km numeric(8,1),
  duracao_min int,
  geometria jsonb,                        -- [[lat,lng],...] do traçado (simplificado)
  criada_em timestamptz not null default now(),
  iniciada_em timestamptz,
  concluida_em timestamptz,
  unique (dia, periodo)
);

create table if not exists public.rota_paradas (
  id bigint generated always as identity primary key,
  rota_id bigint not null references public.rotas(id) on delete cascade,
  ordem int not null,
  tipo text not null check (tipo in ('delivery', 'revenda')),
  ref text not null,                      -- DLV-XXXX ou PED-XXXX
  nome text,
  telefone text,
  endereco text,
  lat double precision,
  lng double precision,
  geo_fonte text,                         -- pedido (cotação/pin do cliente), mapa (Pelias+Jev), manual (admin arrastou)
  geo_alerta text,                        -- motivo pra conferir o ponto
  eta timestamptz,
  chegou_em timestamptz,
  status text not null default 'pendente' check (status in ('pendente', 'feita', 'pulada')),
  unique (rota_id, ref)
);
create index if not exists rota_paradas_ref on public.rota_paradas (ref);

create table if not exists public.rota_posicao (
  rota_id bigint primary key references public.rotas(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  precisao real,
  atualizado_em timestamptz not null default now()
);

-- Ponto já achado pra um endereço de revendedor (não geocodifica de novo; o
-- admin pode corrigir arrastando o pino).
create table if not exists public.geo_enderecos (
  chave text primary key,
  lat double precision not null,
  lng double precision not null,
  label text,
  fonte text,
  atualizado_em timestamptz not null default now()
);

alter table public.rotas enable row level security;
alter table public.rota_paradas enable row level security;
alter table public.rota_posicao enable row level security;
alter table public.geo_enderecos enable row level security;
create policy rotas_admin on public.rotas for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy rota_paradas_admin on public.rota_paradas for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy rota_posicao_admin on public.rota_posicao for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy geo_enderecos_admin on public.geo_enderecos for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Rastreio do cliente: agora com a fila da rota. A posição do entregador só vai
-- quando a próxima parada é a dele (e o GPS está fresco, < 3 min).
create or replace function public.delivery_rastreio(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.delivery_pedidos%rowtype; pa record; v_rota jsonb := null; v_faltam int; v_pos record;
begin
  select * into p from public.delivery_pedidos where token = p_token;
  if not found then return null; end if;
  select rp.*, r.status as rota_status into pa
    from public.rota_paradas rp join public.rotas r on r.id = rp.rota_id
   where rp.tipo = 'delivery' and rp.ref = p.codigo
   order by r.id desc limit 1;
  if found and pa.rota_status = 'em_andamento' and pa.status = 'pendente' then
    select count(*) into v_faltam from public.rota_paradas
     where rota_id = pa.rota_id and status = 'pendente' and ordem < pa.ordem;
    v_rota := jsonb_build_object('faltam', v_faltam, 'eta', pa.eta);
    if v_faltam = 0 then
      select lat, lng, atualizado_em into v_pos from public.rota_posicao
       where rota_id = pa.rota_id and atualizado_em > now() - interval '3 minutes';
      v_rota := v_rota || jsonb_build_object('proxima', true, 'destino', jsonb_build_object('lat', pa.lat, 'lng', pa.lng),
        'entregador', case when v_pos.lat is not null then jsonb_build_object('lat', v_pos.lat, 'lng', v_pos.lng, 'em', v_pos.atualizado_em) end);
    end if;
  end if;
  return jsonb_build_object(
    'codigo', p.codigo, 'status', p.status, 'periodo', p.periodo, 'data_entrega', p.data_entrega,
    'cliente', split_part(p.cliente_nome, ' ', 1), 'itens', p.itens,
    'subtotal', p.subtotal, 'taxa', p.taxa, 'total', p.total,
    'na_entrega', p.pagar_na_entrega, 'forma_entrega', p.forma_entrega, 'troco_para', p.troco_para,
    'pago_em', p.pago_em, 'saiu_em', p.saiu_em, 'entregue_em', p.entregue_em, 'criado_em', p.criado_em,
    'rota', v_rota);
end $$;
grant execute on function public.delivery_rastreio(uuid) to anon, authenticated;

-- 050b: segunda opinião do Jev sobre a rota (nota de economia + vai-e-volta)
-- alter table public.rotas add column if not exists avaliacao jsonb;
