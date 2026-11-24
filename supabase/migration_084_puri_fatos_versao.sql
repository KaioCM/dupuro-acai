-- 084: fatos da Puri com controle de versão (conflito entre telas), volta escolhendo a versão do histórico,
-- filtro de telefone mais forte e higiene. Corrige a 083 (que não é editada). Contrato: docs/assistente/ETAPA5-FATOS-CONTRATO.md

-- 1) versão: toda escrita soma 1; o front manda de volta o inteiro que recebeu.
alter table public.puri_fatos add column if not exists versao integer not null default 1;

-- 5) higiene
update public.puri_fatos_historico set tipo = 'rascunho' where tipo is null;
update public.puri_fatos_historico set criado_em = now() where criado_em is null;
alter table public.puri_fatos_historico alter column tipo set not null;
alter table public.puri_fatos_historico alter column criado_em set not null;
revoke all on sequence public.puri_fatos_historico_id_seq from public, anon, authenticated;

-- assinaturas antigas (083)
drop function if exists public.puri_fato_salvar(text, text, timestamptz);
drop function if exists public.puri_fato_publicar(text, timestamptz);
drop function if exists public.puri_fato_descartar(text);
drop function if exists public.puri_fato_voltar(text);

-- Salvar rascunho (não publica).
create or replace function public.puri_fato_salvar(p_assunto text, p_texto text, p_versao integer)
returns public.puri_fatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f      public.puri_fatos;
  v_texto  text;
  v_m      text[];
  v_cand   text;
  v_dig    text;
begin
  if not public.puri_dono() then
    raise exception 'Sem permissão para editar os fatos da Puri.' using errcode = '42501';
  end if;

  select * into v_f from public.puri_fatos f where f.assunto = p_assunto for update;
  if not found then
    raise exception 'Assunto não encontrado.';
  end if;
  if v_f.travado then
    raise exception 'Este assunto é travado: só pode ser mudado no código, não aqui.';
  end if;
  if v_f.versao is distinct from p_versao then
    raise exception 'Conflito: este fato mudou em outra tela. Recarregue.';
  end if;

  v_texto := replace(coalesce(p_texto, ''), chr(13), '');
  v_texto := replace(v_texto, chr(9), ' ');
  if v_texto ~ '[\x01-\x09\x0b-\x1f\x7f]' then
    raise exception 'O texto tem caracteres inválidos (de controle).';
  end if;
  if v_texto ~ '[<>]' then
    raise exception 'O texto não pode ter os sinais < ou >.';
  end if;
  v_texto := btrim(regexp_replace(v_texto, '\s+', ' ', 'g'));
  if char_length(v_texto) < 10 or char_length(v_texto) > 2000 then
    raise exception 'O texto precisa ter entre 10 e 2000 caracteres (agora tem %).', char_length(v_texto);
  end if;

  -- Telefone: só os dois da Dupuro (99288-8228 fábrica; 9694-9542 loja). Procura sequências de dígitos
  -- com separadores comuns (espaço, ponto, hífen, barra, parênteses) e olha as que têm de 8 a 13 dígitos.
  -- Passam: CEP da fábrica, datas (dd/mm/aaaa, aaaa-mm-dd) e par de anos ("2026 2027").
  -- Qualquer outra sequência de 8 a 13 dígitos que não seja um dos dois telefones é recusada (na dúvida, recusa).
  for v_m in
    select regexp_matches(v_texto, '(?<![0-9])([+(]?[0-9][0-9 ().+/-]*[0-9])(?![0-9])', 'g')
  loop
    v_cand := btrim(v_m[1]);
    v_dig := regexp_replace(v_cand, '[^0-9]', '', 'g');
    if char_length(v_dig) < 8 or char_length(v_dig) > 13 then
      continue;
    end if;
    if v_dig = '78076001'
       or v_cand ~ '^[0-9]{2}[/.-][0-9]{2}[/.-][0-9]{4}$'
       or v_cand ~ '^[0-9]{4}[/.-][0-9]{2}[/.-][0-9]{2}$'
       or v_cand ~ '^(19|20)[0-9]{2}[ ./-]+(19|20)[0-9]{2}$' then
      continue;
    end if;
    if char_length(v_dig) in (12, 13) and left(v_dig, 2) = '55' then
      v_dig := substr(v_dig, 3);
    end if;
    if char_length(v_dig) in (10, 11) and left(v_dig, 2) = '65' then
      v_dig := substr(v_dig, 3);
    end if;
    if v_dig not in ('992888228', '96949542') then
      raise exception 'Número não permitido: %. Só os telefones da Dupuro ((65) 99288-8228 e (65) 9694-9542) podem aparecer.', v_cand;
    end if;
  end loop;

  if v_texto = v_f.rascunho then
    return v_f; -- nada mudou: não grava, não soma versão
  end if;

  update public.puri_fatos f
     set rascunho = v_texto, rascunho_em = clock_timestamp(), versao = f.versao + 1
   where f.assunto = p_assunto
   returning f.* into v_f;

  insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
  values (p_assunto, 'rascunho', v_texto, auth.uid());

  return v_f;
end;
$$;

