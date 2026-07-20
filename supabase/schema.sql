-- ==========================================================================
-- Dupuro Açaí — Esquema Supabase (área do revendedor + admin)
-- Rodar no SQL Editor do projeto Supabase (https://supabase.com/dashboard)
-- Este arquivo reflete o esquema completo para um projeto NOVO. Se você já
-- rodou uma versão anterior deste schema, use as migrações incrementais
-- (supabase/migration_002 a 005) em vez de rodar este arquivo de novo.
-- ==========================================================================

-- ---------- Perfis ----------
-- Um perfil por usuário, ligado 1:1 ao usuário de autenticação (auth.users).
-- status controla o fluxo de aprovação do revendedor: todo cadastro novo nasce
-- 'pendente' e só vira 'aprovado' quando o admin aprova pelo painel admin.
-- role diferencia revendedor comum de admin (quem pode aprovar e gerenciar).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  empresa text,
  email text,
  telefone text,
  cidade text,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),
  -- 'atendente' = caixa/PDV da loja: registra vendas presenciais (ver migration_018).
  role text not null default 'revendedor' check (role in ('revendedor', 'admin', 'atendente')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Função auxiliar que verifica se o usuário logado é admin, sem disparar
-- recursão nas próprias políticas de RLS de profiles (security definer roda
-- com privilégios do dono da função, ignorando RLS).
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable set search_path = public;

-- Atendente da loja (caixa/PDV) — ver migration_018.
create or replace function public.is_atendente()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'atendente' and status = 'aprovado'
  );
$$;

create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

-- Atendente lista revendedores aprovados (para vincular uma venda a um revendedor).
create policy "profiles_select_atendente" on public.profiles
  for select using (public.is_atendente() and role = 'revendedor' and status = 'aprovado');

create policy "profiles_update_own_or_admin" on public.profiles
  for update using (auth.uid() = id or public.is_admin());

