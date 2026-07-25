-- Custos de produção por leva (aplicada via MCP). Este arquivo é só o espelho.
-- Uma leva = gastos (linhas por categoria) + produtos produzidos. O custo por
-- litro é o gasto total / litros totais; cada produto é rateado por volume.
-- Tudo admin-only: custo/lucro é informação sensível que atendente e revendedor
-- não podem ver.

create table if not exists public.producoes (
  id bigint generated always as identity primary key,
  data date not null default ((now() at time zone 'America/Cuiaba')::date),
  rotulo text,
  observacao text,
  created_at timestamptz not null default now()
);

create table if not exists public.producao_gastos (
  id bigint generated always as identity primary key,
  producao_id bigint not null references public.producoes(id) on delete cascade,
  descricao text,
  categoria text not null check (categoria in ('materia_prima','embalagem','mao_de_obra','contas_fixos')),
  valor numeric(12,2) not null default 0
);

create table if not exists public.producao_itens (
  id bigint generated always as identity primary key,
  producao_id bigint not null references public.producoes(id) on delete cascade,
  produto_id bigint references public.products(id) on delete set null,
  produto_nome text,
  quantidade numeric(12,3) not null default 0,
  litros_unit numeric(10,3) not null default 0
);

create index if not exists producao_gastos_producao_idx on public.producao_gastos(producao_id);
create index if not exists producao_itens_producao_idx on public.producao_itens(producao_id);

alter table public.producoes enable row level security;
alter table public.producao_gastos enable row level security;
alter table public.producao_itens enable row level security;

create policy producoes_all_admin on public.producoes
  for all using (public.is_admin()) with check (public.is_admin());
create policy producao_gastos_all_admin on public.producao_gastos
  for all using (public.is_admin()) with check (public.is_admin());
create policy producao_itens_all_admin on public.producao_itens
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.producoes to authenticated;
grant select, insert, update, delete on public.producao_gastos to authenticated;
grant select, insert, update, delete on public.producao_itens to authenticated;
