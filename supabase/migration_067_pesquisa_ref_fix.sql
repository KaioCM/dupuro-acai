-- migration_067 — pesquisa_registrar: valida ref só por canal (destrava primeiro_login)
--
-- O que: replace de public.pesquisa_registrar(idêntica assinatura/corpo da 066) com
--   a validação de referência movida PARA DENTRO de cada ramo de canal.
-- Por quê (bug provado): em 'primeiro_login' o corpo substitui v_ref pelo uid
--   (v_ref := v_uid::text), mas um bloco genérico à frente do if/elsif zera a
--   validação ao ver v_ref IS NULL → retorna 'referencia invalida' ANTES do
--   ramo que faria o mapeamento. Resultado: 'pesquisa_registrar('primeiro_login','',null,'x')'
--   falha com 'referencia invalida' mesmo havendo sessão autenticada.
--   A mesma causa pode afetar 'cadastro'. Canais 'delivery', 'pdv', 'painel' e
--   'ativacao' não são impactados porque já têm refs concretas por definição.
-- Correcão: remover o gate genérico (antes do if/elsif); adicionar
--   IF v_ref ... dentro dos ramos 'painel', 'cadastro','primeiro_login',
--   e 'ativacao'. 'delivery' e 'pdv' mantêm as validações existentes
--   (exists / regex).
-- Nota de ordem: depois de 065 (cupom_origem) e 066 (criação da RPC); aplicável
--   sem risco se a 066 já estiver viva (replace funciona). Mantém os grants finais.

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
  -- Removido: gate genérico de ref que bloqueava canais onde v_ref é nulo
  --   antes de ser mapeado para uid (primeiro_login, cadastro).
  if v_texto is not null and char_length(v_texto) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'texto longo demais');
  end if;
  if v_nota is not null and v_nota not between 1 and 5 then
    return jsonb_build_object('ok', false, 'motivo', 'nota invalida');
  end if;

  if v_nota is null and v_texto is null then
    return jsonb_build_object('ok', false, 'motivo', 'resposta vazia');
  end if;

  -- ref precisa apontar pra algo real ou ser válido, por canal
  if p_canal = 'delivery' then
    select exists (select 1 from delivery_pedidos dp
      where dp.token::text = v_ref and dp.status = 'entregue') into v_existe;
    if not v_existe then return jsonb_build_object('ok', false, 'motivo', 'pedido nao encontrado ou nao entregue'); end if;
  elsif p_canal = 'painel' then
    if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sem sessao'); end if;
    if v_ref is null or char_length(v_ref) > 40 then
      return jsonb_build_object('ok', false, 'motivo', 'referencia invalida');
    end if;
    select exists (select 1 from orders o
      where o.numero = v_ref and o.revendedor_id = v_uid and o.status = 'entregue') into v_existe;
    if not v_existe then return jsonb_build_object('ok', false, 'motivo', 'pedido nao encontrado'); end if;
  elsif p_canal = 'pdv' then
    -- pdv: valida formato só (sem cupom de recompensa aqui; existir a venda é verificado no lote do PDV)
    if v_ref !~ '^VND-[0-9A-Z]+$' then return jsonb_build_object('ok', false, 'motivo', 'numero de venda invalido'); end if;
  elsif p_canal in ('cadastro','primeiro_login') then
    if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sem sessao'); end if;
    v_ref := v_uid::text;
    if v_ref is null or char_length(v_ref) > 40 then
      return jsonb_build_object('ok', false, 'motivo', 'referencia invalida');
    end if;
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