-- Publicar o rascunho (guarda o publicado ANTERIOR no histórico, tipo 'publicado').
create or replace function public.puri_fato_publicar(p_assunto text, p_versao integer)
returns public.puri_fatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f public.puri_fatos;
begin
  if not public.puri_dono() then
    raise exception 'Sem permissão para editar os fatos da Puri.' using errcode = '42501';
  end if;

  select * into v_f from public.puri_fatos f where f.assunto = p_assunto for update;
  if not found then
    raise exception 'Assunto não encontrado.';
  end if;
  if v_f.travado then
    raise exception 'Este assunto é travado: só pode ser mudado no código, não aqui.';
  end if;
  if v_f.versao is distinct from p_versao then
    raise exception 'Conflito: este fato mudou em outra tela. Recarregue.';
  end if;
  if v_f.rascunho = v_f.publicado then
    raise exception 'Não há rascunho diferente do publicado neste assunto.';
  end if;

  insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
  values (p_assunto, 'publicado', v_f.publicado, auth.uid());

  update public.puri_fatos f
     set publicado = f.rascunho, publicado_em = now(), rascunho_em = null, versao = f.versao + 1
   where f.assunto = p_assunto
   returning f.* into v_f;

  return v_f;
end;
$$;

-- Descartar o rascunho (volta a ser igual ao publicado).
create or replace function public.puri_fato_descartar(p_assunto text, p_versao integer)
returns public.puri_fatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f public.puri_fatos;
begin
  if not public.puri_dono() then
    raise exception 'Sem permissão para editar os fatos da Puri.' using errcode = '42501';
  end if;

  select * into v_f from public.puri_fatos f where f.assunto = p_assunto for update;
  if not found then
    raise exception 'Assunto não encontrado.';
  end if;
  if v_f.travado then
    raise exception 'Este assunto é travado: só pode ser mudado no código, não aqui.';
  end if;
  if v_f.versao is distinct from p_versao then
    raise exception 'Conflito: este fato mudou em outra tela. Recarregue.';
  end if;

  if v_f.rascunho <> v_f.publicado then
    insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
    values (p_assunto, 'descartado', v_f.rascunho, auth.uid());
  end if;

  update public.puri_fatos f
     set rascunho = f.publicado, rascunho_em = null, versao = f.versao + 1
   where f.assunto = p_assunto
   returning f.* into v_f;

  return v_f;
end;
$$;

-- Voltar a uma versão publicada antes (linha do histórico escolhida): põe no RASCUNHO, não publica.
create or replace function public.puri_fato_voltar(p_assunto text, p_historico_id bigint, p_versao integer)
returns public.puri_fatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f     public.puri_fatos;
  v_texto text;
begin
  if not public.puri_dono() then
    raise exception 'Sem permissão para editar os fatos da Puri.' using errcode = '42501';
  end if;

  select * into v_f from public.puri_fatos f where f.assunto = p_assunto for update;
  if not found then
    raise exception 'Assunto não encontrado.';
  end if;
  if v_f.travado then
    raise exception 'Este assunto é travado: só pode ser mudado no código, não aqui.';
  end if;
  if v_f.versao is distinct from p_versao then
    raise exception 'Conflito: este fato mudou em outra tela. Recarregue.';
  end if;

  select h.texto into v_texto
    from public.puri_fatos_historico h
   where h.id = p_historico_id and h.assunto = p_assunto and h.tipo = 'publicado';
  if v_texto is null then
    raise exception 'Versão do histórico não encontrada para este assunto.';
  end if;

  update public.puri_fatos f
     set rascunho = v_texto, rascunho_em = clock_timestamp(), versao = f.versao + 1
   where f.assunto = p_assunto
   returning f.* into v_f;

  insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
  values (p_assunto, 'voltou', v_texto, auth.uid());

  return v_f;
end;
$$;

revoke all on function public.puri_fato_salvar(text, text, integer) from public, anon;
revoke all on function public.puri_fato_publicar(text, integer) from public, anon;
revoke all on function public.puri_fato_descartar(text, integer) from public, anon;
revoke all on function public.puri_fato_voltar(text, bigint, integer) from public, anon;
grant execute on function public.puri_fato_salvar(text, text, integer) to authenticated;
grant execute on function public.puri_fato_publicar(text, integer) to authenticated;
grant execute on function public.puri_fato_descartar(text, integer) to authenticated;
grant execute on function public.puri_fato_voltar(text, bigint, integer) to authenticated;

-- 6) avisos (onde o fato também está escrito no código)
update public.puri_fatos set aviso = 'O slogan e a cidade também aparecem em outras páginas do site. Mudar aqui não muda lá.' where assunto = 'empresa';
update public.puri_fatos set aviso = 'O endereço, os telefones da fábrica e da loja e o Instagram também estão escritos nas respostas prontas e nas travas de segurança da Puri, e no texto que ela mostra no site. Mudar aqui não muda lá: peça para ajustar também.' where assunto = 'contato_endereco';
update public.puri_fatos set aviso = 'O fluxo de conta e aprovação também está escrito nas falas da Puri no site.' where assunto = 'cadastro_painel';
