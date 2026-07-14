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
  pedido_minimo integer not null default 1 check (pedido_minimo between 1 and 99),
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
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

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
