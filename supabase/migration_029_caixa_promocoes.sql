-- Promoções diárias do caixa (só balcão/loja). Cada dia: até 3 unitárias + 3
-- combos. Reset automático: tudo é filtrado por dia = hoje (America/Cuiaba); no
-- dia seguinte as promoções não aparecem e o preço volta ao normal sozinho
-- (o histórico permanece na tabela). Aplicada via MCP; este arquivo é o espelho.
create table if not exists public.caixa_promocoes (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.products(id) on delete cascade,
  tipo text not null check (tipo in ('unitario','combo')),
  preco_promo numeric(10,2) not null check (preco_promo >= 0),
  combo_qtd int check (combo_qtd is null or combo_qtd >= 2),
  dia date not null default ((now() at time zone 'America/Cuiaba')::date),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint promo_combo_qtd_coerente check (
    (tipo = 'combo' and combo_qtd is not null)
    or (tipo = 'unitario' and combo_qtd is null)
  ),
  unique (dia, produto_id, tipo)
);

alter table public.caixa_promocoes enable row level security;

create policy "promos_select_equipe" on public.caixa_promocoes
  for select using (public.is_atendente() or public.is_admin());

create policy "promos_insert_equipe" on public.caixa_promocoes
  for insert with check (
    (public.is_atendente() or public.is_admin())
    and dia = (now() at time zone 'America/Cuiaba')::date
  );

create policy "promos_update_equipe" on public.caixa_promocoes
  for update using (
    (public.is_atendente() or public.is_admin())
    and dia = (now() at time zone 'America/Cuiaba')::date
  ) with check (
    (public.is_atendente() or public.is_admin())
    and dia = (now() at time zone 'America/Cuiaba')::date
  );

create policy "promos_delete_equipe" on public.caixa_promocoes
  for delete using (
    (public.is_atendente() or public.is_admin())
    and dia = (now() at time zone 'America/Cuiaba')::date
  );

-- Trava do limite: no máximo 3 promoções de cada tipo por dia.
create or replace function public.check_limite_promocoes()
returns trigger language plpgsql as $$
declare v_qtd int;
begin
  select count(*) into v_qtd from public.caixa_promocoes
    where dia = new.dia and tipo = new.tipo and id <> new.id;
  if v_qtd >= 3 then
    raise exception 'Limite de 3 promoções do tipo % por dia atingido.', new.tipo
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists caixa_promocoes_limite on public.caixa_promocoes;
create trigger caixa_promocoes_limite
  before insert or update on public.caixa_promocoes
  for each row execute function public.check_limite_promocoes();
