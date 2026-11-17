-- ==========================================================================
-- Dupuro AÃ§aÃ­ â€” Esquema completo do banco vivo
-- Gerado por dump em 2026-11-17 do projeto zqadfktfplrbrjmepllh
-- Este arquivo reflete o esquema completo para um projeto NOVO.
-- Espelho incremental das migraÃ§Ãµes fica em migration_002â†’061.
--
-- AtenÃ§Ãµes:
--   (a) inclui norte_leads / norte_admins, que nÃ£o tÃªm migraÃ§Ã£o no repo;
--   (b) duas migraÃ§Ãµes numeradas 060 â€” a 060_cupom_taxa_gratis DEVE vir
--       antes da 061;
--   (c) bucket de Storage nfce Ã© criado fora do SQL (dashboard/API)
--       e nÃ£o estÃ¡ neste arquivo;
--   (d) secrets de Edge Functions nÃ£o estÃ£o neste arquivo.
-- ==========================================================================


-- ---------- ExtensÃµes ----------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------- Sequences ----------
create sequence public.delivery_numero_seq;

-- ==========================================================================
-- TABELAS
-- ==========================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  empresa text,
  email text,
  telefone text,
  cidade text,
  created_at timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),
  role text not null default 'revendedor' check (role in ('revendedor', 'admin', 'atendente')),
  conta_teste boolean not null default false,
  pode_prazo boolean not null default false,
  endereco text,
  aceita_whatsapp boolean not null default true,
  endereco_detalhe jsonb
);

alter table public.profiles enable row level security;

-- ---------- orders ----------
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  revendedor_id uuid,
  numero text not null,
  data date not null,
  itens text not null,
  valor numeric(10,2) not null,
  status text not null,
  created_at timestamptz not null default now(),
  produto_id bigint,
  quantidade integer,
  sabor text,
  usa_estoque boolean not null default true,
  origem text not null default 'revendedor',
  atendente_id uuid,
  detalhes jsonb,
  cancel_motivo text,
  client_uuid uuid,
  forma_pagamento text,
  caixa_sessao_id bigint,
  pagamentos jsonb,
  entrega boolean not null default false,
  entrega_info jsonb,
  cupom_code text
);

alter table public.orders enable row level security;

-- ---------- coupons ----------
create table if not exists public.coupons (
  id bigint generated always as identity primary key,
  revendedor_id uuid,
  code text not null,
  descricao text,
  desconto_percent integer,
  validade date,
  usado boolean not null default false,
  created_at timestamptz not null default now(),
  tipo text not null default 'pct',
  usado_por text
);

alter table public.coupons enable row level security;

-- ---------- products ----------
create table if not exists public.products (
  id bigint generated always as identity primary key,
  nome text not null,
  preco numeric(10,2) not null,
  imagem_url text,
  created_at timestamptz not null default now(),
  tipo text not null default 'varejo',
  multissabor boolean not null default false,
  multissabor_incluir_acai boolean not null default true,
  estoque integer not null default 0,
  pedido_minimo integer not null default 1,
  estoque_ref bigint,
  estoque_ref_sabor text,
  modo text not null default 'embalado',
  acomp_gratis integer not null default 0,
  acomp_extra_preco numeric(10,2) not null default 0,
  litros numeric(10,3) not null default 0,
  ncm text not null default '08119000',
  csosn text not null default '102',
  cfop text not null default '5102',
  icms_origem text not null default '0',
  cest text
);

alter table public.products enable row level security;

-- ---------- product_flavor_stock ----------
create table if not exists public.product_flavor_stock (
  id bigint generated always as identity primary key,
  produto_id bigint not null,
  sabor text not null,
  estoque integer not null default 0
);

alter table public.product_flavor_stock enable row level security;
-- FK movida p/ FKs dependentes porque referencia products que Ã© criada depois