-- Cria automaticamente uma linha em profiles quando um novo usuário se cadastra
-- (via auth.signUp no site, com status 'pendente' por padrão), usando os dados
-- extras enviados em options.data no momento do cadastro.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, nome, empresa, telefone, cidade)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'empresa',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'cidade'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- Produtos ----------
-- Catálogo gerenciado pelo admin (nome, preço, imagem no bucket 'produtos').
-- Pedidos referenciam um produto, mas guardam snapshot em itens/valor.
create table if not exists public.products (
  id bigint generated always as identity primary key,
  nome text not null,
  preco numeric(10,2) not null check (preco >= 0),
  imagem_url text,
  tipo text not null default 'varejo' check (tipo in ('atacado', 'varejo')),
  -- Produtos genéricos ("Caixa de 10 Litros") podem ser tanto açaí quanto um
  -- dos cremes — o revendedor escolhe o sabor no pedido (ver orders.sabor).
  multissabor boolean not null default false,
  -- Alguns produtos multissabor são só de cremes (ex: "Caixa de Cremes 10
  -- Litros") e não devem oferecer "Açaí" como opção de sabor.
  multissabor_incluir_acai boolean not null default true,
  -- Controle de estoque exclusivo do admin (aba Produtos). O cliente não vê
  -- o número, só é bloqueado de pedir quando chega a 0 (ver trigger abaixo).
  estoque integer not null default 0 check (estoque >= 0),
  -- Quantidade mínima que o revendedor pode pedir deste produto (1 = sem mínimo).
  -- Dispensado quando o pedido atinge o volume de app_settings (ver migration_023).
  pedido_minimo integer not null default 1 check (pedido_minimo between 1 and 99),
  -- Volume por unidade, em litros (migration_023). Alimenta a regra que dispensa
  -- o pedido mínimo em pedidos grandes. 0 = não conta volume (granola, bebida).
  litros numeric(10,3) not null default 0 check (litros >= 0),
  -- Estoque compartilhado: produto que "puxa" o estoque de outro (o dono). Assim
  -- atacado e varejo do mesmo item usam o mesmo estoque, com preços diferentes.
  estoque_ref bigint references public.products(id) on delete set null,
  -- Quando o produto que puxa não é multissabor mas o dono é, fixa qual sabor do
  -- dono ele consome (ex: "Açaí 10L" atacado sempre baixa o sabor "Açaí" do dono).
  estoque_ref_sabor text,
  -- Modo de venda (migration_019). 'embalado' = caixas/potes/bebidas (o padrão,
  -- vendido também ao revendedor). 'copo' = açaí no copo da loja, com direito a
  -- `acomp_gratis` acompanhamentos grátis e `acomp_extra_preco` por excedente.
  -- 'peso' = self-service (o cliente monta e pesa); aqui `preco` é o R$/kg.
  -- 'copo' e 'peso' são exclusivos da loja (não aparecem para o revendedor).
  modo text not null default 'embalado' check (modo in ('embalado', 'copo', 'peso')),
  acomp_gratis integer not null default 0 check (acomp_gratis >= 0 and acomp_gratis <= 20),
  acomp_extra_preco numeric(10,2) not null default 0 check (acomp_extra_preco >= 0),
  created_at timestamptz not null default now()
);

-- ---------- Acompanhamentos (migration_019) ----------
-- Lista única da loja (leite condensado, granola, Nutella...). 'gratuito' entra
-- na cota do copo (excedente cobra products.acomp_extra_preco); 'pago' cobra
-- sempre o próprio `preco`, fora da cota.
create table if not exists public.acompanhamentos (
  id bigint generated always as identity primary key,
  nome text not null,
  tipo text not null default 'gratuito' check (tipo in ('gratuito', 'pago')),
  preco numeric(10,2) not null default 0 check (preco >= 0),
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.acompanhamentos enable row level security;

create policy "acompanhamentos_select_authenticated" on public.acompanhamentos
  for select using (auth.uid() is not null);
create policy "acompanhamentos_insert_admin" on public.acompanhamentos
  for insert with check (public.is_admin());
create policy "acompanhamentos_update_admin" on public.acompanhamentos
  for update using (public.is_admin());
create policy "acompanhamentos_delete_admin" on public.acompanhamentos
  for delete using (public.is_admin());

alter table public.products enable row level security;

create policy "products_select_authenticated" on public.products
  for select using (auth.uid() is not null);

create policy "products_insert_admin" on public.products
  for insert with check (public.is_admin());

create policy "products_update_admin" on public.products
  for update using (public.is_admin());

create policy "products_delete_admin" on public.products
  for delete using (public.is_admin());

-- Bucket público para imagens de produto (upload/exclusão restritos ao admin)
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do nothing;

create policy "produtos_storage_insert_admin" on storage.objects
  for insert with check (bucket_id = 'produtos' and public.is_admin());

create policy "produtos_storage_delete_admin" on storage.objects
  for delete using (bucket_id = 'produtos' and public.is_admin());

-- Estoque por sabor (produtos multissabor). Produtos comuns usam products.estoque;
-- multissabor usa uma linha por sabor aqui. Revendedor lê (pra saber o que tem
-- em estoque), só o admin escreve.
create table if not exists public.product_flavor_stock (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.products(id) on delete cascade,
  sabor text not null,
  estoque integer not null default 0 check (estoque >= 0),
  unique (produto_id, sabor)
);

alter table public.product_flavor_stock enable row level security;

create policy "pfs_select_authenticated" on public.product_flavor_stock
  for select using (auth.uid() is not null);
create policy "pfs_insert_admin" on public.product_flavor_stock
  for insert with check (public.is_admin());
create policy "pfs_update_admin" on public.product_flavor_stock
  for update using (public.is_admin());
create policy "pfs_delete_admin" on public.product_flavor_stock
  for delete using (public.is_admin());

-- ---------- Pedidos ----------
-- Leitura para o revendedor dono (só depois de aprovado) ou para o admin.
-- Criação: admin (qualquer status/revendedor) ou o próprio revendedor
-- (sempre travado em status 'enviado' — "Pedido Enviado" — até o admin
-- avançar). Atualização de status e exclusão são exclusivas do admin.
-- produto_id/quantidade (1-99) alimentam o cálculo; itens/valor guardam o
-- snapshot textual pra histórico sobreviver à exclusão do produto.
-- revendedor_id é opcional (on delete set null): excluir a conta do
-- revendedor não apaga o histórico de pedidos, só a referência ao dono.
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  revendedor_id uuid references auth.users(id) on delete set null,
  numero text not null,
  data date not null,
  itens text not null,
  valor numeric(10,2) not null,
  status text not null check (status in ('processando', 'enviado', 'entregue', 'cancelado')),
  produto_id bigint references public.products(id) on delete set null,
  quantidade int check (quantidade between 1 and 99),
  -- Sabor escolhido nesse pedido, quando o produto é multissabor (nulo
  -- para produtos com sabor fixo no nome, ex: "Caixa de Açaí 10 Litros").
  sabor text,
  -- false: o pedido não valida disponibilidade nem altera o estoque (usado pelo
  -- admin para lançar pedidos antigos de produtos hoje esgotados). O revendedor
  -- não pode usar false — a policy orders_insert_self obriga true.
  usa_estoque boolean not null default true,
  -- Canal do pedido. 'loja' = venda presencial registrada pela atendente (caixa),
  -- nasce 'entregue' e baixa estoque na hora (ver migration_018). atendente_id
  -- registra quem lançou (auditoria/fechamento de caixa).
  origem text not null default 'revendedor' check (origem in ('revendedor', 'admin', 'loja')),
  atendente_id uuid references auth.users(id) on delete set null,
  -- Detalhe estruturado da venda de loja (migration_020):
  --   copo → { acompanhamentos: [{nome, tipo, preco}], gratis_inclusos, extras_cobrados, extra_unitario }
  --   peso → { peso_kg, preco_kg }
  -- Base para a comanda impressa e, depois, para a nota fiscal.
  detalhes jsonb,
  -- Motivo do cancelamento de uma venda de loja (migration_022). Fica à vista no
  -- fechamento do dia; a trilha completa vai em order_audits.
  cancel_motivo text,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

-- Numeração (migration_021). Cada canal tem sua faixa, e o número é calculado no
-- banco por funções security definer (enxergam TODAS as linhas). Sem isso cada
-- papel calculava olhando só o que o RLS libera e gerava números repetidos:
--   pedido de revendedor/admin → PED-XXXX   |   venda de loja (caixa) → VND-XXXX
-- São `stable` (só leem): dá pra chamar só pra pré-visualizar o número.
create or replace function public.next_pedido_numero()
returns text language sql security definer stable set search_path = public as $$
  select 'PED-' || (
    coalesce(max((regexp_match(numero, '^PED-(\d+)$'))[1]::int), 1000) + 1
  )::text
  from public.orders;
$$;

create or replace function public.next_venda_numero()
returns text language sql security definer stable set search_path = public as $$
  select 'VND-' || lpad((
    coalesce(max((regexp_match(numero, '^VND-(\d+)$'))[1]::int), 0) + 1
  )::text, 4, '0')
  from public.orders;
$$;

grant execute on function public.next_pedido_numero() to authenticated;
grant execute on function public.next_venda_numero() to authenticated;

create policy "orders_select_own_approved_or_admin" on public.orders
  for select using (
    (
      auth.uid() = revendedor_id
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
    )
    or public.is_admin()
  );

-- Atendente lê as vendas de loja (fechamento de caixa do dia).
create policy "orders_select_atendente" on public.orders
  for select using (public.is_atendente() and origem = 'loja');

create policy "orders_insert_admin" on public.orders
  for insert with check (public.is_admin());

-- Atendente registra venda de loja: sempre origem='loja' e já nasce 'entregue'
-- (venda concluída no balcão), sem pedido mínimo. usa_estoque é amarrado ao modo
-- do produto (migration_020): 'embalado' obriga true (baixa estoque na hora);
-- copo/self-service obrigam false (não têm estoque por unidade).
create policy "orders_insert_atendente" on public.orders
  for insert with check (
    public.is_atendente()
    and origem = 'loja'
    and status = 'entregue'
    and usa_estoque = coalesce(
      (select p.modo = 'embalado' from public.products p where p.id = produto_id),
      true
    )
  );

create policy "orders_insert_self" on public.orders
  for insert with check (
    auth.uid() = revendedor_id
    and status = 'enviado'
    and usa_estoque = true
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
    and quantidade >= coalesce((select pedido_minimo from public.products where id = produto_id), 1)
  );

create policy "orders_update_admin" on public.orders
  for update using (public.is_admin());

create policy "orders_delete_admin" on public.orders
  for delete using (public.is_admin());

-- ---------- Dispensa do pedido mínimo por volume (migration_023) ----------
-- Pedido grande dispensa o pedido mínimo de TODOS os itens: volume do pedido =
-- soma(products.litros × quantidade); ao atingir o limite (padrão 50 L), os
-- mínimos deixam de valer. 5 caixas de 10 L e 10 de 5 L dão o mesmo volume, e
-- misturas também contam.
create table if not exists public.app_settings (
  chave text primary key,
  valor numeric not null,
  atualizado_em timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "app_settings_select_authenticated" on public.app_settings
  for select using (auth.uid() is not null);
create policy "app_settings_write_admin" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (chave, valor)
values ('litros_dispensa_minimo', 50)
on conflict (chave) do nothing;

create or replace function public.litros_dispensa_minimo()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select valor from public.app_settings where chave = 'litros_dispensa_minimo'), 50);
$$;

create or replace function public.volume_do_pedido(p_rows jsonb)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.litros * (e->>'quantidade')::int), 0)
  from jsonb_array_elements(p_rows) e
  join public.products p on p.id = (e->>'produto_id')::bigint;
