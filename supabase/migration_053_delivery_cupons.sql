-- migration_053 — Cupons do delivery (pedido do Kayo, 2026-10-26)
-- Cupom digitado na tela 3 (Pagar) do /delivery/pedido.html. Tipos, por cupom:
--   percent = % sobre os produtos · fixo = R$ de desconto (até o subtotal) · frete = zera a taxa.
-- Regras configuráveis no admin (Cadastros → Cupons): validade, pedido mínimo, limite total,
-- 1 uso por telefone, ativo. O desconto é SEMPRE calculado no banco (delivery_aplicar_cupom),
-- chamado pela tela (prévia) e pela Edge Function delivery-checkout (vale de verdade).
-- Uso conta só pedido que se concretizou (pago/em_rota/entregue): pedido abandonado não gasta o cupom.

create table if not exists public.delivery_cupons (
  id bigserial primary key,
  codigo text not null unique check (codigo ~ '^[A-Z0-9]{3,20}$'),
  tipo text not null check (tipo in ('percent', 'fixo', 'frete')),
  valor numeric(10,2) not null default 0 check (valor >= 0),
  pedido_minimo numeric(10,2) not null default 0 check (pedido_minimo >= 0),
  validade date,
  limite_total integer check (limite_total is null or limite_total > 0),
  um_por_telefone boolean not null default true,
  ativo boolean not null default true,
  descricao text check (descricao is null or descricao !~ '[<>]'),
  criado_em timestamptz not null default now(),
  check (tipo <> 'percent' or (valor > 0 and valor <= 100)),
  check (tipo <> 'fixo' or valor > 0)
);
alter table public.delivery_cupons enable row level security;
drop policy if exists delivery_cupons_admin on public.delivery_cupons;
create policy delivery_cupons_admin on public.delivery_cupons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.delivery_pedidos
  add column if not exists cupom_codigo text,
  add column if not exists desconto numeric(10,2) not null default 0 check (desconto >= 0);
create index if not exists delivery_pedidos_cupom_idx on public.delivery_pedidos (cupom_codigo) where cupom_codigo is not null;

create or replace function public.delivery_aplicar_cupom(p_codigo text, p_telefone text, p_subtotal numeric, p_taxa numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.delivery_cupons;
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_desc numeric;
  v_hoje date := (now() at time zone 'America/Cuiaba')::date;
begin
  select * into c from public.delivery_cupons where codigo = upper(btrim(coalesce(p_codigo, '')));
  if not found or not c.ativo then
    return jsonb_build_object('ok', false, 'msg', 'Cupom inválido.');
  end if;
  if c.validade is not null and c.validade < v_hoje then
    return jsonb_build_object('ok', false, 'msg', 'Esse cupom venceu.');
  end if;
  if coalesce(p_subtotal, 0) < c.pedido_minimo then
    return jsonb_build_object('ok', false, 'msg', 'Esse cupom vale para pedidos a partir de R$ ' || replace(to_char(c.pedido_minimo, 'FM999990.00'), '.', ',') || ' em produtos.');
  end if;
  if c.limite_total is not null and (select count(*) from public.delivery_pedidos
       where cupom_codigo = c.codigo and status in ('pago', 'em_rota', 'entregue')) >= c.limite_total then
    return jsonb_build_object('ok', false, 'msg', 'Esse cupom esgotou.');
  end if;
  if c.um_por_telefone and length(v_tel) >= 10 and exists (select 1 from public.delivery_pedidos
       where cupom_codigo = c.codigo and status in ('pago', 'em_rota', 'entregue')
         and right(regexp_replace(cliente_telefone, '\D', '', 'g'), 11) = right(v_tel, 11)) then
    return jsonb_build_object('ok', false, 'msg', 'Você já usou esse cupom.');
  end if;
  v_desc := case c.tipo
    when 'percent' then round(coalesce(p_subtotal, 0) * c.valor / 100, 2)
    when 'fixo' then least(c.valor, coalesce(p_subtotal, 0))
    else coalesce(p_taxa, 0) end;
  return jsonb_build_object('ok', true, 'codigo', c.codigo, 'tipo', c.tipo, 'valor', c.valor, 'desconto', v_desc,
    'msg', case c.tipo when 'frete' then 'Cupom aplicado: entrega grátis.'
                       when 'percent' then 'Cupom aplicado: ' || trim(to_char(c.valor, 'FM990.##')) || '% nos produtos.'
                       else 'Cupom aplicado: R$ ' || replace(to_char(c.valor, 'FM999990.00'), '.', ',') || ' de desconto.' end);
end $$;
revoke all on function public.delivery_aplicar_cupom(text, text, numeric, numeric) from public;
grant execute on function public.delivery_aplicar_cupom(text, text, numeric, numeric) to anon, authenticated, service_role;

-- Cupom de teste pedido pelo Kayo: frete grátis, sem mínimo, sem limite por telefone (pra testar mais de uma vez).
insert into public.delivery_cupons (codigo, tipo, valor, pedido_minimo, um_por_telefone, descricao)
values ('TESTEFRETE', 'frete', 0, 0, false, 'Teste do Kayo (frete grátis) — apagar depois')
on conflict (codigo) do nothing;