-- ---------- acompanhamentos ----------
create table if not exists public.acompanhamentos (
  id bigint generated always as identity primary key,
  nome text not null,
  tipo text not null default 'gratuito',
  preco numeric(10,2) not null default 0,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.acompanhamentos enable row level security;

-- ---------- order_audits ----------
create table if not exists public.order_audits (
  id bigint generated always as identity primary key,
  numero text not null,
  acao text not null,
  motivo text not null,
  snapshot jsonb,
  atendente_id uuid,
  created_at timestamptz not null default now()
);

alter table public.order_audits enable row level security;

-- ---------- app_settings ----------
create table if not exists public.app_settings (
  chave text not null primary key,
  valor numeric not null,
  atualizado_em timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- ==========================================================================
-- RETOCHE: Orders constraints (nÃ£o estavam inline no CREATE TABLE original)
-- ==========================================================================
alter table public.orders add constraint orders_revendedor_id_fkey foreign key (revendedor_id) references auth.users(id) on delete set null;
alter table public.orders add constraint orders_atendente_id_fkey foreign key (atendente_id) references auth.users(id) on delete set null;
alter table public.orders add constraint orders_produto_id_fkey foreign key (produto_id) references products(id) on delete set null;
alter table public.orders add constraint orders_caixa_sessao_id_fkey foreign key (caixa_sessao_id) references caixa_sessoes(id) on delete set null;
alter table public.orders add constraint orders_forma_pgto_check check ((forma_pagamento = any(array['dinheiro','debito','credito','pix'])));
alter table public.orders add constraint orders_status_check_live check ((status = any(array['processando','enviado','entregue','cancelado'])));
alter table public.orders add constraint orders_quantidade_check2 check ((quantidade >= 1 and quantidade <= 99));

-- Retoque: Coupons coluna usado_por garantida
alter table public.coupons add column if not exists usado_por text;

-- Retoque: Coupons FK e check
alter table public.coupons add constraint coupons_revendedor_id_fkey foreign key (revendedor_id) references auth.users(id) on delete set null;
alter table public.coupons add constraint coupons_tipo_check_vivo check ((tipo = any(array['pct','frete'])));

-- ==========================================================================
-- TABELAS 9â€“30 â€” CRIADAS PELO DUMP (completas com colunas, tipos, constraints inline)
-- ==========================================================================

-- ---------- producoes ----------
create table if not exists public.producoes (
  id bigint generated always as identity primary key,
  data date not null default ((now() at time zone 'America/Cuiaba')::date),
  rotulo text,
  observacao text,
  created_at timestamptz not null default now()
);
alter table public.producoes enable row level security;
alter table public.producoes add constraint producoes_data_check check ((data >= (current_date - interval '5 years')));

-- ---------- producao_gastos ----------
create table if not exists public.producao_gastos (
  id bigint generated always as identity primary key,
  producao_id bigint not null,
  descricao text,
  categoria text not null,
  valor numeric(12,2) not null default 0
);
alter table public.producao_gastos enable row level security;
alter table public.producao_gastos add constraint producao_gastos_producao_id_fkey foreign key (producao_id) references public.producoes(id) on delete cascade;
alter table public.producao_gastos add constraint producao_gastos_categoria_check check ((categoria = any(array['materia_prima','embalagem','mao_de_obra','contas_fixos'])));
alter table public.producao_gastos add constraint producao_gastos_valor_check check ((valor >= 0));

-- ---------- producao_itens ----------
create table if not exists public.producao_itens (
  id bigint generated always as identity primary key,
  producao_id bigint not null,
  produto_id bigint,
  produto_nome text,
  quantidade numeric(12,3) not null default 0,
  litros_unit numeric(10,3) not null default 0,
  sabor text
);
alter table public.producao_itens enable row level security;
alter table public.producao_itens add constraint producao_itens_producao_id_fkey foreign key (producao_id) references public.producoes(id) on delete cascade;
alter table public.producao_itens add constraint producao_itens_produto_id_fkey foreign key (produto_id) references public.products(id) on delete set null;
alter table public.producao_itens add constraint producao_itens_quantidade_check check ((quantidade > 0));

-- ---------- caixa_sessoes ----------
create table if not exists public.caixa_sessoes (
  id bigint generated always as identity primary key,
  atendente_id uuid,
  status text not null default 'aberta',
  fundo_troco numeric(12,2) not null default 0,
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz,
  dinheiro_contado numeric(12,2),
  dinheiro_esperado numeric(12,2),
  diferenca numeric(12,2),
  resumo jsonb,
  created_at timestamptz not null default now()
);
alter table public.caixa_sessoes enable row level security;
alter table public.caixa_sessoes add constraint caixa_sessoes_atendente_id_fkey foreign key (atendente_id) references auth.users(id) on delete set null;
alter table public.caixa_sessoes add constraint caixa_sessoes_status_check_vivo check ((status = any(array['aberta','fechada'])));

-- ---------- caixa_promocoes ----------
create table if not exists public.caixa_promocoes (
  id bigint generated always as identity primary key,
  produto_id bigint not null,
  tipo text not null,
  preco_promo numeric(10,2) not null,
  combo_qtd integer,
  dia date not null default ((now() at time zone 'America/Cuiaba')::date),
  criado_por uuid,
  criado_em timestamptz not null default now()
);
alter table public.caixa_promocoes enable row level security;
alter table public.caixa_promocoes add constraint caixa_promocoes_dia_produto_key unique (dia, produto_id);
alter table public.caixa_promocoes add constraint caixa_promocoes_combo_qtd_check check (((combo_qtd is null) or (combo_qtd >= 2)));
alter table public.caixa_promocoes add constraint caixa_promocoes_preco_check check ((preco_promo >= 0));
alter table public.caixa_promocoes add constraint caixa_promocoes_criado_por_fkey foreign key (criado_por) references profiles(id) on delete set null;
alter table public.caixa_promocoes add constraint caixa_promocoes_produto_id_fkey foreign key (produto_id) references products(id) on delete cascade;
alter table public.caixa_promocoes add constraint caixa_promocoes_tipo_check_vivo check ((tipo = any(array['unitario','combo'])));
alter table public.caixa_promocoes add constraint promo_combo_qtd_coerente check ((((tipo = 'combo'::text) and (combo_qtd is not null)) or ((tipo = 'unitario'::text) and (combo_qtd is null))));

-- ---------- nfce_emissoes ----------
create table if not exists public.nfce_emissoes (
  id bigint generated always as identity primary key,
  venda_numero text not null,
  ref text not null,
  ambiente text not null default 'homologacao',
  status text not null default 'processando',
  status_sefaz text,
  mensagem_sefaz text,
  chave text,
  numero_nfce text,
  serie text,
  protocolo text,
  url_danfe text,
  url_xml text,
  qrcode text,
  valor numeric(10,2),
  payload jsonb,
  retorno jsonb,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  cancelamento jsonb,
  cancelado_em timestamptz,
  xml_path text,
  xml_canc_path text,
  arquivado_em timestamptz,
  email_contador jsonb
);
alter table public.nfce_emissoes enable row level security;
alter table public.nfce_emissoes add constraint nfce_emissoes_ref_key unique (ref);
alter table public.nfce_emissoes add constraint nfce_emissoes_ambiente_check check ((ambiente = any(array['homologacao','producao'])));
alter table public.nfce_emissoes add constraint nfce_emissoes_status_check_vivo check ((status = any(array['processando','autorizado','erro','cancelado'])));
alter table public.nfce_emissoes add constraint nfce_emissoes_criado_por_fkey foreign key (criado_por) references auth.users(id) on delete set null;

-- ---------- caixa_pedidos_abertos ----------
create table if not exists public.caixa_pedidos_abertos (
  id bigint generated always as identity primary key,
  label text not null,
  atendente_id uuid,
  sale_target text not null default 'balcao',
  revendedor_id uuid,
  carrinho jsonb not null,
  entrega boolean not null default false,
  entrega_info jsonb,
  taxa numeric(10,2) not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.caixa_pedidos_abertos enable row level security;
alter table public.caixa_pedidos_abertos add constraint caixa_pedidos_abertos_texto_sem_html check ((coalesce(label, ''::text) !~ '[<>]'));
alter table public.caixa_pedidos_abertos add constraint caixa_pedidos_abertos_atendente_id_fkey foreign key (atendente_id) references profiles(id) on delete set null;
alter table public.caixa_pedidos_abertos add constraint caixa_pedidos_abertos_revendedor_id_fkey foreign key (revendedor_id) references profiles(id) on delete set null;

-- ---------- norte_admins ----------
create table if not exists public.norte_admins (
  email text not null primary key
);
alter table public.norte_admins enable row level security;

-- ---------- norte_leads ----------
create table if not exists public.norte_leads (
  id uuid not null default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  nome text not null,
  leitura text,
  tema text,
  quando text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status text not null default 'novo',
  agendado_em timestamptz,
  notas text,
  whatsapp text,
  email text
);
alter table public.norte_leads enable row level security;
alter table public.norte_leads add constraint norte_leads_email_check check (((email is null) or ((char_length(email) <= 254) and (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'))));
alter table public.norte_leads add constraint norte_leads_nome_check check (((char_length(nome) >= 1) and (char_length(nome) <= 120)));
alter table public.norte_leads add constraint norte_leads_status_check_vivo check ((status = any(array['novo','contatado','agendado','arquivado'])));
alter table public.norte_leads add constraint norte_leads_whatsapp_check check (((whatsapp is null) or (whatsapp ~ '^55[0-9]{10,11}$')));
alter table public.norte_leads add constraint norte_leads_leitura_check check (((leitura is null) or (char_length(leitura) <= 80)));
alter table public.norte_leads add constraint norte_leads_tema_check check (((tema is null) or (char_length(tema) <= 80)));
alter table public.norte_leads add constraint norte_leads_quando_check check (((quando is null) or (char_length(quando) <= 80)));
alter table public.norte_leads add constraint norte_leads_source_check check (((source is null) or (char_length(source) <= 80)));
alter table public.norte_leads add constraint norte_leads_utm_source_check check (((utm_source is null) or (char_length(utm_source) <= 200)));
alter table public.norte_leads add constraint norte_leads_utm_medium_check check (((utm_medium is null) or (char_length(utm_medium) <= 200)));
alter table public.norte_leads add constraint norte_leads_utm_campaign_check check (((utm_campaign is null) or (char_length(utm_campaign) <= 200)));
alter table public.norte_leads add constraint norte_leads_notas_check check (((notas is null) or (char_length(notas) <= 4000)));

-- ---------- delivery_config ----------
create table if not exists public.delivery_config (
  id integer not null default 1,
  config jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.delivery_config enable row level security;
alter table public.delivery_config add constraint delivery_config_pkey_override primary key (id);
alter table public.delivery_config add constraint delivery_config_id_check check ((id = 1));

-- ---------- delivery_pedidos ----------
create table if not exists public.delivery_pedidos (
  id bigint generated always as identity primary key,
  codigo text not null default ('DLV-' || lpad((nextval('delivery_numero_seq'::regclass))::text, 4, '0')),
  token uuid not null default gen_random_uuid(),
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
  itens jsonb not null,
  periodo text not null,
  data_entrega date not null,
  status text not null default 'aguardando_pagamento',
  pagamento_metodo text,
  mp_preference_id text,
  mp_payment_id text,
  mp_status text,
  pago_em timestamptz,
  rota_ordem integer,
  saiu_em timestamptz,
  entregue_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  aceita_whatsapp boolean not null default true,
  pagar_na_entrega boolean not null default false,
  forma_entrega text,
  troco_para numeric(10,2),
  recebido_forma text,
  recebido_em timestamptz
);
alter table public.delivery_pedidos enable row level security;
alter table public.delivery_pedidos add constraint delivery_pedidos_codigo_key unique (codigo);
alter table public.delivery_pedidos add constraint delivery_pedidos_token_key unique (token);
alter table public.delivery_pedidos add constraint delivery_pedidos_periodo_check check ((periodo = any(array['manha','tarde'])));
alter table public.delivery_pedidos add constraint delivery_pedidos_status_check_vivo check ((status = any(array['aguardando_pagamento','pago','em_rota','entregue','cancelado','expirado'])));
alter table public.delivery_pedidos add constraint delivery_pedidos_texto_sem_html check (((coalesce(cliente_nome, '') !~ '[<>]') and (coalesce(endereco, '') !~ '[<>]') and (coalesce(complemento, '') !~ '[<>]')));
alter table public.delivery_pedidos add constraint delivery_pedidos_troco_check check (((troco_para is null) or (troco_para > 0)));
alter table public.delivery_pedidos add constraint delivery_pedidos_forma_entrega_check check ((forma_entrega = any(array['dinheiro','debito','credito','pix'])));
alter table public.delivery_pedidos add constraint delivery_pedidos_recebido_check check ((recebido_forma = any(array['dinheiro','debito','credito','pix'])));

-- ---------- estoque_ajustes ----------
create table if not exists public.estoque_ajustes (
  id bigint generated always as identity primary key,
  produto_id bigint,
  produto_nome text,
  sabor text,
  delta integer not null,
  motivo text not null,
  admin_id uuid not null default auth.uid(),
  criado_em timestamptz not null default now()
);
alter table public.estoque_ajustes enable row level security;
alter table public.estoque_ajustes add constraint estoque_ajustes_produto_id_fkey foreign key (produto_id) references products(id) on delete set null;
alter table public.estoque_ajustes add constraint estoque_ajustes_delta_check check ((delta <> 0));
alter table public.estoque_ajustes add constraint estoque_ajustes_motivo_check check (((char_length(motivo) >= 2) and (char_length(motivo) <= 120)) and (motivo !~ '[<>]'));

-- ---------- whatsapp_config ----------
create table if not exists public.whatsapp_config (
  id integer not null default 1,
  aviso_interno text,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.whatsapp_config enable row level security;
alter table public.whatsapp_config add constraint whatsapp_config_id_check check ((id = 1));
alter table public.whatsapp_config add constraint whatsapp_config_aviso_check check (((aviso_interno is null) or (aviso_interno ~ '^[0-9]{12,13}$')));

-- ---------- whatsapp_envios ----------
create table if not exists public.whatsapp_envios (
  id bigint generated always as identity primary key,
  ref text not null,
  modelo text not null,
  destino text not null,
  variaveis jsonb not null default '[]'::jsonb,
  botao text,
  origem_tipo text not null,
  origem_ref text,
  evento_status text,
  enviar_apos timestamptz not null default now(),
  status text not null default 'pendente',
  tentativas integer not null default 0,
  pego_em timestamptz,
  erro text,
  resposta jsonb,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);
alter table public.whatsapp_envios enable row level security;
alter table public.whatsapp_envios add constraint whatsapp_envios_ref_key unique (ref);
alter table public.whatsapp_envios add constraint whatsapp_envios_destino_check check ((destino ~ '^[0-9]{12,13}$'));
alter table public.whatsapp_envios add constraint whatsapp_envios_origem_tipo_check check ((origem_tipo = any(array['pedido','delivery','cadastro','interno','teste'])));
alter table public.whatsapp_envios add constraint whatsapp_envios_status_check_vivo check ((status = any(array['pendente','enviando','enviado','erro','ignorado'])));

-- ---------- avisos_cliente ----------
create table if not exists public.avisos_cliente (
  id bigint generated always as identity primary key,
  ref text not null,
  origem_tipo text not null,
  origem_ref text not null,
  evento text not null,
  nome text,
  telefone text,
  dados jsonb,
  criado_em timestamptz not null default now(),
  avisado_em timestamptz,
  dispensado_em timestamptz
);
alter table public.avisos_cliente enable row level security;
alter table public.avisos_cliente add constraint avisos_cliente_ref_key unique (ref);
alter table public.avisos_cliente add constraint avisos_cliente_origem_check check ((origem_tipo = any(array['cadastro','pedido','delivery'])));

-- ---------- caixa_movimentos ----------
create table if not exists public.caixa_movimentos (
  id bigint generated always as identity primary key,
  sessao_id bigint not null,
  tipo text not null,
  categoria text not null,
  observacao text not null,
  valor numeric(10,2) not null,
  devolvido numeric(10,2) not null default 0,
  devolvido_em timestamptz,
  atendente_id uuid not null default auth.uid(),
  criado_em timestamptz not null default now(),
  anulado_em timestamptz
);
alter table public.caixa_movimentos enable row level security;
alter table public.caixa_movimentos add constraint caixa_movimentos_sessao_id_fkey foreign key (sessao_id) references caixa_sessoes(id) on delete cascade;
alter table public.caixa_movimentos add constraint caixa_movimentos_atendente_id_fkey foreign key (atendente_id) references auth.users(id) on delete set null;
alter table public.caixa_movimentos add constraint caixa_movimentos_tipo_check_vivo check ((tipo = any(array['retirada','reforco'])));
alter table public.caixa_movimentos add constraint caixa_movimentos_categoria_check check ((categoria = any(array['compra_loja','fornecedor','dono','troco','outro'])));
alter table public.caixa_movimentos add constraint caixa_movimentos_dev_check check ((devolvido >= 0) and (devolvido <= valor));
alter table public.caixa_movimentos add constraint caixa_movimentos_retirada_check check ((tipo != 'retirada' or devolvido = 0));
alter table public.caixa_movimentos add constraint caixa_movimentos_valor_check check ((valor > 0));
alter table public.caixa_movimentos add constraint caixa_movimentos_obs_check check (((char_length(btrim(observacao)) >= 2) and (char_length(btrim(observacao)) <= 200)) and (observacao !~ '[<>]'));

-- ---------- rotas ----------
create table if not exists public.rotas (
  id bigint generated always as identity primary key,
  dia date not null,
  periodo text not null,
  status text not null default 'planejada',
  distancia_km numeric(8,1),
  duracao_min integer,
  geometria jsonb,
  criada_em timestamptz not null default now(),
  iniciada_em timestamptz,
  concluida_em timestamptz,
  avaliacao jsonb
);
alter table public.rotas enable row level security;
alter table public.rotas add constraint rotas_dia_periodo_key unique (dia, periodo);
alter table public.rotas add constraint rotas_periodo_check check ((periodo = any(array['manha','tarde'])));
alter table public.rotas add constraint rotas_status_check_vivo check ((status = any(array['planejada','em_andamento','concluida'])));
alter table public.rotas add constraint rotas_distancia_check check ((distancia_km is null or distancia_km >= 0));

-- ---------- rota_paradas ----------
create table if not exists public.rota_paradas (
  id bigint generated always as identity primary key,
  rota_id bigint not null,
  ordem integer not null,
  tipo text not null,
  ref text not null,
  nome text,
  telefone text,
  endereco text,
  lat double precision,
  lng double precision,
  geo_fonte text,
  geo_alerta text,
  eta timestamptz,
  chegou_em timestamptz,
  status text not null default 'pendente'
);
alter table public.rota_paradas enable row level security;
alter table public.rota_paradas add constraint rota_paradas_rota_id_fkey foreign key (rota_id) references rotas(id) on delete cascade;
alter table public.rota_paradas add constraint rota_paradas_rota_ref_key unique (rota_id, ref);
alter table public.rota_paradas add constraint rota_paradas_tipo_check_vivo check ((tipo = any(array['delivery','revenda'])));
alter table public.rota_paradas add constraint rota_paradas_status_check_vivo check ((status = any(array['pendente','feita','pulada'])));

-- ---------- rota_posicao ----------
create table if not exists public.rota_posicao (
  rota_id bigint not null primary key,
  lat double precision not null,
  lng double precision not null,
  precisao real,
  atualizado_em timestamptz not null default now()
);
alter table public.rota_posicao enable row level security;
alter table public.rota_posicao add constraint rota_posicao_rota_id_fkey foreign key (rota_id) references rotas(id) on delete cascade;

-- ---------- geo_enderecos ----------
create table if not exists public.geo_enderecos (
  chave text not null primary key,
  lat double precision not null,
  lng double precision not null,
  label text,
  fonte text,
  atualizado_em timestamptz not null default now()
);
alter table public.geo_enderecos enable row level security;

-- ---------- revenda_checkouts ----------
create table if not exists public.revenda_checkouts (
  id bigint generated always as identity primary key,
  token uuid not null default gen_random_uuid(),
  revendedor_id uuid not null,
  rows jsonb not null,
  entrega jsonb not null,
  total numeric(10,2) not null,
  status text not null default 'aguardando',
  numero text,
  mp_payment_id text,
  mp_status text,
  erro text,
  criado_em timestamptz not null default now(),
  pago_em timestamptz
);
alter table public.revenda_checkouts enable row level security;
alter table public.revenda_checkouts add constraint revenda_checkouts_token_key unique (token);
alter table public.revenda_checkouts add constraint revenda_checkouts_revendedor_id_fkey foreign key (revendedor_id) references profiles(id) on delete cascade;
alter table public.revenda_checkouts add constraint revenda_checkouts_status_check_vivo check ((status = any(array['aguardando','pago','erro','expirado'])));

-- ---------- entrega_cotacoes ----------
create table if not exists public.entrega_cotacoes (
  id uuid not null default gen_random_uuid() primary key,
  lat double precision not null,
  lng double precision not null,
  km numeric(6,1) not null,
  taxa numeric(10,2) not null,
  impreciso boolean not null default false,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '2 hours')
);
alter table public.entrega_cotacoes enable row level security;
alter table public.entrega_cotacoes add constraint entrega_cotacoes_taxa_check check ((taxa >= 0));

-- ==========================================================================
-- ==========================================================================
-- FKs / CHECKs DEPENDENTES â€” referenciam tabelas criadas mais adiante
-- ==========================================================================
alter table public.product_flavor_stock add constraint product_flavor_stock_produto_id_fkey foreign key (produto_id) references products(id) on delete cascade;
alter table public.orders add constraint orders_caixa_sessao_id_fkey_dep foreign key (caixa_sessao_id) references caixa_sessoes(id) on delete set null;

-- =========================================================
-- Constraints FALTANTES do banco vivo para tabela products
-- (os CHECKs e FK nÃ£o foram incluÃ­dos inline no CREATE TABLE original)
-- =========================================================
alter table public.products add constraint products_estoque_ref_fkey foreign key (estoque_ref) references products(id) on delete set null;
alter table public.products add constraint products_preco_check check ((preco >= 0));
alter table public.products add constraint products_estoque_check check ((estoque >= 0));
alter table public.products add constraint products_litros_check check ((litros >= 0));
alter table public.products add constraint products_acomp_extra_preco_check check ((acomp_extra_preco >= 0));
alter table public.products add constraint products_acomp_gratis_check check (((acomp_gratis >= 0) and (acomp_gratis <= 20)));
alter table public.products add constraint products_tipo_check_vivo check ((tipo = any(array['atacado','varejo'])));
alter table public.products add constraint products_modo_check_vivo check ((modo = any(array['embalado','copo','peso'])));
alter table public.products add constraint products_pedido_minimo_check check (((pedido_minimo >= 1) and (pedido_minimo <= 99)));

-- ==========================================================================
-- Ãndices nÃ£o-criados-por-constraint
-- ==========================================================================
-- Ãndices adicionais para performance (nÃ£o correspondem a nenhuma constraint acima).
-- Os Ã­ndices de unicidade/pk/junÃ§Ã£o jÃ¡ estÃ£o cobertos pelos constraints inline/ALTER acima.
-- create index if not exists na ordem correta das tabelas:

create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_revendedor_id on public.orders(revendedor_id);
create index if not exists idx_orders_data on public.orders(data);
create index if not exists idx_products_nome on public.products(nome);
create index if not exists idx_product_flavor_stock_produto_id on public.product_flavor_stock(produto_id);
create index if not exists idx_caixa_sessoes_atendente_id on public.caixa_sessoes(atendente_id);
create index if not exists idx_caixa_sessoes_status on public.caixa_sessoes(status);
create index if not exists idx_caixa_promocoes_produto_dia on public.caixa_promocoes(produto_id, dia);
create index if not exists idx_nfce_emissoes_ref on public.nfce_emissoes(ref);
create index if not exists idx_nfce_emissoes_status on public.nfce_emissoes(status);
create index if not exists idx_delivery_pedidos_status on public.delivery_pedidos(status);
create index if not exists idx_delivery_pedidos_token on public.delivery_pedidos(token);
create index if not exists idx_estoque_ajustes_produto_id on public.estoque_ajustes(produto_id);
create index if not exists idx_whatsapp_envios_status on public.whatsapp_envios(status);
create index if not exists idx_whatsapp_envios_origem on public.whatsapp_envios(origem_tipo, origem_ref);
create index if not exists idx_avisos_cliente_origem on public.avisos_cliente(origem_tipo, origem_ref);
create index if not exists idx_caixa_movimentos_sessao_id on public.caixa_movimentos(sessao_id);
create index if not exists idx_rotas_dia on public.rotas(dia);
create index if not exists idx_rotas_periodo on public.rotas(periodo);
create index if not exists idx_rota_paradas_rota_id on public.rota_paradas(rota_id);
create index if not exists idx_revenda_checkouts_token on public.revenda_checkouts(token);
create index if not exists idx_norte_leads_status on public.norte_leads(status);
create index if not exists idx_producao_itens_producao_id on public.producao_itens(producao_id);
create index if not exists idx_producao_gastos_producao_id on public.producao_gastos(producao_id);
create index if not exists idx_orders_original_unique on public.orders(numero, data);

-- ==========================================================================
-- PolÃ­ticas RLS (53) â€” pg_policies
-- ==========================================================================
create policy acompanhamentos_delete_admin on public.acompanhamentos as permissive for delete to public using (is_admin());
create policy acompanhamentos_insert_admin on public.acompanhamentos as permissive for insert to public with check (is_admin());
create policy acompanhamentos_select_authenticated on public.acompanhamentos as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy acompanhamentos_update_admin on public.acompanhamentos as permissive for update to public using (is_admin());
create policy app_settings_select_authenticated on public.app_settings as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy app_settings_write_admin on public.app_settings as permissive for all to public, authenticated using (is_admin()) with check (is_admin());
create policy avisos_cliente_admin on public.avisos_cliente as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));
create policy caixa_movimentos_select on public.caixa_movimentos as permissive for select to authenticated using ((( SELECT is_atendente() AS is_atendente) OR ( SELECT is_admin() AS is_admin)));
create policy pedidos_abertos_all on public.caixa_pedidos_abertos as permissive for all to authenticated using (is_atendente() OR is_admin()) with check (is_atendente() OR is_admin());
create policy promos_delete_equipe on public.caixa_promocoes as permissive for delete to public using ((is_atendente() OR is_admin()) AND (dia = ((now() AT TIME ZONE 'America/Cuiaba'::text))::date));
create policy promos_insert_equipe on public.caixa_promocoes as permissive for insert to public with check ((is_atendente() OR is_admin()) AND (dia = ((now() AT TIME ZONE 'America/Cuiaba'::text))::date));
create policy promos_select_equipe on public.caixa_promocoes as permissive for select to public using (is_atendente() OR is_admin());
create policy promos_update_equipe on public.caixa_promocoes as permissive for update to public using ((is_atendente() OR is_admin()) AND (dia = ((now() AT TIME ZONE 'America/Cuiaba'::text))::date)) with check ((is_atendente() OR is_admin()) AND (dia = ((now() AT TIME ZONE 'America/Cuiaba'::text))::date));
create policy caixa_sessoes_select on public.caixa_sessoes as permissive for select to public using (is_admin() OR (atendente_id = auth.uid()));
create policy coupons_delete_admin on public.coupons as permissive for delete to public using (is_admin());
create policy coupons_insert_admin on public.coupons as permissive for insert to public with check (is_admin());
create policy coupons_select_own_approved_or_admin on public.coupons as permissive for select to public using ((((auth.uid() = revendedor_id) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.status = 'aprovado'::text))))) OR is_admin()));
create policy delivery_config_admin on public.delivery_config as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy delivery_config_select on public.delivery_config as permissive for select to anon, authenticated using (true);
create policy delivery_pedidos_admin on public.delivery_pedidos as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy estoque_ajustes_admin_select on public.estoque_ajustes as permissive for select to authenticated using (( SELECT is_admin() AS is_admin));
create policy geo_enderecos_admin on public.geo_enderecos as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));
create policy nfce_select_caixa_admin on public.nfce_emissoes as permissive for select to public using (is_atendente() OR is_admin());
create policy norte_leads_insert_public on public.norte_leads as permissive for insert to anon, authenticated with check (true);
create policy norte_leads_select_admin on public.norte_leads as permissive for select to authenticated using (norte_is_admin());
create policy norte_leads_update_admin on public.norte_leads as permissive for update to authenticated using (norte_is_admin()) with check (norte_is_admin());
create policy order_audits_select_admin on public.order_audits as permissive for select to public using (is_admin());
create policy orders_delete_admin on public.orders as permissive for delete to public using (is_admin());
create policy orders_insert_admin on public.orders as permissive for insert to public with check (is_admin());
create policy orders_insert_atendente on public.orders as permissive for insert to public with check ((is_atendente() AND (atendente_id = auth.uid()) AND (origem = 'loja'::text) AND (status = 'entregue'::text) AND (usa_estoque = COALESCE(( SELECT (p.modo = 'embalado'::text) FROM products p WHERE (p.id = orders.produto_id)), false)));
create policy orders_select_atendente on public.orders as permissive for select to public using (is_atendente() AND (origem = 'loja'::text));
create policy orders_select_own_approved_or_admin on public.orders as permissive for select to public using ((((auth.uid() = revendedor_id) AND (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.status = 'aprovado'::text))))) OR is_admin()));
create policy orders_update_admin on public.orders as permissive for update to public using (is_admin());
create policy producao_gastos_all_admin on public.producao_gastos as permissive for all to public using (is_admin()) with check (is_admin());
create policy producao_itens_all_admin on public.producao_itens as permissive for all to public using (is_admin()) with check (is_admin());
create policy producoes_all_admin on public.producoes as permissive for all to public using (is_admin()) with check (is_admin());
create policy pfs_delete_admin on public.product_flavor_stock as permissive for delete to public using (is_admin());
create policy pfs_insert_admin on public.product_flavor_stock as permissive for insert to public with check (is_admin());
create policy pfs_select_authenticated on public.product_flavor_stock as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy pfs_update_admin on public.product_flavor_stock as permissive for update to public using (is_admin());
create policy products_delete_admin on public.products as permissive for delete to public using (is_admin());
create policy products_insert_admin on public.products as permissive for insert to public with check (is_admin());
create policy products_select_authenticated on public.products as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy products_update_admin on public.products as permissive for update to public using (is_admin());
create policy profiles_select_atendente on public.profiles as permissive for select to public using (is_atendente() AND (role = 'revendedor'::text) AND (status = 'aprovado'::text));
create policy profiles_select_own_or_admin on public.profiles as permissive for select to public using ((auth.uid() = id) OR is_admin());
create policy profiles_update_own_or_admin on public.profiles as permissive for update to public using ((auth.uid() = id) OR is_admin());
create policy revenda_checkouts_dono on public.revenda_checkouts as permissive for select to authenticated using (((revendedor_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin)));
create policy rota_paradas_admin on public.rota_paradas as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));
create policy rota_posicao_admin on public.rota_posicao as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));
create policy rotas_admin on public.rotas as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));
create policy whatsapp_config_admin on public.whatsapp_config as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));
create policy whatsapp_envios_admin_le on public.whatsapp_envios as permissive for select to authenticated using (( SELECT is_admin() AS is_admin));

