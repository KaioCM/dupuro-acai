-- migration_043: ajuste manual de estoque com motivo e histórico.
--
-- Antes, corrigir uma contagem era editar o número cru no cadastro do produto,
-- sem registro de quem, quando nem por quê. Agora o admin ajusta por sabor
-- ("somar 3" / "tirar 2") com um motivo, tudo numa função só de admin, e cada
-- ajuste fica em estoque_ajustes. O "Desfazer" da tela é só outro ajuste ao
-- contrário (também registrado).

create table if not exists public.estoque_ajustes (
  id bigint generated always as identity primary key,
  produto_id bigint references public.products(id) on delete set null,
  produto_nome text,
  sabor text,
  delta integer not null check (delta <> 0),
  motivo text not null check (length(motivo) between 2 and 120 and motivo !~ '[<>]'),
  admin_id uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists estoque_ajustes_criado_idx on public.estoque_ajustes (criado_em desc);
create index if not exists estoque_ajustes_produto_idx on public.estoque_ajustes (produto_id);

alter table public.estoque_ajustes enable row level security;
drop policy if exists estoque_ajustes_admin_select on public.estoque_ajustes;
create policy estoque_ajustes_admin_select on public.estoque_ajustes
  for select to authenticated using ((select public.is_admin()));
-- sem policy de insert/update/delete: só a função abaixo grava.

create or replace function public.ajustar_estoque(p_produto_id bigint, p_sabor text, p_delta integer, p_motivo text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nome text;
begin
  if not public.is_admin() then
    raise exception 'Só admin ajusta estoque' using errcode = '42501';
  end if;
  if coalesce(p_delta, 0) = 0 then
    raise exception 'Informe quanto somar ou tirar' using errcode = '22023';
  end if;
  select nome into v_nome from public.products where id = p_produto_id and modo = 'embalado';
  if v_nome is null then
    raise exception 'Produto sem estoque por unidade' using errcode = 'P0002';
  end if;
  -- Mesma regra da leva: cria a linha do sabor se faltar e respeita estoque >= 0.
  perform public.producao_aplicar_delta('[]'::jsonb,
    jsonb_build_array(jsonb_build_object('produto_id', p_produto_id, 'sabor', p_sabor, 'quantidade', p_delta)));
  insert into public.estoque_ajustes (produto_id, produto_nome, sabor, delta, motivo)
  values (p_produto_id, v_nome, nullif(p_sabor, ''), p_delta, trim(p_motivo));
  return public.available_stock(p_produto_id, nullif(p_sabor, ''));
end;
$$;
revoke execute on function public.ajustar_estoque(bigint, text, integer, text) from public, anon;
grant execute on function public.ajustar_estoque(bigint, text, integer, text) to authenticated;