$$;

-- Criação do pedido do revendedor. A policy orders_insert_self valida o mínimo
-- LINHA A LINHA e não enxergaria que o pedido inteiro passou do volume — por
-- isso o pedido do revendedor passa por esta função, que valida o carrinho todo.
create or replace function public.criar_pedido_revendedor(p_rows jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_numero text; v_volume numeric; v_dispensa boolean; v_falta record; r jsonb;
begin
  if v_uid is null then raise exception 'Sem sessão ativa.'; end if;
  if not exists (
    select 1 from public.profiles where id = v_uid and status = 'aprovado' and role = 'revendedor'
  ) then raise exception 'Cadastro não aprovado para fazer pedidos.'; end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    left join public.products p on p.id = (e->>'produto_id')::bigint
    where p.id is null or (e->>'quantidade')::int < 1 or (e->>'quantidade')::int > 99
  ) then raise exception 'Item inválido no pedido.'; end if;

  v_volume := public.volume_do_pedido(p_rows);
  v_dispensa := v_volume >= public.litros_dispensa_minimo();

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
      v_uid, v_numero, (now() at time zone 'America/Cuiaba')::date,
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

-- ---------- Caixa edita/cancela venda do dia (migration_022) ----------
-- Trilha durável de alterações/cancelamentos de venda de loja (a dona audita).
create table if not exists public.order_audits (
  id bigint generated always as identity primary key,
  numero text not null,
  acao text not null check (acao in ('cancelou', 'editou')),
  motivo text not null,
  snapshot jsonb,
  atendente_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.order_audits enable row level security;

create policy "order_audits_select_admin" on public.order_audits
  for select using (public.is_admin());

-- Quem pode mexer numa venda: admin (qualquer data) ou atendente, desde que
-- TODAS as linhas do número sejam de loja e do dia de hoje (fuso da loja).
create or replace function public.caixa_pode_mexer(p_numero text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.orders o where o.numero = p_numero and o.origem = 'loja'
    ) and (
      public.is_admin() or (
        public.is_atendente() and not exists (
          select 1 from public.orders o
          where o.numero = p_numero and o.origem = 'loja'
            and (o.created_at at time zone 'America/Cuiaba')::date
                <> (now() at time zone 'America/Cuiaba')::date
        )
      )
    );
$$;

-- Cancela a venda (status 'cancelado' + motivo; estoque volta pelo gatilho).
create or replace function public.caixa_cancelar_venda(p_numero text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_snap jsonb;
begin
  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if not public.caixa_pode_mexer(p_numero) then
    raise exception 'Sem permissão para cancelar esta venda.';
  end if;
  select jsonb_agg(to_jsonb(o)) into v_snap
    from public.orders o where o.numero = p_numero and o.origem = 'loja';
  update public.orders set status = 'cancelado', cancel_motivo = p_motivo
   where numero = p_numero and origem = 'loja' and status <> 'cancelado';
  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'cancelou', p_motivo, v_snap, auth.uid());
end;
$$;

-- Substitui os itens da venda (edição), mantendo o mesmo número. Atômico: o
-- gatilho devolve o estoque das linhas apagadas e consome o das novas.
create or replace function public.caixa_substituir_venda(p_numero text, p_motivo text, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_snap jsonb; r jsonb;
begin
  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Informe o motivo da alteração.';
  end if;
  if not public.caixa_pode_mexer(p_numero) then
    raise exception 'Sem permissão para editar esta venda.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'A venda precisa ter ao menos um item.';
  end if;
  select jsonb_agg(to_jsonb(o)) into v_snap
    from public.orders o where o.numero = p_numero and o.origem = 'loja';
  delete from public.orders where numero = p_numero and origem = 'loja';
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, detalhes, origem, atendente_id
    ) values (
      nullif(r->>'revendedor_id', '')::uuid,
      p_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint,
      nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''),
      coalesce((r->>'usa_estoque')::boolean, true),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      'loja', auth.uid()
    );
  end loop;
  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'editou', p_motivo, v_snap, auth.uid());