-- ==========================================================================
-- FunÃ§Ãµes (64 corpo) + Grants de Execute (~60)
-- ==========================================================================

-- handle_new_user
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, nome, empresa, telefone, cidade, aceita_whatsapp)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'nome',
    new.raw_user_meta_data->>'empresa',
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'cidade',
    coalesce((new.raw_user_meta_data->>'aceita_whatsapp')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role, supabase_auth_admin;

-- is_admin
create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
	select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$function$;
grant execute on function public.is_admin() to public, authenticated, service_role;

-- adjust_stock_on_order_change
create or replace function public.adjust_stock_on_order_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (tg_op = 'INSERT') then
    if new.usa_estoque then
      if public.order_consumes_stock(new.status) then
        perform public.apply_stock_delta(new.produto_id, new.sabor, -new.quantidade);
      elsif new.status = 'enviado' then
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
$function$;
revoke execute on function public.adjust_stock_on_order_change() from public, anon, authenticated;
grant execute on function public.adjust_stock_on_order_change() to service_role;

-- apply_stock_delta
create or replace function public.apply_stock_delta(p_produto_id bigint, p_sabor text, p_delta integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ref bigint;
  v_ref_sabor text;
  v_target bigint;
  v_sabor text;
  is_multi boolean;
  v_sync boolean := coalesce(current_setting('dupuro.sync_offline', true), 'off') = 'on';
begin
  if p_produto_id is null or p_delta is null then return; end if;
  select estoque_ref, estoque_ref_sabor into v_ref, v_ref_sabor from public.products where id = p_produto_id;
  v_target := coalesce(v_ref, p_produto_id);
  v_sabor := coalesce(v_ref_sabor, p_sabor);
  select multissabor into is_multi from public.products where id = v_target;
  if is_multi is true and v_sabor is not null then
    if v_sync then
      update public.product_flavor_stock set estoque = greatest(0, estoque + p_delta)
        where produto_id = v_target and sabor = v_sabor;
    else
      update public.product_flavor_stock set estoque = estoque + p_delta
        where produto_id = v_target and sabor = v_sabor;
      if not found and p_delta < 0 then
        raise exception 'Sem estoque para o sabor %', v_sabor using errcode = '23514';
      end if;
    end if;
  else
    if v_sync then
      update public.products set estoque = greatest(0, estoque + p_delta) where id = v_target;
    else
      update public.products set estoque = estoque + p_delta where id = v_target;
    end if;
  end if;
end;
$function$;
revoke execute on function public.apply_stock_delta(bigint, text, integer) from public, anon, authenticated;
grant execute on function public.apply_stock_delta(bigint, text, integer) to service_role;

-- order_consumes_stock
create or replace function public.order_consumes_stock(p_status text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p_status in ('processando', 'entregue');
$function$;
grant execute on function public.order_consumes_stock(text) to service_role;

-- available_stock
create or replace function public.available_stock(p_produto_id bigint, p_sabor text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
revoke execute on function public.available_stock(bigint, text) from public, anon, authenticated;
grant execute on function public.available_stock(bigint, text) to service_role;

-- is_atendente
create or replace function public.is_atendente()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'atendente' and status = 'aprovado'
  );
$function$;
grant execute on function public.is_atendente() to public, authenticated, service_role;

-- next_pedido_numero
create or replace function public.next_pedido_numero()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select 'PED-' || (
    coalesce(max((regexp_match(numero, '^PED-(\d+)$'))[1]::int), 1000) + 1
  )::text
  from public.orders;
$function$;
grant execute on function public.next_pedido_numero() to authenticated, service_role;

-- next_venda_numero
create or replace function public.next_venda_numero()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select 'VND-' || lpad((
    coalesce(max((regexp_match(numero, '^VND-(\d+)$'))[1]::int), 0) + 1
  )::text, 4, '0')
  from public.orders;
$function$;
grant execute on function public.next_venda_numero() to authenticated, service_role;

-- caixa_pode_mexer
create or replace function public.caixa_pode_mexer(p_numero text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
$function$;
grant execute on function public.caixa_pode_mexer(text) to service_role;

-- caixa_cancelar_venda
create or replace function public.caixa_cancelar_venda(p_numero text, p_motivo text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_snap jsonb;
begin
  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if not public.caixa_pode_mexer(p_numero) then
    raise exception 'Sem permissÃ£o para cancelar esta venda.';
  end if;

  select jsonb_agg(to_jsonb(o)) into v_snap
    from public.orders o where o.numero = p_numero and o.origem = 'loja';

  update public.orders
     set status = 'cancelado', cancel_motivo = p_motivo
   where numero = p_numero and origem = 'loja' and status <> 'cancelado';

  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'cancelou', p_motivo, v_snap, auth.uid());
end;
$function$;
revoke execute on function public.caixa_cancelar_venda(text, text) from public, anon, authenticated;
grant execute on function public.caixa_cancelar_venda(text, text) to authenticated, service_role;

-- caixa_substituir_venda
create or replace function public.caixa_substituir_venda(p_numero text, p_motivo text, p_rows jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_snap jsonb; v_sessao bigint; r jsonb;
begin
  if not public.caixa_pode_mexer(p_numero) then
    raise exception 'Sem permissÃ£o para editar esta venda.';
  end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'A venda precisa ter ao menos um item.';
  end if;
  select jsonb_agg(to_jsonb(o)) into v_snap
    from public.orders o where o.numero = p_numero and o.origem = 'loja';
  select caixa_sessao_id into v_sessao
    from public.orders where numero = p_numero and origem = 'loja' limit 1;
  delete from public.orders where numero = p_numero and origem = 'loja';
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, detalhes, forma_pagamento, pagamentos,
      entrega, entrega_info, caixa_sessao_id, origem, atendente_id
    ) values (
      nullif(r->>'revendedor_id', '')::uuid,
      p_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiaba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint,
      nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''),
      coalesce((select p.modo = 'embalado' from public.products p where p.id = nullif(r->>'produto_id', '')::bigint), false),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      nullif(r->>'forma_pagamento', ''),
      case when r ? 'pagamentos' and jsonb_typeof(r->'pagamentos') = 'array' then r->'pagamentos' else null end,
      coalesce((r->>'entrega')::boolean, false),
      case when r ? 'entrega_info' and jsonb_typeof(r->'entrega_info') = 'object' then r->'entrega_info' else null end,
      v_sessao,
      'loja', auth.uid()
    );
  end loop;
  insert into public.order_audits (numero, acao, motivo, snapshot, atendente_id)
  values (p_numero, 'editou', p_motivo, v_snap, auth.uid());
end;
$function$;
revoke execute on function public.caixa_substituir_venda(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.caixa_substituir_venda(text, text, jsonb) to authenticated, service_role;

-- litros_dispensa_minimo
create or replace function public.litros_dispensa_minimo()
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select valor from public.app_settings where chave = 'litros_dispensa_minimo'), 50);
$function$;
grant execute on function public.litros_dispensa_minimo() to authenticated, service_role;

-- volume_do_pedido
create or replace function public.volume_do_pedido(p_rows jsonb)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(sum(p.litros * (e->>'quantidade')::int), 0)
  from jsonb_array_elements(p_rows) e
  join public.products p on p.id = (e->>'produto_id')::bigint;
$function$;
grant execute on function public.volume_do_pedido(jsonb) to service_role;

-- sincronizar_venda_offline
create or replace function public.sincronizar_venda_offline(p_rows jsonb, p_client_uuid uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_numero text; v_existente text; r jsonb; v_primeira boolean := true;
begin
  if not (public.is_atendente() or public.is_admin()) then
    raise exception 'Sem permissÃ£o para sincronizar vendas.';
  end if;
  if p_client_uuid is null then raise exception 'client_uuid obrigatÃ³rio.'; end if;
  select numero into v_existente from public.orders where client_uuid = p_client_uuid limit 1;
  if v_existente is not null then return v_existente; end if;

  perform set_config('dupuro.sync_offline', 'on', true);
  v_numero := public.next_venda_numero();
  for r in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.orders (
      revendedor_id, numero, data, itens, valor, status,
      produto_id, quantidade, sabor, usa_estoque, detalhes,
      forma_pagamento, pagamentos, entrega, entrega_info, caixa_sessao_id, origem, atendente_id, client_uuid
    ) values (
      nullif(r->>'revendedor_id', '')::uuid, v_numero,
      coalesce(nullif(r->>'data', ''), (now() at time zone 'America/Cuiuba')::date::text)::date,
      r->>'itens', (r->>'valor')::numeric, 'entregue',
      nullif(r->>'produto_id', '')::bigint, nullif(r->>'quantidade', '')::int,
      nullif(r->>'sabor', ''),
      coalesce((select p.modo = 'embalado' from public.products p where p.id = nullif(r->>'produto_id', '')::bigint), false),
      case when r ? 'detalhes' then r->'detalhes' else null end,
      nullif(r->>'forma_pagamento', ''),
      case when r ? 'pagamentos' and jsonb_typeof(r->'pagamentos') = 'array' then r->'pagamentos' else null end,
      coalesce((r->>'entrega')::boolean, false),
      case when r ? 'entrega_info' and jsonb_typeof(r->'entrega_info') = 'object' then r->'entrega_info' else null end,
      nullif(r->>'caixa_sessao_id', '')::bigint,
      'loja', auth.uid(),
      case when v_primeira then p_client_uuid else null end
    );
    v_primeira := false;
  end loop;
  return v_numero;
end;
$function$;
revoke execute on function public.sincronizar_venda_offline(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.sincronizar_venda_offline(jsonb, uuid) to authenticated, service_role;

-- caixa_sessao_aberta
create or replace function public.caixa_sessao_aberta()
 returns table(id bigint, fundo_troco numeric, aberta_em timestamp with time zone, atendente_id uuid)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select id, fundo_troco, aberta_em, atendente_id from public.caixa_sessoes where status = 'aberta' limit 1;
$function$;
grant execute on function public.caixa_sessao_aberta() to authenticated, service_role;

-- abrir_caixa
create or replace function public.abrir_caixa(p_fundo numeric)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id bigint;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissÃ£o.'; end if;
  if exists (select 1 from public.caixa_sessoes where status = 'aberta') then
    raise exception 'JÃ¡ existe um caixa aberto.';
  end if;
  insert into public.caixa_sessoes (atendente_id, status, fundo_troco)
  values (auth.uid(), 'aberta', coalesce(p_fundo, 0)) returning id into v_id;
  return v_id;
end;
$function$;
revoke execute on function public.abrir_caixa(numeric) from public, anon, authenticated;
grant execute on function public.abrir_caixa(numeric) to authenticated, service_role;

-- fechar_caixa
create or replace function public.fechar_caixa(p_sessao_id bigint, p_dinheiro_contado numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_fundo numeric; v_resumo jsonb; v_esperado numeric; v_dif numeric;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissÃ£o.'; end if;
  select fundo_troco into v_fundo from public.caixa_sessoes where id = p_sessao_id and status = 'aberta' for update;
  if not found then raise exception 'Caixa nÃ£o estÃ¡ aberto.'; end if;
  v_resumo := public.resumo_caixa(p_sessao_id);
  v_esperado := (v_resumo->>'dinheiro_esperado')::numeric;
  v_dif := coalesce(p_dinheiro_contado, 0) - v_esperado;
  v_resumo := v_resumo || jsonb_build_object('dinheiro_contado', coalesce(p_dinheiro_contado, 0), 'diferenca', v_dif);
  update public.caixa_sessoes set status = 'fechada', fechada_em = now(),
    dinheiro_contado = p_dinheiro_contado, dinheiro_esperado = v_esperado,
    diferenca = v_dif, resumo = v_resumo
    where id = p_sessao_id;
  return v_resumo;
end $function$;
revoke execute on function public.fechar_caixa(bigint, numeric) from public, anon, authenticated;
grant execute on function public.fechar_caixa(bigint, numeric) to authenticated, service_role;

-- resumo_caixa
create or replace function public.resumo_caixa(p_sessao_id bigint)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_fundo numeric; v_total numeric; v_dinheiro numeric; v_qtd int; v_por_forma jsonb; v_mov jsonb;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissÃ£o.'; end if;
  select fundo_troco into v_fundo from public.caixa_sessoes where id = p_sessao_id;
  select coalesce(sum(valor), 0), count(distinct numero)
    into v_total, v_qtd
    from public.orders where caixa_sessao_id = p_sessao_id and status <> 'cancelado';
  select coalesce(sum(valor) filter (where forma = 'dinheiro'), 0)
    into v_dinheiro from public.caixa_formas_pagamento(p_sessao_id);
  select coalesce(jsonb_object_agg(forma, s), '{}'::jsonb) into v_por_forma from (
    select forma, sum(valor) as s from public.caixa_formas_pagamento(p_sessao_id) group by forma
  ) t;
  v_mov := public.caixa_movimentos_resumo(p_sessao_id);
  return jsonb_build_object(
    'total', v_total, 'qtd', v_qtd, 'por_forma', v_por_forma,
    'fundo_troco', coalesce(v_fundo, 0),
    'retiradas', (v_mov->>'retiradas')::numeric, 'reforcos', (v_mov->>'reforcos')::numeric, 'movimentos', v_mov->'movimentos',
    'dinheiro_esperado', coalesce(v_fundo, 0) + v_dinheiro + (v_mov->>'reforcos')::numeric - (v_mov->>'retiradas')::numeric
  );
end $function$;
revoke execute on function public.resumo_caixa(bigint) from public, anon, authenticated;
grant execute on function public.resumo_caixa(bigint) to authenticated, service_role;

-- check_limite_promocoes
create or replace function public.check_limite_promocoes()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare v_qtd int;
begin
  select count(*) into v_qtd from public.caixa_promocoes
    where dia = new.dia and tipo = new.tipo and id <> new.id;
  if v_qtd >= 3 then
    raise exception 'Limite de 3 promoÃ§Ãµes do tipo % por dia atingido.', new.tipo
      using errcode = 'check_violation';
  end if;
  return new;
end; $function$;
grant execute on function public.check_limite_promocoes() to service_role;

-- caixa_formas_pagamento
create or replace function public.caixa_formas_pagamento(p_sessao_id bigint)
 returns table(forma text, valor numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with vendas as (
    select numero,
           max(forma_pagamento) as forma,
           (array_agg(pagamentos) filter (where pagamentos is not null))[1] as pagamentos,
           sum(valor) as total
      from public.orders
      where caixa_sessao_id = p_sessao_id and status <> 'cancelado'
      group by numero
  )
  select coalesce(p.forma, coalesce(v.forma, 'sem')) as forma,
         coalesce(p.valor, v.total) as valor
    from vendas v
    left join lateral (
      select el->>'forma' as forma, (el->>'valor')::numeric as valor
        from jsonb_array_elements(v.pagamentos) el
    ) p on true;
$function$;
grant execute on function public.caixa_formas_pagamento(bigint) to service_role;

-- norte_is_admin
create or replace function public.norte_is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.norte_admins
    where lower(email) = lower(coalesce(auth.email(), ''))
  );
$function$;
grant execute on function public.norte_is_admin() to public, authenticated, service_role;

-- delivery_catalogo
create or replace function public.delivery_catalogo()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with cfg as (select config from public.delivery_config where id = 1),
  ids as (select (jsonb_array_elements_text(config->'produtos'))::bigint as id from cfg)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'nome', p.nome, 'preco', p.preco, 'imagem_url', p.imagem_url, 'litros', p.litros,
    'multissabor', p.multissabor,
    'estoque', case when p.multissabor then null else src.estoque end,
    'sabores', case when p.multissabor then (
       select coalesce(jsonb_agg(jsonb_build_object('sabor', f.sabor, 'estoque', f.estoque) order by f.sabor), '[]'::jsonb)
       from public.product_flavor_stock f
       where f.produto_id = src.id and (p.multissabor_incluir_acai or f.sabor <> 'AÃ§aÃ­')
    ) else '[]'::jsonb end
  ) order by p.preco), '[]'::jsonb)
  from ids
  join public.products p on p.id = ids.id
  join public.products src on src.id = coalesce(p.estoque_ref, p.id);
$function$;
revoke execute on function public.delivery_catalogo() from public, anon, authenticated;
grant execute on function public.delivery_catalogo() to public, authenticated, service_role;

-- delivery_rastreio
create or replace function public.delivery_rastreio(p_token uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare p public.delivery_pedidos%rowtype; pa record; v_rota jsonb := null; v_faltam int; v_pos record;
  v_raio numeric; v_dist numeric; v_fase text;
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
    select lat, lng, atualizado_em into v_pos from public.rota_posicao
     where rota_id = pa.rota_id and atualizado_em > now() - interval '3 minutes';
    if v_pos.lat is not null and pa.lat is not null then
      v_dist := 2 * 6371 * asin(sqrt(power(sin(radians(pa.lat - v_pos.lat) / 2), 2) +
                cos(radians(v_pos.lat)) * cos(radians(pa.lat)) * power(sin(radians(pa.lng - v_lng) / 2), 2)));
    end if;
    select coalesce((config->>'raio_mapa_km')::numeric, 5) into v_raio from public.delivery_config where id = 1;
    v_fase := case when v_faltam = 0 then 'a_caminho'
                   when v_dist <= coalesce(v_raio, 5) then 'perto'
                   else 'longe' end;
    v_rota := jsonb_build_object('fase', v_fase, 'faltam', v_faltam, 'eta', pa.eta);
    if v_fase <> 'longe' then
      v_rota := v_rota || jsonb_build_object('proxima', v_faltam = 0, 'destino', jsonb_build_object('lat', pa.lat, 'lng', pa.lng),
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
end $function$;
revoke execute on function public.delivery_rastreio(uuid) from public, anon, authenticated;
grant execute on function public.delivery_rastreio(uuid) to public, authenticated, service_role;

-- delivery_confirmar_pagamento
create or replace function public.delivery_confirmar_pagamento(p_codigo text, p_payment_id text, p_metodo text, p_mp_status text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v public.delivery_pedidos%rowtype; it jsonb; v_src bigint; v_qtd int;
begin
  select * into v from public.delivery_pedidos where codigo = p_codigo for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if v.status <> 'aguardando_pagamento' and v.status <> 'expirado' then
    update public.delivery_pedidos set mp_status = p_mp_status, atualizado_em = now() where id = v.id;
    return jsonb_build_object('ok', true, 'ja_processado', true, 'status', v.status);
  end if;
  for it in select * from jsonb_array_elements(v.itens) loop
    v_qtd := coalesce((it->>'quantidade')::int, 0);
    select coalesce(estoque_ref, id) into v_src from public.products where id = (it->>'produto_id')::bigint;
    if v_src is null then continue; end if;
    if coalesce(it->>'sabor', '') <> '' then
      update public.product_flavor_stock set estoque = greatest(estoque - v_qtd, 0)
       where produto_id = v_src and sabor = it->>'sabor';
    else
      update public.products set estoque = greatest(estoque - v_qtd, 0) where id = v_src;
    end if;
  end loop;
  update public.delivery_pedidos set status = 'pago', pago_em = now(), mp_payment_id = p_payment_id,
    pagamento_metodo = p_metodo, mp_status = p_mp_status, atualizado_em = now()
   where id = v.id;
  return jsonb_build_object('ok', true, 'status', 'pago', 'token', v.token);
end;
$function$;
revoke execute on function public.delivery_confirmar_pagamento(text, text, text, text) from public, anon, authenticated;
grant execute on function public.delivery_confirmar_pagamento(text, text, text, text) to service_role;

-- producao_aplicar_delta
create or replace function public.producao_aplicar_delta(p_antes jsonb, p_depois jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in
    select x.produto_id, x.sabor, sum(x.qtd)::int as delta
    from (
      select (e->>'produto_id')::bigint as produto_id, nullif(e->>'sabor', '') as sabor,
             -round(coalesce((e->>'quantidade')::numeric, 0)) as qtd
        from jsonb_array_elements(coalesce(p_antes, '[]'::jsonb)) e
      union all
      select (e->>'produto_id')::bigint, nullif(e->>'sabor', ''),
             round(coalesce((e->>'quantidade')::numeric, 0))
        from jsonb_array_elements(coalesce(p_depois, '[]'::jsonb)) e
    ) x
    join public.products p on p.id = x.produto_id and p.modo = 'embalado'
    group by x.produto_id, x.sabor
    having sum(x.qtd) <> 0
    order by x.produto_id, x.sabor nulls first
  loop
    if r.delta > 0 and r.sabor is not null then
      insert into public.product_flavor_stock (produto_id, sabor, estoque)
      select coalesce(p.estoque_ref, p.id), r.sabor, 0
        from public.products p
        join public.products alvo on alvo.id = coalesce(p.estoque_ref, p.id) and alvo.multissabor
       where p.id = r.produto_id and p.estoque_ref_sabor is null
      on conflict (produto_id, sabor) do nothing;
    end if;
    perform public.apply_stock_delta(r.produto_id, r.sabor, r.delta);
  end loop;
end;
$function$;
grant execute on function public.producao_aplicar_delta(jsonb, jsonb) to service_role;

-- salvar_producao
create or replace function public.salvar_producao(p_id bigint, p_header jsonb, p_gastos jsonb, p_itens jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id bigint := p_id;
  v_antes jsonb;
  v_faltando text;
begin
  if not public.is_admin() then
    raise exception 'SÃ³ admin registra produÃ§Ã£o' using errcode = '42501';
  end if;

  select string_agg(distinct p.nome, ', ') into v_faltando
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
    join public.products p on p.id = (e->>'produto_id')::bigint
   where p.multissabor and p.estoque_ref_sabor is null and nullif(e->>'sabor', '') is null;
  if v_faltando is not null then
    raise exception 'Escolha o sabor de: %', v_faltando using errcode = '23514';
  end if;

  if v_id is null then
    insert into public.producoes (data, rotulo, observacao)
    values (nullif(p_header->>'data', '')::date, nullif(p_header->>'rotulo', ''), nullif(p_header->>'observacao', ''))
    returning id into v_id;
    v_antes := '[]'::jsonb;
  else
    update public.producoes
       set data = nullif(p_header->>'data', '')::date,
           rotulo = nullif(p_header->>'rotulo', ''),
           observacao = nullif(p_header->>'observacao', '')
     where id = v_id;
    if not found then raise exception 'Leva % nÃ£o existe', v_id using errcode = 'P0002'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'sabor', sabor, 'quantidade', quantidade)), '[]'::jsonb)
      into v_antes from public.producao_itens where producao_id = v_id;
    delete from public.producao_gastos where producao_id = v_id;
    delete from public.producao_itens where producao_id = v_id;
  end if;

  insert into public.producao_gastos (producao_id, descricao, categoria, valor)
  select v_id, nullif(e->>'descricao', ''), e->>'categoria', coalesce((e->>'valor')::numeric, 0)
    from jsonb_array_elements(coalesce(p_gastos, '[]'::jsonb)) e;

  insert into public.producao_itens (producao_id, produto_id, produto_nome, sabor, quantidade, litros_unit)
  select v_id, (e->>'produto_id')::bigint, nullif(e->>'produto_nome', ''), nullif(e->>'sabor', ''),
         coalesce((e->>'quantidade')::numeric, 0), coalesce((e->>'litros_unit')::numeric, 0)
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e;

  perform public.producao_aplicar_delta(v_antes, p_itens);
  return v_id;
end;
$function$;
revoke execute on function public.salvar_producao(bigint, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.salvar_producao(bigint, jsonb, jsonb, jsonb) to authenticated, service_role;

-- excluir_producao
create or replace function public.excluir_producao(p_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_antes jsonb;
begin
  if not public.is_admin() then
    raise exception 'SÃ³ admin apaga produÃ§Ã£o' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'sabor', sabor, 'quantidade', quantidade)), '[]'::jsonb)
    into v_antes from public.producao_itens where producao_id = p_id;
  perform public.producao_aplicar_delta(v_antes, '[]'::jsonb);
  delete from public.producoes where id = p_id;
end;
$function$;
revoke execute on function public.excluir_producao(bigint) from public, anon, authenticated;
grant execute on function public.excluir_producao(bigint) to authenticated, service_role;

-- profiles_protege_controle
create or replace function public.profiles_protege_controle()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.created_at is distinct from old.created_at
     or new.conta_teste is distinct from old.conta_teste
     or new.email is distinct from old.email
     or new.pode_prazo is distinct from old.pode_prazo then
    raise exception 'SÃ³ um administrador pode mudar acesso, aprovaÃ§Ã£o, e-mail ou pagamento a prazo' using errcode = '42501';
  end if;
  return new;
end;
$function$;
grant execute on function public.profiles_protege_controle() to service_role;

-- ajustar_estoque
create or replace function public.ajustar_estoque(p_produto_id bigint, p_sabor text, p_delta integer, p_motivo text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_nome text;
begin
  if not public.is_admin() then
    raise exception 'SÃ³ admin ajusta estoque' using errcode = '42501';
  end if;
  if coalesce(p_delta, 0) = 0 then
    raise exception 'Informe quanto somar ou tirar' using errcode = '22023';
  end if;
  select nome into v_nome from public.products where id = p_produto_id and modo = 'embalado';
  if v_nome is null then
    raise exception 'Produto sem estoque por unidade' using errcode = 'P0002';
  end if;
  perform public.producao_aplicar_delta('[]'::jsonb,
    jsonb_build_array(jsonb_build_object('produto_id', p_produto_id, 'sabor', p_sabor, 'quantidade', p_delta)));
  insert into public.estoque_ajustes (produto_id, produto_nome, sabor, delta, motivo)
  values (p_produto_id, v_nome, nullif(p_sabor, ''), p_delta, trim(p_motivo));
  return public.available_stock(p_produto_id, nullif(p_sabor, ''));
end;
$function$;
revoke execute on function public.ajustar_estoque(bigint, text, integer, text) from public, anon, authenticated;
grant execute on function public.ajustar_estoque(bigint, text, integer, text) to authenticated, service_role;

-- turno_aberto
create or replace function public.turno_aberto(p_data date, p_turno text)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select p_turno in ('manha', 'tarde')
     and extract(isodow from p_data) between 1 and 6
     and not public.data_bloqueada(p_data)
     and p_data <= (now() at time zone 'America/Cuiuba')::date + 14
     and (
       p_data > (now() at time zone 'America/Cuiuba')::date
       or (p_data = (now() at time zone 'America/Cuiuba')::date
           and (now() at time zone 'America/Cuiuba')::time < case p_turno when 'manha' then time '07:00' else time '11:00' end)
     );
$function$;
grant execute on function public.turno_aberto(date, text) to authenticated, service_role;

-- criar_pedido_revendedor
create or replace function public.criar_pedido_revendedor(p_rows jsonb, p_entrega jsonb default null::jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(p_entrega->>'pagamento', '') = 'online' then raise exception 'Pagamento online comeÃ§a pelo botÃ£o Pagar agora.'; end if;
  return public.criar_pedido_revendedor_para(auth.uid(), p_rows, p_entrega);
end $function$;
revoke execute on function public.criar_pedido_revendedor(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.criar_pedido_revendedor(jsonb, jsonb) to authenticated, service_role;

-- orders_cupom_status
create or replace function public.orders_cupom_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.cupom_code is null or new.status is not distinct from old.status then
    return new;
  end if;
  if new.status = 'cancelado' then
    update public.coupons set usado = false where code = new.cupom_code and revendedor_id is not distinct from new.revendedor_id;
  elsif old.status = 'cancelado' then
    update public.coupons set usado = true where code = new.cupom_code and revendedor_id is not distinct from new.revendedor_id;
  end if;
  return new;
end;
$function$;
grant execute on function public.orders_cupom_status() to service_role;

-- wa_telefone
create or replace function public.wa_telefone(p text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when d ~ '^55[0-9]{10,11}$' then d
    when d ~ '^[0-9]{10,11}$' then '55' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x;
$function$;
grant execute on function public.wa_telefone(text) to public, authenticated, service_role;

-- wa_brl
create or replace function public.wa_brl(v numeric)
 returns text
 language sql
 immutable
as $function$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999,999,990.00'), ',', 'X'), '.', ','), 'X', '.');
$function$;
grant execute on function public.wa_brl(numeric) to public, authenticated, service_role;

-- wa_quando
create or replace function public.wa_quando(p_data date, p_turno text)
 returns text
 language sql
 immutable
as $function$
  select nullif(concat_ws(', ',
    case when p_data is not null then (array['dom','seg','ter','qua','qui','sex','sÃ¡b'])[extract(dow from p_data)::int + 1] || ' ' || to_char(p_data, 'DD/MM') end,
    case p_turno when 'manha' then 'de manhÃ£ (8h Ã s 12h)' when 'tarde' then 'Ã  tarde (13h Ã s 17h)' end), '');
$function$;
grant execute on function public.wa_quando(date, text) to public, authenticated, service_role;

-- wa_enfileirar
create or replace function public.wa_enfileirar(p_ref text, p_modelo text, p_destino text, p_vars jsonb, p_origem_tipo text, p_origem_ref text, p_evento text, p_atraso interval default '00:00:00'::interval, p_botao text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_destino is null then return; end if;
  if not coalesce((select ativo from public.whatsapp_config where id = 1), false) then return; end if;
  insert into public.whatsapp_envios (ref, modelo, destino, variaveis, botao, origem_tipo, origem_ref, evento_status, enviar_apos)
  values (p_ref, p_modelo, p_destino, p_vars, p_botao, p_origem_tipo, p_origem_ref, p_evento, now() + p_atraso)
  on conflict (ref) do update set variaveis = excluded.variaveis, destino = excluded.destino, botao = excluded.botao,
    enviar_apos = excluded.enviar_apos, status = 'pendente', erro = null, tentativas = 0
  where public.whatsapp_envios.status in ('pendente', 'ignorado');
end;
$function$;
revoke execute on function public.wa_enfileirar(text, text, text, jsonb, text, text, text, interval, text) from public, anon, authenticated;
grant execute on function public.wa_enfileirar(text, text, text, jsonb, text, text, text, interval, text) to service_role;

-- wa_aviso_interno
create or replace function public.wa_aviso_interno(p_ref text, p_titulo text, p_detalhe text, p_origem_tipo text, p_origem_ref text, p_evento text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.wa_enfileirar('interno:' || p_ref, 'dupuro_aviso_interno',
    (select aviso_interno from public.whatsapp_config where id = 1),
    jsonb_build_array(p_titulo, left(p_detalhe, 300)), p_origem_tipo, p_origem_ref, p_evento);
end;
$function$;
revoke execute on function public.wa_aviso_interno(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.wa_aviso_interno(text, text, text, text, text, text) to service_role;

-- wa_profiles_evento
create or replace function public.wa_profiles_evento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.role, 'revendedor') = 'revendedor' and not coalesce(new.conta_teste, false) then
      perform public.wa_aviso_interno('cadastro:' || new.id, 'Novo cadastro de revendedor',
        coalesce(nullif(new.empresa, ''), new.nome, 'sem nome') || coalesce(' (' || nullif(new.cidade, '') || ')', '') || ' esperando aprovaÃ§Ã£o',
        'cadastro', new.id::text, 'pendente');
    end if;
  elsif new.status = 'aprovado' and old.status is distinct from 'aprovado' and new.role = 'revendedor' and new.aceita_whatsapp then
    perform public.wa_enfileirar('cadastro_aprovado:' || new.id, 'dupuro_cadastro_aprovado', public.wa_telefone(new.telefone),
      jsonb_build_array(initcap(split_part(trim(coalesce(new.nome, '')), ' ', 1))), 'cadastro', new.id::text, 'aprovado', interval '60 seconds');
  end if;
  return new;
end;
$function$;
revoke execute on function public.wa_profiles_evento() from public, anon, authenticated;
grant execute on function public.wa_profiles_evento() to service_role;

-- wa_pedido_evento
create or replace function public.wa_pedido_evento(p_numero text, p_status text, p_rid uuid, p_total numeric, p_info jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  p record;
  v_tel text;
  v_quando text := public.wa_quando(nullif(p_info->>'data', '')::date, p_info->>'turno');
  v_retira boolean := coalesce(p_info->>'tipo', '') = 'retirada';
begin
  select nome, empresa, telefone, aceita_whatsapp into p from public.profiles where id = p_rid;
  v_tel := case when coalesce(p.aceita_whatsapp, false) then public.wa_telefone(p.telefone) end;
  if p_status = 'enviado' then
    perform public.wa_enfileirar('pedido_recebido:' || p_numero, 'dupuro_pedido_recebido', v_tel,
      jsonb_build_array(p_numero, public.wa_brl(p_total)), 'pedido', p_numero, 'enviado');
    perform public.wa_aviso_interno('pedido:' || p_numero, 'Novo pedido de revenda',
      p_numero || ' de ' || coalesce(nullif(p.empresa, ''), p.nome, 'revendedor') || ', ' || public.wa_brl(p_total) ||
      coalesce(', ' || case when v_retira then 'retira ' else 'entrega ' end || v_quando, ''), 'pedido', p_numero, 'enviado');
  elsif p_status = 'processando' then
    perform public.wa_enfileirar('pedido_confirmado:' || p_numero, 'dupuro_pedido_confirmado', v_tel,
      jsonb_build_array(p_numero, case
        when v_quando is null then 'A gente combina com vocÃª o dia da entrega'
        when v_retira then 'Retirada na fÃ¡brica (Av. das Torres, 16) ' || v_quando
        else 'Entrega ' || v_quando end), 'pedido', p_numero, 'processando', interval '60 seconds');
  elsif p_status = 'entregue' then
    perform public.wa_enfileirar('pedido_concluido:' || p_numero, 'dupuro_pedido_concluido', v_tel,
      jsonb_build_array(p_numero, case when v_retira then 'retirado na fÃ¡brica' else 'entregue' end), 'pedido', p_numero, 'entregue', interval '60 seconds');
  end if;
end;
$function$;
revoke execute on function public.wa_pedido_evento(text, text, uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.wa_pedido_evento(text, text, uuid, numeric, jsonb) to service_role;

-- wa_orders_insert
create or replace function public.wa_orders_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g record;
begin
  for g in
    select numero, (array_agg(revendedor_id))[1] rid, (array_agg(entrega_info))[1] info
      from novas where origem = 'revendedor' and status = 'enviado' and revendedor_id is not null
     group by numero
  loop
    perform public.wa_pedido_evento(g.numero, 'enviado', g.rid,
      (select sum(valor) from public.orders where numero = g.numero), g.info);
  end loop;
  return null;
end;
$function$;
revoke execute on function public.wa_orders_insert() from public, anon, authenticated;
grant execute on function public.wa_orders_insert() to service_role;

-- wa_orders_update
create or replace function public.wa_orders_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g record;
begin
  for g in
    select d.numero, d.status, (array_agg(d.revendedor_id))[1] rid, (array_agg(d.entrega_info))[1] info
      from depois d join antes a on a.id = d.id
     where d.status is distinct from a.status and d.origem = 'revendedor' and d.revendedor_id is not null
       and d.status in ('processando', 'entregue')
     group by d.numero, d.status
  loop
    perform public.wa_pedido_evento(g.numero, g.status, g.rid,
      (select sum(valor) from public.orders where numero = g.numero), g.info);
  end loop;
  return null;
end;
$function$;
revoke execute on function public.wa_orders_update() from public, anon, authenticated;
grant execute on function public.wa_orders_update() to service_role;

-- wa_delivery_evento
create or replace function public.wa_delivery_evento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tel text := case when new.aceita_whatsapp then public.wa_telefone(new.cliente_telefone) end;
  v_quando text := public.wa_quando(new.data_entrega, new.periodo);
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'pago' then
    if new.pagar_na_entrega then
      perform public.wa_aviso_interno('delivery:' || new.codigo, 'Delivery confirmado (pagar na entrega)',
        new.codigo || ' de ' || new.cliente_nome || ', ' || public.wa_brl(new.total) || ' a receber na entrega' || coalesce(', entrega ' || v_quando, ''),
        'delivery', new.codigo, 'pago');
    else
      perform public.wa_enfileirar('delivery_pago:' || new.codigo, 'dupuro_delivery_pago', v_tel,
        jsonb_build_array(initcap(split_part(trim(new.cliente_nome), ' ', 1)), new.codigo, coalesce(v_quando, 'no horÃ¡rio combinado')),
        'delivery', new.codigo, 'pago', interval '0', new.token::text);
      perform public.wa_aviso_interno('delivery:' || new.codigo, 'Delivery pago',
        new.codigo || ' de ' || new.cliente_nome || ', ' || public.wa_brl(new.total) || coalesce(', entrega ' || v_quando, ''),
        'delivery', new.codigo, 'pago');
    end if;
  elsif new.status = 'em_rota' then
    perform public.wa_enfileirar('delivery_saiu:' || new.codigo, 'dupuro_delivery_saiu', v_tel,
      jsonb_build_array(new.codigo), 'delivery', new.codigo, 'em_rota', interval '60 seconds', new.token::text);
  elsif new.status = 'entregue' then
    perform public.wa_enfileirar('delivery_entregue:' || new.codigo, 'dupuro_delivery_entregue', v_tel,
      jsonb_build_array(new.codigo), 'delivery', new.codigo, 'entregue', interval '60 seconds');
  end if;
  return new;
end;
$function$;
revoke execute on function public.wa_delivery_evento() from public, anon, authenticated;
grant execute on function public.wa_delivery_evento() to service_role;

-- wa_pegar_lote
create or replace function public.wa_pegar_lote(p_limite integer default 20)
 returns setof whatsapp_envios
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.whatsapp_envios e set status = 'ignorado', erro = 'evento mudou antes do envio'
   where e.status = 'pendente' and e.enviar_apos <= now() and e.evento_status is not null and (
     (e.origem_tipo = 'pedido' and e.evento_status <> 'enviado' and coalesce((select o.status from public.orders o where o.numero = e.origem_ref limit 1), '') <> e.evento_status)
     or (e.origem_tipo = 'delivery' and coalesce((select d.status from public.delivery_pedidos d where d.codigo = e.origem_ref), '') <> e.evento_status)
     or (e.origem_tipo = 'cadastro' and e.evento_status = 'aprovado' and coalesce((select p.status from public.profiles p where p.id::text = e.origem_ref), '') <> 'aprovado'));
  update public.whatsapp_envios set status = 'pendente'
   where status = 'enviando' and pego_em < now() - interval '10 minutes' and tentativas < 5;
  return query
  update public.whatsapp_envios e set status = 'enviando', tentativas = e.tentativas + 1, pego_em = now()
   where e.id in (select id from public.whatsapp_envios
                   where status = 'pendente' and enviar_apos <= now()
                   order by id limit p_limite for update skip locked)
  returning e.*;
end;
$function$;
revoke execute on function public.wa_pegar_lote(integer) from public, anon, authenticated;
grant execute on function public.wa_pegar_lote(integer) to service_role;

-- wa_marcar
create or replace function public.wa_marcar(p_id bigint, p_ok boolean, p_resposta jsonb, p_erro text)
 returns void
 language sql
 security definer
 as $function$
  update public.whatsapp_envios set
    status = case when p_ok then 'enviado' when tentativas >= 5 then 'erro' else 'pendente' end,
    enviado_em = case when p_ok then now() end,
    enviar_apos = case when p_ok then enviar_apos else now() + interval '2 minutes' end,
    resposta = p_resposta, erro = p_erro
  where id = p_id;
$function$;
revoke execute on function public.wa_marcar(bigint, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.wa_marcar(bigint, boolean, jsonb, text) to service_role;

-- aviso_registrar
create or replace function public.aviso_registrar(p_tipo text, p_ref text, p_evento text, p_nome text, p_tel text, p_dados jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  delete from public.avisos_cliente
   where origem_tipo = p_tipo and origem_ref = p_ref and evento is distinct from p_evento
     and avisado_em is null and dispensado_em is null;
  if p_evento is null then return; end if;
  insert into public.avisos_cliente (ref, origem_tipo, origem_ref, evento, nome, telefone, dados)
  values (p_tipo || ':' || p_ref || ':' || p_evento, p_tipo, p_ref, p_evento, p_nome, p_tel, p_dados)
  on conflict (ref) do update set criado_em = now(), avisado_em = null, dispensado_em = null,
    nome = excluded.nome, telefone = excluded.telefone, dados = excluded.dados;
end $function$;
revoke execute on function public.aviso_registrar(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.aviso_registrar(text, text, text, text, text, jsonb) to service_role;

-- aviso_profiles_evento
create or replace function public.aviso_profiles_evento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status is not distinct from old.status or new.role <> 'revendedor' or coalesce(new.conta_teste, false) then return new; end if;
  perform public.aviso_registrar('cadastro', new.id::text,
    case when new.status in ('aprovado', 'rejeitado') then new.status end,
    new.nome, new.telefone, jsonb_build_object('empresa', new.empresa, 'email', new.email));
  return new;
end $function$;
revoke execute on function public.aviso_profiles_evento() from public, anon, authenticated;
grant execute on function public.aviso_profiles_evento() to service_role;

-- aviso_orders_evento
create or replace function public.aviso_orders_evento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g record;
begin
  for g in
    select n.numero, (array_agg(n.status))[1] novo, (array_agg(o.status))[1] antigo, (array_agg(n.revendedor_id))[1] rid
      from novas n join antigas o on o.id = n.id
     where n.status is distinct from o.status and n.origem is distinct from 'loja' and n.revendedor_id is not null
     group by n.numero
  loop
    perform public.aviso_registrar('pedido', g.numero,
      case when g.novo = 'cancelado' and g.antigo = 'enviado' then 'recusado'
           when g.novo in ('processando', 'entregue', 'cancelado') then g.novo end,
      p.nome, p.telefone, jsonb_build_object('empresa', p.empresa))
      from public.profiles p where p.id = g.rid;
  end loop;
  return null;
end $function$;
revoke execute on function public.aviso_orders_evento() from public, anon, authenticated;
grant execute on function public.aviso_orders_evento() to service_role;

-- aviso_delivery_evento
create or replace function public.aviso_delivery_evento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  perform public.aviso_registrar('delivery', new.codigo,
    case when new.status in ('em_rota', 'entregue') then new.status
         when new.status = 'cancelado' and old.status in ('pago', 'em_rota') then 'cancelado' end,
    new.cliente_nome, new.cliente_telefone, null);
  return new;
end $function$;
revoke execute on function public.aviso_delivery_evento() from public, anon, authenticated;
grant execute on function public.aviso_delivery_evento() to service_role;

-- caixa_movimentar
create or replace function public.caixa_movimentar(p_tipo text, p_valor numeric, p_categoria text, p_obs text)
 returns caixa_movimentos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_sessao bigint; v_row public.caixa_movimentos;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissÃ£o.'; end if;
  select id into v_sessao from public.caixa_sessoes where status = 'aberta' limit 1;
  if v_sessao is null then raise exception 'Abra o caixa antes de mexer no dinheiro.'; end if;
  if p_tipo = 'reforco' then p_categoria := coalesce(p_categoria, 'troco'); end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if length(btrim(coalesce(p_obs, ''))) < 2 then raise exception 'Escreva o motivo (ex.: banana no mercado).'; end if;
  insert into public.caixa_movimentos (sessao_id, tipo, categoria, observacao, valor)
  values (v_sessao, p_tipo, p_categoria, btrim(p_obs), round(p_valor, 2)) returning * into v_row;
  return v_row;
end $function$;
revoke execute on function public.caixa_movimentar(text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.caixa_movimentar(text, numeric, text, text) to authenticated, service_role;

-- caixa_devolver_troco
create or replace function public.caixa_devolver_troco(p_id bigint, p_devolvido numeric)
 returns caixa_movimentos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row public.caixa_movimentos;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissÃ£o.'; end if;
  select m.* into v_row from public.caixa_movimentos m join public.caixa_sessoes s on s.id = m.sessao_id
   where m.id = p_id and m.tipo = 'retirada' and m.anulado_em is null and s.status = 'aberta' for update of m;
  if not found then raise exception 'Essa retirada nÃ£o estÃ¡ mais no caixa aberto.'; end if;
  if coalesce(p_devolvido, -1) < 0 or p_devolvido > v_row.valor then raise exception 'O troco devolvido vai de R$ 0 atÃ© o valor retirado.'; end if;
  update public.caixa_movimentos set devolvido = round(p_devolvido, 2), devolvido_em = case when p_devolvido > 0 then now() end
   where id = p_id returning * into v_row;
  return v_row;
end $function$;
revoke execute on function public.caixa_devolver_troco(bigint, numeric) from public, anon, authenticated;
grant execute on function public.caixa_devolver_troco(bigint, numeric) to authenticated, service_role;

-- caixa_anular_movimento
create or replace function public.caixa_anular_movimento(p_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissÃ£o.'; end if;
  update public.caixa_movimentos m set anulado_em = now()
    from public.caixa_sessoes s
   where m.id = p_id and s.id = m.sessao_id and s.status = 'aberta' and m.anulado_em is null;
  if not found then raise exception 'Esse lanÃ§amento nÃ£o estÃ¡ mais no caixa aberto.'; end if;
end $function$;
revoke execute on function public.caixa_anular_movimento(bigint) from public, anon, authenticated;
grant execute on function public.caixa_anular_movimento(bigint) to authenticated, service_role;

-- caixa_movimentos_resumo
create or replace function public.caixa_movimentos_resumo(p_sessao_id bigint)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'retiradas', coalesce(sum(valor - devolvido) filter (where tipo = 'retirada'), 0),
    'reforcos', coalesce(sum(valor) filter (where tipo = 'reforco'), 0),
    'movimentos', coalesce(jsonb_agg(jsonb_build_object(
        'tipo', tipo, 'categoria', categoria, 'observacao', observacao, 'valor', valor,
        'devolvido', devolvido, 'criado_em', criado_em) order by criado_em), '[]'::jsonb))
  from public.caixa_movimentos where sessao_id = p_sessao_id and anulado_em is null;
$function$;
grant execute on function public.caixa_movimentos_resumo(bigint) to service_role;

-- delivery_cancelar
create or replace function public.delivery_cancelar(p_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v public.delivery_pedidos%rowtype; it jsonb; v_src bigint; v_qtd int;
begin
  if not public.is_admin() then raise exception 'Sem permissÃ£o.'; end if;
  select * into v from public.delivery_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido nÃ£o encontrado.'; end if;
  if v.status not in ('pago', 'em_rota', 'aguardando_pagamento') then raise exception 'Esse pedido nÃ£o pode mais ser cancelado.'; end if;
  if v.status in ('pago', 'em_rota') then
    for it in select * from jsonb_array_elements(v.itens) loop
      v_qtd := coalesce((it->>'quantidade')::int, 0);
      select coalesce(estoque_ref, id) into v_src from public.products where id = (it->>'produto_id')::bigint;
      if v_src is null then continue; end if;
      if coalesce(it->>'sabor', '') <> '' then
        update public.product_flavor_stock set estoque = estoque + v_qtd where produto_id = v_src and sabor = it->>'sabor';
      else
        update public.products set estoque = estoque + v_qtd where id = v_src;
      end if;
    end loop;
  end if;
  update public.delivery_pedidos set status = 'cancelado', atualizado_em = now() where id = v.id;
  return jsonb_build_object('ok', true, 'pago_online', v.status in ('pago', 'em_rota') and not v.pagar_na_entrega);
end $function$;
revoke execute on function public.delivery_cancelar(bigint) from public, anon, authenticated;
grant execute on function public.delivery_cancelar(bigint) to authenticated, service_role;

-- criar_pedido_revendedor_para
create or replace function public.criar_pedido_revendedor_para(p_uid uuid, p_rows jsonb, p_entrega jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_numero text; v_volume numeric; v_dispensa boolean; v_falta record; r jsonb; v_prod record;
  v_qtd int; v_sabor text; v_tipo text; v_data date; v_turno text; v_pag text; v_forma text;
  v_end text; v_obs text; v_prazo boolean; v_info jsonb; v_cupom_code text; v_cupom record;
  v_pct int := 0; v_troco numeric; v_total numeric := 0; v_lat double precision; v_lng double precision;
  v_cot public.entrega_cotacoes; v_cot_id uuid; v_taxa numeric := 0;
begin
  if p_uid is null then raise exception 'Sem sessÃ£o ativa.'; end if;
  select pode_prazo into v_prazo from public.profiles where id = p_uid and status = 'aprovado' and role = 'revendedor';
  if not found then raise exception 'Cadastro nÃ£o aprovado para fazer pedidos.'; end if;
  if p_rows is null or jsonb_array_length(p_rows) = 0 then raise exception 'O pedido precisa ter ao menos um item.'; end if;
  if p_entrega is null or jsonb_typeof(p_entrega) <> 'object' then raise exception 'Escolha entrega ou retirada, o dia e o turno.'; end if;

  v_tipo  := p_entrega->>'tipo';
  v_turno := p_entrega->>'turno';
  v_pag   := coalesce(nullif(p_entrega->>'pagamento', ''), 'na_entrega');
  v_forma := nullif(p_entrega->>'forma', '');
  v_end   := nullif(trim(coalesce(p_entrega->>'endereco', '')), '');
  v_obs   := nullif(trim(coalesce(p_entrega->>'observacao', '')), '');
  v_cupom_code := nullif(trim(coalesce(p_entrega->>'cupom', '')), '');
  begin v_troco := nullif(p_entrega->>'troco_para', '')::numeric; exception when others then raise exception 'Valor do troco invÃ¡lido.'; end;
  begin v_data := (p_entrega->>'data')::date; exception when others then raise exception 'Data de entrega invÃ¡lida.'; end;
  if v_tipo = 'entrega' then
    begin v_cot_id := nullif(p_entrega->>'cotacao_id', '')::uuid; exception when others then v_cot_id := null; end;
    select * into v_cot from public.entrega_cotacoes where id = v_cot_id
       and (expira_em > now() or nullif(p_entrega->>'mp_payment_id', '') is not null);
    if not found then raise exception 'Calcule a taxa de entrega de novo: atualize a pÃ¡gina e confira o endereÃ§o.'; end if;
    v_taxa := v_cot.taxa; v_lat := v_cot.lat; v_lng := v_cot.lng;
  end if;
  if coalesce(v_tipo, '') not in ('entrega', 'retirada') then raise exception 'Escolha entrega ou retirada.'; end if;
  if v_data is null or not coalesce(public.turno_aberto(v_data, v_turno), false) then raise exception 'Esse dia/turno nÃ£o estÃ¡ mais disponÃ­vel. Escolha outro.'; end if;
  if v_pag not in ('na_entrega', 'a_prazo', 'online') then raise exception 'Forma de pagamento invÃ¡lida.'; end if;
  if v_pag = 'a_prazo' and not v_prazo then raise exception 'Pagamento a prazo nÃ£o estÃ¡ liberado para a sua conta.'; end if;
  if v_pag <> 'na_entrega' then v_forma := null; v_troco := null; end if;
  if v_forma is not null and v_forma not in ('dinheiro', 'pix', 'cartao', 'debito', 'credito') then raise exception 'Forma de pagamento invÃ¡lida.'; end if;
  if v_forma is distinct from 'dinheiro' then v_troco := null; end if;
  if v_tipo = 'entrega' and nullif(p_entrega->>'mp_payment_id', '') is null and public.turno_lotado(v_data, v_turno) then raise exception 'Esse turno de entrega lotou. Escolha outro dia ou turno (ou retire na fÃ¡brica).'; end if;
  if v_tipo = 'entrega' and v_end is null then raise exception 'Informe o endereÃ§o de entrega.'; end if;
  if length(coalesce(v_end, '')) > 200 or length(coalesce(v_obs, '')) > 300 or coalesce(v_end, '') ~ '[<>]' or coalesce(v_obs, '') ~ '[<>]' then
    raise exception 'EndereÃ§o ou observaÃ§Ã£o invÃ¡lidos.';
  end if;

  if v_cupom_code is not null then
    select id, code, desconto_percent, tipo into v_cupom from public.coupons
     where code = v_cupom_code and revendedor_id = p_uid and not usado
       and (validade is null or validade >= (now() at time zone 'America/Cuiuba')::date)
     for update;
    if not found then
      select id, code, desconto_percent, tipo into v_cupom from public.coupons
       where code = v_cupom_code
         and (validade is null or validade >= (now() at time zone 'America/Cuiuba')::date)
       for update;
      if not found or v_cupom.usado then return v_numero; end if;
    end if;
    if v_cupom.tipo = 'frete' then
      if v_tipo <> 'entrega' then raise exception 'Cupom de taxa grÃ¡tis sÃ³ vale em pedidos com entrega.'; end if;
      v_taxa := 0;
    else
      if coalesce(v_cupom.desconto_percent, 0) not between 1 and 100 then raise exception 'Cupom invÃ¡lido, vencido ou jÃ¡ usado.'; end if;
      v_pct := v_cupom.desconto_percent;
    end if;
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) e left join public.products p on p.id = (e->>'produto_id')::bigint
              where p.id is null or (e->>'quantidade')::int < 1 or (e->>'quantidade')::int > 99) then
    raise exception 'Item invÃ¡lido no pedido.';
  end if;
  v_volume := public.volume_do_pedido(p_rows);
  v_dispensa := v_volume >= public.litros_dispensa_minimo();
  if not v_dispensa then
    select p.nome, p.pedido_minimo into v_falta from jsonb_array_elements(p_rows) e
      join public.products p on p.id = (e->>'produto_id')::bigint
     where (e->>'quantidade')::int < coalesce(p.pedido_minimo, 1) limit 1;
    if found then raise exception 'Pedido mÃ­nimo de % Ã© % unidades.', v_falta.nome, v_falta.pedido_minimo; end if;
  end if;

  select coalesce(sum(round(p.preco * (e->>'quantidade')::int * (100 - v_pct) / 100.0, 2)), 0) into v_total
    from jsonb_array_elements(p_rows) e join public.products p on p.id = (e->>'produto_id')::bigint;
  v_total := v_total + v_taxa;
  if v_troco is not null and v_troco < v_total then raise exception 'O troco precisa ser pra um valor maior que o total.'; end if;

  v_info := jsonb_strip_nulls(jsonb_build_object(
    'tipo', v_tipo, 'data', v_data, 'turno', v_turno, 'pagamento', v_pag,
    'forma', v_forma, 'troco_para', v_troco, 'endereco', case when v_tipo = 'entrega' then v_end end, 'observacao', v_obs,
    'lat', v_lat, 'lng', v_lng, 'taxa_entrega', case when v_tipo = 'entrega' then v_taxa end, 'km', case when v_tipo = 'entrega' then v_cot.km end,
    'cupom', v_cupom_code, 'desconto_percent', nullif(v_pct, 0),
    'cupom_tipo', case when v_cupom_code is not null then v_cupom.tipo end,
    'mp_payment_id', nullif(p_entrega->>'mp_payment_id', ''), 'pago_metodo', nullif(p_entrega->>'pago_metodo', '')));

  v_numero := public.next_pedido_numero();
  for r in select * from jsonb_array_elements(p_rows) loop
    select id, nome, preco into v_prod from public.products where id = (r->>'produto_id')::bigint;
    v_qtd := (r->>'quantidade')::int;
    v_sabor := nullif(r->>'sabor', '');
    insert into public.orders (revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor,
                               usa_estoque, origem, entrega, entrega_info, cupom_code)
    values (p_uid, v_numero, (now() at time zone 'America/Cuiuba')::date,
            v_prod.nome || coalesce(' - ' || v_sabor, '') || ' x' || v_qtd,
            round(v_prod.preco * v_qtd * (100 - v_pct) / 100.0, 2), 'processando',
            v_prod.id, v_qtd, v_sabor, true, 'revendedor', v_tipo = 'entrega', v_info, v_cupom_code);
  end loop;
  if v_tipo = 'entrega' and v_taxa > 0 then
    insert into public.orders (revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor,
                               usa_estoque, origem, entrega, entrega_info, cupom_code)
    values (p_uid, v_numero, (now() at time zone 'America/Cuiuba')::date,
            'Taxa de entrega (' || replace(trim(to_char(v_cot.km, 'FM990.0')), '.', ',') || ' km)', v_taxa, 'processando',
            null, 1, null, false, 'revendedor', true, v_info, v_cupom_code);
  end if;
  if v_cupom_code is not null then update public.coupons set usado = true, usado_por = v_numero where id = v_cupom.id; end if;
  return v_numero;
end $function$;
revoke execute on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.criar_pedido_revendedor_para(uuid, jsonb, jsonb) to service_role;

-- revenda_iniciar_checkout
create or replace function public.revenda_iniciar_checkout(p_rows jsonb, p_entrega jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_ent jsonb; v_num text; v_total numeric; v_tok uuid;
begin
  if v_uid is null then raise exception 'Sem sessÃ£o ativa.'; end if;
  v_ent := (coalesce(p_entrega, '{}'::jsonb) - 'forma' - 'troco_para' - 'mp_payment_id' - 'pago_metodo') || jsonb_build_object('pagamento', 'online');
  update public.revenda_checkouts set status = 'expirado' where revendedor_id = v_uid and status = 'aguardando';
  begin
    v_num := public.criar_pedido_revendedor_para(v_uid, p_rows, v_ent);
    select coalesce(sum(valor), 0) into v_total from public.orders where numero = v_num;
    raise exception using errcode = 'P0001', message = '__simulacao_ok__';
  exception when sqlstate 'P0001' then
    if sqlerrm <> '__simulacao_ok__' then raise; end if;
  end;
  update public.revenda_checkouts set status = 'expirado' where status = 'aguardando' and criado_em < now() - interval '3 hours';
  insert into public.revenda_checkouts (revendedor_id, rows, entrega, total) values (v_uid, p_rows, v_ent, v_total)
    returning token into v_tok;
  return jsonb_build_object('token', v_tok, 'total', v_total);
end $function$;
revoke execute on function public.revenda_iniciar_checkout(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.revenda_iniciar_checkout(jsonb, jsonb) to public, authenticated, service_role;

-- revenda_confirmar_checkout
create or replace function public.revenda_confirmar_checkout(p_token uuid, p_payment_id text, p_metodo text, p_valor numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c public.revenda_checkouts%rowtype; v_num text; v_err text;
begin
  select * into c from public.revenda_checkouts where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  if c.status = 'pago' then return jsonb_build_object('ok', true, 'numero', c.numero, 'ja_processado', true); end if;
  if coalesce(p_valor, 0) + 0.009 < c.total then
    update public.revenda_checkouts set mp_payment_id = p_payment_id, mp_status = 'valor_divergente', status = 'erro', erro = 'Valor pago menor que o total' where id = c.id;
    return jsonb_build_object('ok', false, 'erro', 'valor_divergente');
  end if;
  begin
    v_num := public.criar_pedido_revendedor_para(c.revendedor_id, c.rows,
      c.entrega || jsonb_build_object('mp_payment_id', p_payment_id, 'pago_metodo', p_metodo));
  exception when others then
    v_err := sqlerrm;
  end;
  if v_num is null then
    update public.revenda_checkouts set mp_payment_id = p_payment_id, mp_status = 'approved', status = 'erro', erro = v_err where id = c.id;
    return jsonb_build_object('ok', false, 'erro', v_err);
  end if;
  update public.revenda_checkouts set status = 'pago', numero = v_num, mp_payment_id = p_payment_id, mp_status = 'approved', pago_em = now() where id = c.id;
  return jsonb_build_object('ok', true, 'numero', v_num);
end $function$;
revoke execute on function public.revenda_confirmar_checkout(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.revenda_confirmar_checkout(uuid, text, text, numeric) to service_role;

-- limite_por_rota
create or replace function public.limite_por_rota()
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select (config->>'limite_por_rota')::int from public.delivery_config where id = 1), 10);
$function$;
grant execute on function public.limite_por_rota() to service_role;

-- turno_ocupacao
create or replace function public.turno_ocupacao(p_data date, p_turno text)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (
    (select count(*) from public.delivery_pedidos
      where data_entrega = p_data and periodo = p_turno
        and (status in ('pago', 'em_rota', 'entregue') or (status = 'aguardando_pagamento' and criado_em > now() - interval '30 minutes')))
  + (select count(distinct numero) from public.orders
      where origem = 'revendedor' and status in ('enviado', 'processando', 'entregue')
        and entrega_info->>'tipo' = 'entrega' and entrega_info->>'data' = p_data::text and entrega_info->>'turno' = p_turno)
  + (select count(*) from public.revenda_checkouts
      where status = 'aguardando' and criado_em > now() - interval '30 minutes'
        and entrega->>'tipo' = 'entrega' and entrega->>'data' = p_data::text and entrega->>'turno' = p_turno)
  )::int;
$function$;
grant execute on function public.turno_ocupacao(date, text) to service_role;

-- turno_lotado
create or replace function public.turno_lotado(p_data date, p_turno text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.data_bloqueada(p_data)
      or public.turno_ocupacao(p_data, p_turno) >= public.limite_por_rota();
$function$;
grant execute on function public.turno_lotado(date, text) to service_role;

-- delivery_turnos_lotados
create or replace function public.delivery_turnos_lotados()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(d::date::text || '|' || t), '{}')
    from generate_series((now() at time zone 'America/Cuiuba')::date, (now() at time zone 'America/Cuiuba')::date + 10, interval '1 day') d
    cross join (values ('manha'), ('tarde')) v(t)
   where public.turno_lotado(d::date, t);
$function$;
revoke execute on function public.delivery_turnos_lotados() from public, anon, authenticated;
grant execute on function public.delivery_turnos_lotados() to public, authenticated, service_role;

-- data_bloqueada
create or replace function public.data_bloqueada(p_data date)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select config->'datas_bloqueadas' ? p_data::text from public.delivery_config limit 1), false);
$function$;
grant execute on function public.data_bloqueada(date) to authenticated, service_role;

-- admin_taxas_entrega
create or replace function public.admin_taxas_entrega()
 returns table(fonte text, ref text, dia date, cliente text, taxa numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'SÃ³ o admin vÃª as taxas do entregador.';
  end if;

  return query
  select 'delivery'::text, d.codigo,
         coalesce((d.entregue_em at time zone 'America/Cuiuba')::date, d.data_entrega,
                  (d.criado_em at time zone 'America/Cuiuba')::date),
         d.cliente_nome, d.taxa
    from delivery_pedidos d
   where d.status = 'entregue' and coalesce(d.taxa, 0) > 0
  union all
  select case when o.origem = 'loja' then 'loja' else 'revenda' end, o.numero,
         case when o.origem <> 'loja' and (o.entrega_info->>'data') ~ '^\d{4}-\d{2}-\d{2}$'
              then (o.entrega_info->>'data')::date else o.data end,
         case when o.origem = 'loja' then o.entrega_info->>'nome'
              else coalesce(nullif(p.empresa, ''), p.nome) end,
         sum(o.valor)
    from orders o
    left join profiles p on p.id = o.revendedor_id
   where o.produto_id is null and o.itens ilike 'Taxa de entrega%'
     and o.status = 'entregue' and o.valor > 0
   group by o.origem, o.numero, o.entrega_info, o.data, p.empresa, p.nome;
end;
$function$;
revoke execute on function public.admin_taxas_entrega() from public, anon, authenticated;
grant execute on function public.admin_taxas_entrega() to authenticated, service_role;

-- usar_cupom_frete
create or replace function public.usar_cupom_frete(p_code text, p_pedido_trocado text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v public.coupons%rowtype;
begin
  select * into v from public.coupons
   where code = upper(trim(coalesce(p_code, '')))
     and tipo = 'frete' and revendedor_id is null and not usado
     and (validade is null or validade >= (now() at time zone 'America/Cuiuba')::date)
   for update;
  if not found then
    select * into v from public.coupons
     where code = upper(trim(coalesce(p_code, '')))
       and tipo = 'frete' and revendedor_id is null
       and (validade is null or validade >= (now() at time zone 'America/Cuiuba')::date)
     for update;
    if not found or v.usado_por is distinct from nullif(trim(coalesce(p_pedido_trocado, '')), '') then return false; end if;
    if not exists (select 1 from public.delivery_pedidos d
                    where d.codigo = v.usado_por and d.status in ('aguardando_pagamento', 'expirado', 'cancelado')) then
      return false;
    end if;
    return true;
  end if;
  update public.coupons set usado = true where id = v.id;
  return true;
end $function$;
revoke execute on function public.usar_cupom_frete(text, text) from public, anon, authenticated;
grant execute on function public.usar_cupom_frete(text, text) to service_role;

-- ==========================================================================
-- Triggers (11) â€” pg_trigger non-internal
-- ==========================================================================
create trigger aviso_delivery_evento after update of status on public.delivery_pedidos for each row execute function aviso_delivery_evento();
create trigger aviso_orders_evento after update on public.orders referencing old table as antigas new table as novas for each statement execute function aviso_orders_evento();
create trigger aviso_profiles_evento after update of status on public.profiles for each row execute function aviso_profiles_evento();
create trigger caixa_promocoes_limite before insert or update on public.caixa_promocoes for each row execute function check_limite_promocoes();
create trigger orders_adjust_stock after insert or delete or update on public.orders for each row execute function adjust_stock_on_order_change();
create trigger orders_cupom_status after update of status on public.orders for each row execute function orders_cupom_status();
create trigger profiles_protege_controle before update on public.profiles for each row execute function profiles_protege_controle();
create trigger wa_delivery_evento after update of status on public.delivery_pedidos for each row execute function wa_delivery_evento();
create trigger wa_orders_insert after insert on public.orders referencing new table as novas for each statement execute function wa_orders_insert();
create trigger wa_orders_update after update on public.orders referencing old table as antes new table as depois for each statement execute function wa_orders_update();
create trigger wa_profiles_evento after insert or update of status on public.profiles for each row execute function wa_profiles_evento();

-- Fase 2 concluÃ­da 2026-11-17; validar antes de usar em projeto novo.


-- ==========================================================================
-- FASE 3 â€” reconciliaÃ§Ã£o 2026-11-17 (pÃ³s-migrations 062/063/064 + grants de tabela)
-- ==========================================================================
-- Fonte: pg_* do banco vivo (projeto zqadfktfplrbrjmepllh).
-- ExecuÃ§Ã£o: de cima para baixo; o que vem por Ãºltimo vence.
-- Uso create or replace / drop policy if exists + create / create table if not exists.

-- ---------- rate_buckets (062) ----------
-- Colunas via information_schema.columns do banco vivo.
create table if not exists public.rate_buckets (
    key text not null,
    marks integer not null default 0,
    janela_inicio timestamptz not null default now(),
    constraint rate_buckets_pkey primary key (key)
);
alter table public.rate_buckets enable row level security;
-- 062: SEM policies por desenho (acesso sÃ³ service_role via rate_check / pg_cron)

-- Sequences existentes no banco (id_seq tables; rate_buckets usa pk text, sem sequence).
-- NÃ£o hÃ¡ sequÃªncia nova para rate_buckets.

-- ---------- FunÃ§Ãµes com estado novo (reemitidas cru via pg_get_functiondef) ----------
-- Nota: turno_ocupacao (063) agora usa count(distinct telefone Ãºnico) na contagem
-- de atendimentos aguardando pagamento.

create or replace function public.rate_check(p_key text, p_max integer, p_janela_seg integer)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_marks int;
begin
  update public.rate_buckets
     set marks = case when janela_inicio >= now() - make_interval(secs => p_janela_seg)
                      then marks + 1 else 1 end,
         janela_inicio = case when janela_inicio < now() - make_interval(secs => p_janela_seg)
                             then now() else janela_inicio end
   where key = p_key
   returning marks into v_marks;

  if found then
    return v_marks <= p_max;
  end if;

  insert into public.rate_buckets (key, marks, janela_inicio)
    values (p_key, 1, now())
    on conflict (key) do update set
      marks = excluded.marks,
      janela_inicio = excluded.janela_inicio;
  return true;
end $function$
;

-- 062 endureceu funÃ§Ãµes de restriÃ§Ã£o: service_role only. ACL vivo = postgres+service_role.
revoke execute on function public.rate_check(text,int,int) from public, anon, authenticated;
grant execute on function public.rate_check(text,int,int) to service_role;

create or replace function public.turno_ocupacao(p_data date, p_turno text)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (
    (select count(*) from public.delivery_pedidos
      where data_entrega = p_data and periodo = p_turno
        and status in ('pago', 'em_rota', 'entregue'))
  + (select coalesce(count(distinct coalesce(nullif(cliente_telefone, ''), 'sem-tel-' || id::text)), 0) from public.delivery_pedidos
      where data_entrega = p_data and periodo = p_turno
        and status = 'aguardando_pagamento' and criado_em > now() - interval '30 minutes')
  + (select count(distinct numero) from public.orders
      where origem = 'revendedor' and status in ('enviado', 'processando', 'entregue')
        and entrega_info->>'tipo' = 'entrega' and entrega_info->>'data' = p_data::text and entrega_info->>'turno' = p_turno)
  + (select coalesce(count(distinct coalesce(nullif(revendedor_id::text, ''), 'sem-dono-' || id::text)), 0) from public.revenda_checkouts
      where status = 'aguardando' and criado_em > now() - interval '30 minutes'
        and entrega->>'tipo' = 'entrega' and entrega->>'data' = p_data::text and entrega->>'turno' = p_turno)
  )::int;
$function$
;

-- 062 endureceu funÃ§Ãµes de restriÃ§Ã£o: service_role only. ACL vivo = postgres+service_role.
revoke execute on function public.turno_ocupacao(date,text) from public, anon, authenticated;
grant execute on function public.turno_ocupacao(date,text) to service_role;

-- Wa_* functions: 046 deixou ACL larga (=X/postgres â†’ PUBLIC, postgres, authenticated, service_role).
-- Agora com SET search_path TO 'public'.
create or replace function public.wa_brl(v numeric)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999,999,990.00'), ',', 'X'), '.', ','), 'X', '.');
$function$
;

-- ACL vivo: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
revoke execute on function public.wa_brl(numeric) from public, anon, authenticated;
grant execute on function public.wa_brl(numeric) to public, postgres, authenticated, service_role;

create or replace function public.wa_quando(p_data date, p_turno text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select nullif(concat_ws(', ',
    case when p_data is not null then (array['dom','seg','ter','qua','qui','sex','sÃ¡b'])[extract(dow from p_data)::int + 1] || ' ' || to_char(p_data, 'DD/MM') end,
    case p_turno when 'manha' then 'de manhÃ£ (8h Ã s 12h)' when 'tarde' then 'Ã  tarde (13h Ã s 17h)' end), '');
$function$
;

-- ACL vivo: =X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres
revoke execute on function public.wa_quando(date,text) from public, anon, authenticated;
grant execute on function public.wa_quando(date,text) to public, postgres, authenticated, service_role;

-- ==========================================================================
-- Bloco 4 â€” 10 RLS policies (064) â€” emitidas da pg_policies do banco vivo
-- ==========================================================================

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
  on public.profiles
  for select
  using (((select auth.uid() as uid) = id) or (select is_admin() as is_admin));

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin
  on public.profiles
  for update
  using (((select auth.uid() as uid) = id) or (select is_admin() as is_admin))
  with check (((select auth.uid() as uid) = id) or (select is_admin() as is_admin));

drop policy if exists orders_select_own_approved_or_admin on public.orders;
create policy orders_select_own_approved_or_admin
  on public.orders
  for select
  using ((((select auth.uid() as uid) = revendedor_id)
          and (exists (select 1 from profiles p where (p.id = (select auth.uid() as uid)) and (p.status = 'aprovado')))
       ) or (select is_admin() as is_admin));

drop policy if exists coupons_select_own_approved_or_admin on public.coupons;
create policy coupons_select_own_approved_or_admin
  on public.coupons
  for select
  using ((((select auth.uid() as uid) = revendedor_id)
          and (exists (select 1 from profiles p where (p.id = (select auth.uid() as uid)) and (p.status = 'aprovado')))
       ) or (select is_admin() as is_admin));

drop policy if exists products_select_authenticated on public.products;
create policy products_select_authenticated
  on public.products
  for select
  using (select (auth.uid() is not null));

drop policy if exists pfs_select_authenticated on public.product_flavor_stock;
create policy pfs_select_authenticated
  on public.product_flavor_stock
  for select
  using (select (auth.uid() is not null));

drop policy if exists acompanhamentos_select_authenticated on public.acompanhamentos;
create policy acompanhamentos_select_authenticated
  on public.acompanhamentos
  for select
  using (select (auth.uid() is not null));

drop policy if exists app_settings_select_authenticated on public.app_settings;
create policy app_settings_select_authenticated
  on public.app_settings
  for select
  using (select (auth.uid() is not null));

drop policy if exists caixa_sessoes_select on public.caixa_sessoes;
create policy caixa_sessoes_select
  on public.caixa_sessoes
  for select
  using (select (is_admin() or ((select auth.uid() as uid) = caixa_sessoes.atendente_id)));

drop policy if exists orders_insert_atendente on public.orders;
create policy orders_insert_atendente
  on public.orders
  for insert
  with check ((select is_atendente() as is_atendente)
              and ((select auth.uid() as uid) = atendente_id)
              and (origem = 'loja')
              and (status = 'entregue')
              and (usa_estoque = coalesce((select (p.modo = 'embalado') from products p where p.id = orders.produto_id), false)));

-- ==========================================================================
-- Grants de tabela â€” ACL real via pg_class.relacl (31 tabelas)
-- As fases 1-2 ignoraram relacl de tabela; o 062 endureceu vÃ¡rias.
-- X=ALL, r=SELECT, w=UPDATE, a=INSERT, d=DELETE, D=TRUNCATE, x=REFERENCES, t=TRIGGER
-- Entry sem role antes de '=' = PUBLIC. Ignorada entry do owner (postgres=...).
-- ==========================================================================

-- acompanhamento, app_settings, avisos_cliente, caixa_movimentos, caixa_pedidos_abertos,
-- caixa_promocoes, caixa_sessoes, coupons, delivery_config, estoque_ajustes,
-- geo_enderecos, nfce_emissoes, order_audits, orders, producao_gastos, producao_itens,
-- producoes, product_flavor_stock, products, profiles, rota_paradas, rota_posicao,
-- rotas, whatsapp_config, whatsapp_envios â€” ACL = postgres|anon|authenticated|service_role =arwdDxtm
revoke all on public.acompanhamentos from public, anon, authenticated;
grant all on public.acompanhamentos to postgres, anon, authenticated, service_role;

revoke all on public.app_settings from public, anon, authenticated;
grant all on public.app_settings to postgres, anon, authenticated, service_role;

revoke all on public.avisos_cliente from public, anon, authenticated;
grant all on public.avisos_cliente to postgres, anon, authenticated, service_role;

revoke all on public.caixa_movimentos from public, anon, authenticated;
grant all on public.caixa_movimentos to postgres, anon, authenticated, service_role;

revoke all on public.caixa_pedidos_abertos from public, anon, authenticated;
grant all on public.caixa_pedidos_abertos to postgres, anon, authenticated, service_role;

revoke all on public.caixa_promocoes from public, anon, authenticated;
grant all on public.caixa_promocoes to postgres, anon, authenticated, service_role;

revoke all on public.caixa_sessoes from public, anon, authenticated;
grant all on public.caixa_sessoes to postgres, anon, authenticated, service_role;

revoke all on public.coupons from public, anon, authenticated;
grant all on public.coupons to postgres, anon, authenticated, service_role;

revoke all on public.delivery_config from public, anon, authenticated;
grant all on public.delivery_config to postgres, anon, authenticated, service_role;

revoke all on public.estoque_ajustes from public, anon, authenticated;
grant all on public.estoque_ajustes to postgres, anon, authenticated, service_role;

revoke all on public.geo_enderecos from public, anon, authenticated;
grant all on public.geo_enderecos to postgres, anon, authenticated, service_role;

revoke all on public.nfce_emissoes from public, anon, authenticated;
grant all on public.nfce_emissoes to postgres, anon, authenticated, service_role;

revoke all on public.order_audits from public, anon, authenticated;
grant all on public.order_audits to postgres, anon, authenticated, service_role;

revoke all on public.orders from public, anon, authenticated;
grant all on public.orders to postgres, anon, authenticated, service_role;

revoke all on public.producao_gastos from public, anon, authenticated;
grant all on public.producao_gastos to postgres, anon, authenticated, service_role;

revoke all on public.producao_itens from public, anon, authenticated;
grant all on public.producao_itens to postgres, anon, authenticated, service_role;

revoke all on public.producoes from public, anon, authenticated;
grant all on public.producoes to postgres, anon, authenticated, service_role;

revoke all on public.product_flavor_stock from public, anon, authenticated;
grant all on public.product_flavor_stock to postgres, anon, authenticated, service_role;

revoke all on public.products from public, anon, authenticated;
grant all on public.products to postgres, anon, authenticated, service_role;

revoke all on public.profiles from public, anon, authenticated;
grant all on public.profiles to postgres, anon, authenticated, service_role;

revoke all on public.rota_paradas from public, anon, authenticated;
grant all on public.rota_paradas to postgres, anon, authenticated, service_role;

revoke all on public.rota_posicao from public, anon, authenticated;
grant all on public.rota_posicao to postgres, anon, authenticated, service_role;

revoke all on public.rotas from public, anon, authenticated;
grant all on public.rotas to postgres, anon, authenticated, service_role;

revoke all on public.whatsapp_config from public, anon, authenticated;
grant all on public.whatsapp_config to postgres, anon, authenticated, service_role;

revoke all on public.whatsapp_envios from public, anon, authenticated;
grant all on public.whatsapp_envios to postgres, anon, authenticated, service_role;

-- delivery_pedidos â€” ACL vivo: postgres|authenticated|service_role (SOMENTE, SEM anon)
revoke all on public.delivery_pedidos from public, anon, authenticated;
grant all on public.delivery_pedidos to authenticated, service_role;

-- entrega_cotacoes â€” ACL vivo: postgres|service_role (SOMENTE, SEM anon nem authenticated)
revoke all on public.entrega_cotacoes from public, anon, authenticated;
grant all on public.entrega_cotacoes to postgres, service_role;

-- norte_admins â€” ACL vivo: postgres|service_role (SOMENTE)
revoke all on public.norte_admins from public, anon, authenticated;
grant all on public.norte_admins to postgres, service_role;

-- norte_leads â€” ACL vivo: postgres|service_role=arwdDxtm, authenticated=r (SÃ“ SELECT)
revoke all on public.norte_leads from public, anon, authenticated;
grant select on public.norte_leads to authenticated;
grant all on public.norte_leads to postgres, service_role;

-- rate_buckets â€” ACL vivo: postgres|service_role (SOMENTE, SEM anon/authenticated)
revoke all on public.rate_buckets from public, anon, authenticated;
grant all on public.rate_buckets to service_role;

-- revenda_checkouts â€” ACL vivo: authenticated|service_role (SOMENTE, SEM anon)
revoke all on public.revenda_checkouts from public, anon, authenticated;
grant all on public.revenda_checkouts to authenticated, service_role;

-- ==========================================================================
-- Cron jobs (pg_cron) â€” emitidos como comentÃ¡rio SQL (nÃ£o executa neste arquivo)
-- ==========================================================================
-- pg_cron: job 'delivery-expirar' â€” schedule '*/10 * * * *' â€” comando: update public.delivery_pedidos set status = 'expirado', atualizado_em = now() where status = 'aguardando_pagamento' and criado_em < now() - interval '3 hours'; update public.revenda_checkouts set status = 'expirado' where status = 'aguardando' and criado_em < now() - interval '3 hours';
-- -- select cron.schedule('delivery-expirar', '*/10 * * * *', '...');  // descomentar ao reproduzir em projeto novo (requer extensÃ£o pg_cron)

-- pg_cron: job 'whatsapp-enviar' â€” schedule '* * * * *' â€” comando: select net.http_post(url := 'https://zqadfktfplrbrjmepllh.supabase.co/functions/v1/whatsapp-enviar', body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 30000) where exists (select 1 from public.whatsapp_envios where status = 'pendente' e
-- -- select cron.schedule('whatsapp-enviar', '* * * * *', '...');  // descomentar ao reproduzir em projeto novo (requer extensÃ£o pg_cron)

-- FASE 3 concluÃ­da 2026-11-17: schema.sql reflete o banco vivo pÃ³s-migrations 062/063/064 (31 tabelas).






