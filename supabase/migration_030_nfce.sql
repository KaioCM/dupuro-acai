-- ==========================================================================
-- migration_030_nfce.sql — NFC-e (cupom fiscal do balcão) via gateway Focus NFe
-- ==========================================================================
-- Contexto: a loja passa a emitir NFC-e (modelo 65) pelo nosso caixa, via a API
-- do Focus NFe (que assina com o certificado A1 e transmite ao SEFAZ-MT). A
-- emissão em si roda na Edge Function `emitir-nfce` (o token do Focus é secret
-- do servidor, nunca no cliente). Aqui ficam: (1) os campos fiscais por produto
-- e (2) a tabela que registra cada cupom emitido.
--
-- Padrão fiscal da Dupuro (Simples Nacional, venda a consumidor dentro de MT):
--   CSOSN 102, CFOP 5102, origem 0, NCM 08119000 (açaí/complementos). Bebidas
--   industrializadas podem ser ST (CSOSN 500 + CEST) — ajustar por produto.
-- ==========================================================================

-- ---------- Campos fiscais por produto ----------
alter table public.products add column if not exists ncm text not null default '08119000';
alter table public.products add column if not exists csosn text not null default '102';
alter table public.products add column if not exists cfop text not null default '5102';
alter table public.products add column if not exists icms_origem text not null default '0';
-- CEST só é usado em produtos com substituição tributária (nulo = sem ST).
alter table public.products add column if not exists cest text;

-- ---------- Registro de emissões de NFC-e ----------
-- Uma linha por tentativa de emissão de uma venda (VND-XXXX). Escrita só pela
-- Edge Function (service role); atendente e admin apenas leem (pra mostrar o
-- status/QR no caixa e no admin).
create table if not exists public.nfce_emissoes (
  id bigint generated always as identity primary key,
  -- Número da venda no nosso sistema (orders.numero = 'VND-XXXX').
  venda_numero text not null,
  -- Referência única enviada ao Focus (idempotência: reenviar não duplica).
  ref text not null unique,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  -- processando: enviado, aguardando; autorizado: cupom válido; erro: rejeitado;
  -- cancelado: cupom cancelado depois.
  status text not null default 'processando' check (status in ('processando', 'autorizado', 'erro', 'cancelado')),
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
  -- Corpo enviado ao Focus e a resposta bruta (auditoria/depuração).
  payload jsonb,
  retorno jsonb,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists nfce_emissoes_venda_idx on public.nfce_emissoes(venda_numero);

alter table public.nfce_emissoes enable row level security;

-- Leitura para atendente (caixa) e admin. Escrita é exclusiva da Edge Function
-- (service role, que ignora RLS) — por isso não há policy de insert/update/delete.
create policy "nfce_select_caixa_admin" on public.nfce_emissoes
  for select using (public.is_atendente() or public.is_admin());

grant select on public.nfce_emissoes to authenticated;