end;
$$;

grant execute on function public.caixa_pode_mexer(text) to authenticated;
grant execute on function public.caixa_cancelar_venda(text, text) to authenticated;
grant execute on function public.caixa_substituir_venda(text, text, jsonb) to authenticated;

-- Ajusta o estoque a cada pedido criado/editado/excluído, seja pelo revendedor
-- ou pelo admin. Decrementa o estoque do SABOR (produto multissabor + sabor no
-- pedido) ou o estoque do PRODUTO (caso comum). security definer: o revendedor
-- não tem update direto em products/product_flavor_stock, mas precisa
-- decrementar ao criar o próprio pedido — a função roda com os privilégios do
-- dono, contornando a RLS só pra esse ajuste. O check (estoque >= 0) aborta a
-- transação (pedido inteiro) se faltar estoque.
-- Resolve o dono do estoque (estoque_ref) antes de aplicar a baixa, para que
-- atacado e varejo do mesmo item compartilhem o estoque.
create or replace function public.apply_stock_delta(p_produto_id bigint, p_sabor text, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref bigint;
  v_ref_sabor text;
  v_target bigint;
  v_sabor text;
  is_multi boolean;
begin
  if p_produto_id is null or p_delta is null then return; end if;
  select estoque_ref, estoque_ref_sabor into v_ref, v_ref_sabor from public.products where id = p_produto_id;
  v_target := coalesce(v_ref, p_produto_id);
  v_sabor := coalesce(v_ref_sabor, p_sabor);
  select multissabor into is_multi from public.products where id = v_target;
  if is_multi is true and v_sabor is not null then
    update public.product_flavor_stock set estoque = estoque + p_delta
      where produto_id = v_target and sabor = v_sabor;
    if not found and p_delta < 0 then
      raise exception 'Sem estoque para o sabor %', v_sabor using errcode = '23514';
    end if;
  else
    update public.products set estoque = estoque + p_delta where id = v_target;
  end if;
end;
$$;

-- Só pedido CONFIRMADO pelo admin consome estoque. O pedido do revendedor nasce
-- 'enviado' (aguardando análise) e não mexe no estoque; cancelar devolve.
create or replace function public.order_consumes_stock(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('processando', 'entregue');
$$;

-- Estoque disponível, resolvendo o dono do estoque (estoque_ref/estoque_ref_sabor).
create or replace function public.available_stock(p_produto_id bigint, p_sabor text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ref bigint; v_ref_sabor text; v_target bigint; v_sabor text;
  is_multi boolean; v_estoque int;
begin
  if p_produto_id is null then return 0; end if;
  select estoque_ref, estoque_ref_sabor into v_ref, v_ref_sabor
    from public.products where id = p_produto_id;
  v_target := coalesce(v_ref, p_produto_id);
  v_sabor := coalesce(v_ref_sabor, p_sabor);
  select multissabor into is_multi from public.products where id = v_target;
  if is_multi is true and v_sabor is not null then
    select estoque into v_estoque from public.product_flavor_stock
      where produto_id = v_target and sabor = v_sabor;
  else
    select estoque into v_estoque from public.products where id = v_target;
  end if;
  return coalesce(v_estoque, 0);
end;
$$;

create or replace function public.adjust_stock_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if new.usa_estoque then
      if public.order_consumes_stock(new.status) then
        perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
      elsif new.status = 'enviado' then
        -- Aguardando confirmação do admin: NÃO baixa estoque, mas garante que
        -- havia quantidade disponível no momento do pedido.
        if public.available_stock(new.produto_id, new.sabor) < new.quantidade then
          raise exception 'Estoque insuficiente' using errcode = '23514';
        end if;
      end if;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.usa_estoque and public.order_consumes_stock(old.status) then
      perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    end if;
    return old;
  elsif (tg_op = 'UPDATE') then
    if old.usa_estoque and public.order_consumes_stock(old.status) then
      perform public.apply_stock_delta(old.produto_id, old.sabor, old.quantidade);
    end if;
    if new.usa_estoque and public.order_consumes_stock(new.status) then
      perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_adjust_stock on public.orders;
create trigger orders_adjust_stock
  after insert or update or delete on public.orders
  for each row execute function public.adjust_stock_on_order_change();

-- ---------- Cupons ----------
-- Só o admin gera e apaga cupons (pelo painel admin). O revendedor aprovado
-- só visualiza os cupons que recebeu; admin enxerga todos.
create table if not exists public.coupons (
  id bigint generated always as identity primary key,
  revendedor_id uuid references auth.users(id) on delete set null,
  code text not null unique,
  descricao text,
  desconto_percent int,
  validade date,
  usado boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.coupons enable row level security;

create policy "coupons_select_own_approved_or_admin" on public.coupons
  for select using (
    (
      auth.uid() = revendedor_id
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'aprovado')
    )
    or public.is_admin()
  );

create policy "coupons_insert_admin" on public.coupons
  for insert with check (public.is_admin());

create policy "coupons_delete_admin" on public.coupons
  for delete using (public.is_admin());

-- ==========================================================================
-- Fluxo de aprovação de revendedor:
-- 1. O cliente se cadastra sozinho pelo site (index.html#revenda), criando uma
--    conta real via Supabase Auth com status = 'pendente'.
-- 2. Um admin (role = 'admin') aprova/rejeita pelo painel admin (area-cliente/admin.html).
-- 3. Só depois disso o login libera o painel do revendedor.
--
-- Como tornar uma conta admin (rodar manualmente uma vez por admin):
-- update public.profiles set role = 'admin', status = 'aprovado' where email = 'alguem@exemplo.com';
-- ==========================================================================
