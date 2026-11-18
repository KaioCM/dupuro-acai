-- migration_066 — pesquisa de feedback: tabela única + registro server-side
--
-- O que: tabela `pesquisa_respostas` (canais: painel, delivery, pdv, cadastro,
--   primeiro_login, ativacao) + RPC `pesquisa_registrar` que valida o `ref` por
--   canal, impede resposta dupla (unique canal+ref), limita volume/dia
--   (breaker) e EMITE A RECOMPENSA na mesma transação (cupom de verdade,
--   criado pelo banco — nunca pelo navegador).
-- Por quê: plano de feedback (ativação dos 19 aprovados sem pedido + CSAT
--   pós-entrega). Recompensa atrelada a resposta válida é o incentivo que a
--   literatura valida (RR ~1,2), e o cupom já existe como moeda.
-- Lições costuradas: painel admin lê direto via PostgREST (grant SELECT a
--   authenticated + RLS is_admin — revogar isso quebra a tela, ver 062);
--   escrita exclusivamente via RPC service_role.
-- Nota de ordem: 064=higienizacao (paralelo do usuário, não tocar), 065=cupom_origem
--   (ALTER coluna origem), 066=pesquisa (RPC usa coupons.origem → precisa da 065 aplicada).

create table if not exists public.pesquisa_respostas (
  id bigint generated always as identity primary key,
  canal text not null check (canal in ('painel','delivery','pdv','cadastro','primeiro_login','ativacao')),
  ref text not null,
  nota int check (nota between 1 and 5),
  texto text check (texto is null or char_length(texto) <= 500),
  criado_em timestamptz not null default now(),
  -- rótulos: escritos só pela Edge pesquisa-analisar (service_role)
  topico text,
  urgencia int check (urgencia between 0 and 9),
  coerente boolean,
  confianca numeric(4,3),
  rotulado_em timestamptz,
  recompensa text,
  unique (canal, ref)
);

alter table public.pesquisa_respostas enable row level security;

-- admin vê tudo (leitura direta via PostgREST, como o resto do painel)
create policy pesquisa_admin_select on public.pesquisa_respostas
  for select to authenticated using (public.is_admin());

revoke all on public.pesquisa_respostas from anon;
grant select on public.pesquisa_respostas to authenticated;
grant all on public.pesquisa_respostas to service_role;

-- índice do breaker e do painel
create index if not exists pesquisa_criado_em_idx on public.pesquisa_respostas (criado_em desc);

-- registrar resposta: única porta de entrada (anon via link do pedido,
-- authenticated via painel). Recompensa acontece aqui, no banco.
create or replace function public.pesquisa_registrar(
  p_canal text, p_ref text, p_nota int default null, p_texto text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := nullif(trim(coalesce(p_ref,'')), '');
  v_texto text := nullif(trim(coalesce(p_texto,'')), '');
  v_nota int := nullif(p_nota, 0);
  v_existe boolean;
  v_hoje int;
  v_cupom text;
  v_row public.pesquisa_respostas%rowtype;
begin
  if p_canal not in ('painel','delivery','pdv','cadastro','primeiro_login','ativacao') then
    return jsonb_build_object('ok', false, 'motivo', 'canal invalido');
  end if;
  if v_ref is null or char_length(v_ref) > 40 then
    return jsonb_build_object('ok', false, 'motivo', 'referencia invalida');
  end if;
  if v_texto is not null and char_length(v_texto) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'texto longo demais');
  end if;
  if v_nota is not null and v_nota not between 1 and 5 then
    return jsonb_build_object('ok', false, 'motivo', 'nota invalida');
  end if;

  if v_nota is null and v_texto is null then
    return jsonb_build_object('ok', false, 'motivo', 'resposta vazia');
  end if;

  -- ref precisa apontar pra algo real, por canal
  if p_canal = 'delivery' then
    select exists (select 1 from delivery_pedidos dp
      where dp.token::text = v_ref and dp.status = 'entregue') into v_existe;
    if not v_existe then return jsonb_build_object('ok', false, 'motivo', 'pedido nao encontrado ou nao entregue'); end if;
  elsif p_canal = 'painel' then
    if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sem sessao'); end if;
    select exists (select 1 from orders o
      where o.numero = v_ref and o.revendedor_id = v_uid and o.status = 'entregue') into v_existe;
    if not v_existe then return jsonb_build_object('ok', false, 'motivo', 'pedido nao encontrado'); end if;
  elsif p_canal = 'pdv' then
    -- pdv: valida formato só (sem cupom de recompensa aqui; existir a venda é verificado no lote do PDV)
    if v_ref !~ '^VND-[0-9A-Z]+$' then return jsonb_build_object('ok', false, 'motivo', 'numero de venda invalido'); end if;
  elsif p_canal in ('cadastro','primeiro_login') then
    if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sem sessao'); end if;
    v_ref := v_uid::text;
  else -- ativacao: registro manual pelo admin
    if not public.is_admin() then return jsonb_build_object('ok', false, 'motivo', 'so o admin registra ativacao'); end if;
  end if;

  select exists (select 1 from pesquisa_respostas pr
    where pr.canal = p_canal and pr.ref = v_ref) into v_existe;
  if v_existe then return jsonb_build_object('ok', false, 'motivo', 'ja respondido'); end if;

  select count(*) into v_hoje from pesquisa_respostas where (criado_em at time zone 'America/Cuiaba')::date = (now() at time zone 'America/Cuiaba')::date;
  if v_hoje >= 100 then return jsonb_build_object('ok', false, 'motivo', 'pesquisa fechada por hoje'); end if;

  -- recompensa: cupom real criado no banco, atrelado a esta resposta
  if p_canal = 'delivery' then
    v_cupom := 'DUPURO-FRETE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    insert into coupons (revendedor_id, code, descricao, desconto_percent, validade, tipo, origem)
      values (null, v_cupom, 'Obrigado por avaliar sua entrega', null,
              (now() at time zone 'America/Cuiaba')::date + 7, 'frete', 'pesquisa');
  elsif p_canal = 'painel' then
    v_cupom := 'DUPURO-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    insert into coupons (revendedor_id, code, descricao, desconto_percent, validade, tipo, origem)
      values (v_uid, v_cupom, 'Obrigado por avaliar o pedido', 10,
              (now() at time zone 'America/Cuiaba')::date + 30, 'pct', 'pesquisa');
  end if;

  insert into pesquisa_respostas (canal, ref, nota, texto, recompensa)
    values (p_canal, v_ref, v_nota, v_texto, v_cupom)
    returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'cupom', v_cupom);
end $$;

revoke execute on function public.pesquisa_registrar(text, text, int, text) from public;
grant execute on function public.pesquisa_registrar(text, text, int, text) to anon, authenticated;
