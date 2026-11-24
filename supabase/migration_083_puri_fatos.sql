-- 083: fatos da Puri editáveis por assunto (rascunho x publicado), só o Kayo (dono) edita.
-- Contrato: docs/assistente/ETAPA5-FATOS-CONTRATO.md. A Edge lê com service role (próxima etapa).
-- A seed vem de FATOS_LISTA em supabase/functions/assistente/fatos.ts (gerada por script).

create table if not exists public.puri_fatos (
  assunto      text primary key check (assunto ~ '^[a-z_]{2,40}$'),
  titulo       text not null,
  ordem        smallint not null,
  travado      boolean not null default false,
  aviso        text,
  publicado    text not null check (char_length(publicado) between 1 and 2000),
  rascunho     text not null check (char_length(rascunho) between 1 and 2000),
  rascunho_em  timestamptz,
  publicado_em timestamptz not null default now()
);

create table if not exists public.puri_fatos_historico (
  id        bigint generated always as identity primary key,
  assunto   text not null references public.puri_fatos (assunto),
  tipo      text check (tipo in ('rascunho', 'publicado', 'descartado', 'voltou')),
  texto     text not null,
  autor     uuid,
  criado_em timestamptz default now()
);
create index if not exists puri_fatos_historico_assunto_idx on public.puri_fatos_historico (assunto, id desc);

-- Dono da Puri: só o Kayo (mesmo id de PURI_AVISO_ADMIN no admin.html) e ainda admin.
create or replace function public.puri_dono()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.is_admin() and auth.uid() = '3954e9ce-d9e4-4516-a03f-87086ec68e11'::uuid, false);
$$;
revoke all on function public.puri_dono() from public, anon;
grant execute on function public.puri_dono() to authenticated, service_role;

alter table public.puri_fatos enable row level security;
alter table public.puri_fatos_historico enable row level security;

drop policy if exists puri_fatos_dono_le on public.puri_fatos;
create policy puri_fatos_dono_le on public.puri_fatos for select to authenticated using (public.puri_dono());
drop policy if exists puri_fatos_historico_dono_le on public.puri_fatos_historico;
create policy puri_fatos_historico_dono_le on public.puri_fatos_historico for select to authenticated using (public.puri_dono());

revoke all on public.puri_fatos from anon, authenticated;
revoke all on public.puri_fatos_historico from anon, authenticated;
grant select on public.puri_fatos to authenticated, service_role;
grant select on public.puri_fatos_historico to authenticated, service_role;

-- Salvar rascunho de um assunto (não publica).
create or replace function public.puri_fato_salvar(p_assunto text, p_texto text, p_base timestamptz)
returns public.puri_fatos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f      public.puri_fatos;
  v_texto  text;
  v_m      text[];
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
  if v_f.rascunho_em is distinct from p_base then
    raise exception 'Conflito: este rascunho foi alterado em outra tela depois que você abriu. Recarregue a página para ver a versão mais recente.';
  end if;

  v_texto := replace(coalesce(p_texto, ''), chr(13), '');
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

  -- Telefone: só os dois da Dupuro (99288-8228 fábrica; 9694-9542 loja). Aceita com ou sem DDD 65 / +55.
  for v_m in
    select regexp_matches(v_texto, '(?<![0-9])((?:\+?55 ?)?(?:\(?[0-9]{2}\)? ?)?9?[0-9]{4}[ -]?[0-9]{4})(?![0-9])', 'g')
  loop
    v_dig := regexp_replace(v_m[1], '[^0-9]', '', 'g');
    if v_dig = '78076001' then
      continue; -- CEP da fábrica escrito sem hífen
    end if;
    if char_length(v_dig) in (12, 13) and left(v_dig, 2) = '55' then
      v_dig := substr(v_dig, 3);
    end if;
    if char_length(v_dig) in (10, 11) then
      if left(v_dig, 2) <> '65' then
        raise exception 'Telefone não permitido: %. Só os números da Dupuro podem aparecer.', v_m[1];
      end if;
      v_dig := substr(v_dig, 3);
    end if;
    if v_dig not in ('992888228', '96949542') then
      raise exception 'Telefone não permitido: %. Só os números da Dupuro ((65) 99288-8228 e (65) 9694-9542) podem aparecer.', v_m[1];
    end if;
  end loop;

  update public.puri_fatos f
     set rascunho = v_texto, rascunho_em = clock_timestamp()
   where f.assunto = p_assunto
   returning f.* into v_f;

  insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
  values (p_assunto, 'rascunho', v_texto, auth.uid());

  return v_f;
end;
$$;

-- Publicar o rascunho de um assunto.
create or replace function public.puri_fato_publicar(p_assunto text, p_base timestamptz)
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
  if v_f.rascunho_em is distinct from p_base then
    raise exception 'Conflito: este rascunho foi alterado em outra tela depois que você abriu. Recarregue a página para ver a versão mais recente.';
  end if;
  if v_f.rascunho = v_f.publicado then
    raise exception 'Não há rascunho diferente do publicado neste assunto.';
  end if;

  -- guarda o publicado ANTERIOR (é ele que o "voltar" restaura)
  insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
  values (p_assunto, 'publicado', v_f.publicado, auth.uid());

  update public.puri_fatos f
     set publicado = f.rascunho, publicado_em = now(), rascunho_em = null
   where f.assunto = p_assunto
   returning f.* into v_f;

  return v_f;
end;
$$;

-- Descartar o rascunho (volta a ser igual ao publicado).
create or replace function public.puri_fato_descartar(p_assunto text)
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

  if v_f.rascunho <> v_f.publicado then
    insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
    values (p_assunto, 'descartado', v_f.rascunho, auth.uid());
  end if;

  update public.puri_fatos f
     set rascunho = f.publicado, rascunho_em = null
   where f.assunto = p_assunto
   returning f.* into v_f;

  return v_f;
end;
$$;

-- Voltar ao texto anterior: põe no RASCUNHO o último publicado anterior (diferente do atual). Não publica.
create or replace function public.puri_fato_voltar(p_assunto text)
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

  select h.texto into v_texto
    from public.puri_fatos_historico h
   where h.assunto = p_assunto and h.tipo = 'publicado' and h.texto <> v_f.publicado
   order by h.id desc
   limit 1;
  if v_texto is null then
    raise exception 'Não há texto anterior diferente do publicado para voltar.';
  end if;

  update public.puri_fatos f
     set rascunho = v_texto, rascunho_em = clock_timestamp()
   where f.assunto = p_assunto
   returning f.* into v_f;

  insert into public.puri_fatos_historico (assunto, tipo, texto, autor)
  values (p_assunto, 'voltou', v_texto, auth.uid());

  return v_f;
end;
$$;

revoke all on function public.puri_fato_salvar(text, text, timestamptz) from public, anon;
revoke all on function public.puri_fato_publicar(text, timestamptz) from public, anon;
revoke all on function public.puri_fato_descartar(text) from public, anon;
revoke all on function public.puri_fato_voltar(text) from public, anon;
grant execute on function public.puri_fato_salvar(text, text, timestamptz) to authenticated;
grant execute on function public.puri_fato_publicar(text, timestamptz) to authenticated;
grant execute on function public.puri_fato_descartar(text) to authenticated;
grant execute on function public.puri_fato_voltar(text) to authenticated;

-- Seed: 16 assuntos (texto idêntico a FATOS_LISTA).
insert into public.puri_fatos (assunto, titulo, ordem, travado, aviso, publicado, rascunho) values
  ('empresa', 'Empresa', 1, false, null, 'Empresa: Dupuro Açaí, fábrica e distribuidora de açaí e cremes em Cuiabá-MT. Slogan: "Puro como tem que ser".', 'Empresa: Dupuro Açaí, fábrica e distribuidora de açaí e cremes em Cuiabá-MT. Slogan: "Puro como tem que ser".'),
  ('contato_endereco', 'Endereço e contatos', 2, true, 'O endereço e os telefones da fábrica e da loja também estão escritos nas respostas prontas e nas travas de segurança da Puri, e no texto que ela mostra no site. Mudar aqui não muda lá: peça para ajustar também.', 'Endereço: Av. das Torres, nº 16, Jardim Imperial II, Cuiabá-MT, CEP 78076-001 (a mesma avenida também aparece como Av. Prof. Edna Maria Albuquerque Affi, nº 16). Não tem drive-thru.
WhatsApp: (65) 99288-8228. Também vende pelo iFood.
Instagram: @dupuroacai.', 'Endereço: Av. das Torres, nº 16, Jardim Imperial II, Cuiabá-MT, CEP 78076-001 (a mesma avenida também aparece como Av. Prof. Edna Maria Albuquerque Affi, nº 16). Não tem drive-thru.
WhatsApp: (65) 99288-8228. Também vende pelo iFood.
Instagram: @dupuroacai.'),
  ('horario', 'Horário de funcionamento', 3, false, 'O horário da fábrica (13h às 19h30) também está escrito nas respostas prontas da Puri no site. Se mudar, peça para ajustar lá também.', 'Horário da loja/fábrica: segunda a sábado, das 13h às 19h30 (retirada e visita à fábrica nesse horário).
Domingo e feriado: a loja/fábrica e o delivery NÃO funcionam. Fora do horário da loja, o WhatsApp tem autoatendimento por chatbot.', 'Horário da loja/fábrica: segunda a sábado, das 13h às 19h30 (retirada e visita à fábrica nesse horário).
Domingo e feriado: a loja/fábrica e o delivery NÃO funcionam. Fora do horário da loja, o WhatsApp tem autoatendimento por chatbot.'),
  ('avaliacao', 'Avaliação no Google', 4, false, null, 'Avaliação no Google: 4,8 com 34 avaliações.', 'Avaliação no Google: 4,8 com 34 avaliações.'),
  ('produtos', 'Produtos e composição', 5, false, null, 'Produtos: açaí e cremes em caixas; no momento os tamanhos são 500 ml, 1 L, 2 L, 5 L e 10 L. Cremes: Morango, Paçoca, Maracujá, Cupuaçu, Pistache, Ninho, Banana, Doce de Leite (a disponibilidade depende do estoque do dia). Granola Tia Sônia 1 kg: vendida pelo site (delivery) e na revenda.
Composição: o açaí contém água e açúcar (não é polpa pura).', 'Produtos: açaí e cremes em caixas; no momento os tamanhos são 500 ml, 1 L, 2 L, 5 L e 10 L. Cremes: Morango, Paçoca, Maracujá, Cupuaçu, Pistache, Ninho, Banana, Doce de Leite (a disponibilidade depende do estoque do dia). Granola Tia Sônia 1 kg: vendida pelo site (delivery) e na revenda.
Composição: o açaí contém água e açúcar (não é polpa pura).'),
  ('conservacao_validade', 'Conservação e validade', 6, false, null, 'Conservação: guardar no freezer e evitar recongelar (descongelar e congelar de novo faz o açaí cristalizar).
Validade: 6 meses mantido congelado, sem recongelar (derreter e congelar de novo).', 'Conservação: guardar no freezer e evitar recongelar (descongelar e congelar de novo faz o açaí cristalizar).
Validade: 6 meses mantido congelado, sem recongelar (derreter e congelar de novo).'),
  ('leite_gluten', 'Leite, lactose e glúten', 7, true, null, 'Leite e lactose: o açaí é 100% livre de leite (sem lactose); todos os cremes (Morango, Paçoca, Maracujá, Cupuaçu, Pistache, Ninho, Banana, Doce de Leite) têm leite na composição, portanto têm lactose.
Glúten: o açaí é sem glúten; os cremes têm glúten.', 'Leite e lactose: o açaí é 100% livre de leite (sem lactose); todos os cremes (Morango, Paçoca, Maracujá, Cupuaçu, Pistache, Ninho, Banana, Doce de Leite) têm leite na composição, portanto têm lactose.
Glúten: o açaí é sem glúten; os cremes têm glúten.'),
  ('revenda', 'Revenda (atacado)', 8, false, 'O mínimo de 30 L e o primeiro pedido sem mínimo também estão escritos nas regras da Puri e nas mensagens do site. O preço sugerido do copo (R$ 17 a R$ 22) e a conta de 20 copos por caixa de 10 L também estão no simulador de revenda. Mudar aqui não muda lá.', 'Revenda (atacado): pedido de atacado soma no mínimo 30 L, misturando caixas de 5 L e 10 L (ex.: 3 de 10 L ou 6 de 5 L). O primeiro pedido não tem mínimo. Não existe mínimo por produto no atacado: vale só a regra dos 30 L (granola e complementos não entram na conta). Os preços de atacado podem ser informados (estão no catálogo). Uma caixa de 10 L rende cerca de 20 copos de 500 ml; preço sugerido de venda do copo de 500 ml (para quem revende): R$ 17 a R$ 22.', 'Revenda (atacado): pedido de atacado soma no mínimo 30 L, misturando caixas de 5 L e 10 L (ex.: 3 de 10 L ou 6 de 5 L). O primeiro pedido não tem mínimo. Não existe mínimo por produto no atacado: vale só a regra dos 30 L (granola e complementos não entram na conta). Os preços de atacado podem ser informados (estão no catálogo). Uma caixa de 10 L rende cerca de 20 copos de 500 ml; preço sugerido de venda do copo de 500 ml (para quem revende): R$ 17 a R$ 22.'),
  ('cadastro_painel', 'Cadastro de revendedor', 9, false, null, 'Cadastro: o consumidor pode comprar na fábrica sem cadastro; só o revendedor precisa de cadastro. Cadastro de revendedor: cria conta com nome, negócio, telefone, e-mail, cidade e senha. A conta fica pendente até a equipe aprovar; só depois o painel libera. O pedido do revendedor vale na hora, sem confirmação do admin.
Painel do revendedor: acompanhar pedidos, histórico, status de entrega e cupons. A tabela completa de preços de atacado também aparece no painel depois do cadastro aprovado.', 'Cadastro: o consumidor pode comprar na fábrica sem cadastro; só o revendedor precisa de cadastro. Cadastro de revendedor: cria conta com nome, negócio, telefone, e-mail, cidade e senha. A conta fica pendente até a equipe aprovar; só depois o painel libera. O pedido do revendedor vale na hora, sem confirmação do admin.
Painel do revendedor: acompanhar pedidos, histórico, status de entrega e cupons. A tabela completa de preços de atacado também aparece no painel depois do cadastro aprovado.'),
  ('pagamento', 'Formas de pagamento', 10, false, null, 'Pagamento: pelo site (Pix ou cartão de crédito; revendedor: crédito em até 3x) ou na entrega/retirada (Pix, dinheiro com troco, débito, crédito). Pagamento a prazo só para revendedor liberado pela equipe.
Retirada na fábrica: aceita Pix, dinheiro, débito e crédito.', 'Pagamento: pelo site (Pix ou cartão de crédito; revendedor: crédito em até 3x) ou na entrega/retirada (Pix, dinheiro com troco, débito, crédito). Pagamento a prazo só para revendedor liberado pela equipe.
Retirada na fábrica: aceita Pix, dinheiro, débito e crédito.'),
  ('entrega_delivery', 'Entrega e delivery', 11, false, 'Os turnos de entrega (manhã 8h às 12h, tarde 13h às 17h) também estão escritos nas respostas prontas e nos botões da Puri no site. Mudar aqui não muda lá.', 'Entrega: somente em Cuiabá e Várzea Grande, em turnos de manhã (8h às 12h) e tarde (13h às 17h); dias, taxa e mínimo estão no catálogo. Não existe hora exata de chegada: o pedido chega dentro do turno escolhido. Fora disso não entregamos; dá pra retirar na fábrica. A taxa é calculada pelo endereço e aparece antes de pagar. A taxa de entrega do revendedor é a mesma do delivery.
Os cremes de 1 L, 2 L e 5 L também saem no delivery. Delivery (consumidor): pagamento online por Pix ou crédito; na entrega por dinheiro com troco, Pix, débito ou crédito. O pedido online só entra na rota depois do pagamento confirmado. Dá pra acompanhar a entrega por um link com as etapas (saiu, a caminho, entregue). O CEP é obrigatório e o endereço é confirmado no mapa; se o endereço não for aceito, chamar a equipe no WhatsApp.', 'Entrega: somente em Cuiabá e Várzea Grande, em turnos de manhã (8h às 12h) e tarde (13h às 17h); dias, taxa e mínimo estão no catálogo. Não existe hora exata de chegada: o pedido chega dentro do turno escolhido. Fora disso não entregamos; dá pra retirar na fábrica. A taxa é calculada pelo endereço e aparece antes de pagar. A taxa de entrega do revendedor é a mesma do delivery.
Os cremes de 1 L, 2 L e 5 L também saem no delivery. Delivery (consumidor): pagamento online por Pix ou crédito; na entrega por dinheiro com troco, Pix, débito ou crédito. O pedido online só entra na rota depois do pagamento confirmado. Dá pra acompanhar a entrega por um link com as etapas (saiu, a caminho, entregue). O CEP é obrigatório e o endereço é confirmado no mapa; se o endereço não for aceito, chamar a equipe no WhatsApp.'),
  ('provar', 'Provar antes de comprar', 12, false, 'O horário da visita do vendedor (segunda a sexta, 8h às 17h) e o da fábrica também estão escritos nas respostas prontas da Puri no site.', 'Provar antes: opção 1, visitar a fábrica e provar (seg a sáb, 13h às 19h30). Opção 2, visita gratuita de um vendedor da equipe com amostras, só em Cuiabá e Várzea Grande, de segunda a sexta, das 8h às 17h.', 'Provar antes: opção 1, visitar a fábrica e provar (seg a sáb, 13h às 19h30). Opção 2, visita gratuita de um vendedor da equipe com amostras, só em Cuiabá e Várzea Grande, de segunda a sexta, das 8h às 17h.'),
  ('loja_fisica', 'Loja física (balcão)', 13, false, 'O WhatsApp da loja também está escrito nas regras da Puri. Mudar aqui não muda lá.', 'Loja física (balcão): copos de açaí (180 ml a 700 ml), marmitas e açaí por quilo são só da loja e não são vendidos pelo site. Na loja há self-service e também copo montado pela atendente. Para esses produtos, falar com a loja no WhatsApp (65) 9694-9542.', 'Loja física (balcão): copos de açaí (180 ml a 700 ml), marmitas e açaí por quilo são só da loja e não são vendidos pelo site. Na loja há self-service e também copo montado pela atendente. Para esses produtos, falar com a loja no WhatsApp (65) 9694-9542.'),
  ('festas', 'Festas e eventos', 14, false, null, 'Festas e eventos: atendemos, mas precisa combinar com a equipe.', 'Festas e eventos: atendemos, mas precisa combinar com a equipe.'),
  ('sem_acucar', 'Opção sem açúcar', 15, false, null, 'Sem açúcar: ainda não temos opção sem açúcar.', 'Sem açúcar: ainda não temos opção sem açúcar.'),
  ('o_que_vende', 'O que a Dupuro vende', 16, false, null, 'A Dupuro vende SOMENTE: açaí e cremes em caixas e potes, granola Tia Sônia 1 kg, complementos e os demais produtos que aparecem no CATÁLOGO AO VIVO (pelo site e para revenda); e só na loja física também copos, marmitas e açaí por quilo. Não vende lanches, salgados, pizza, refeições, bebidas alcoólicas nem outros produtos fora disso.', 'A Dupuro vende SOMENTE: açaí e cremes em caixas e potes, granola Tia Sônia 1 kg, complementos e os demais produtos que aparecem no CATÁLOGO AO VIVO (pelo site e para revenda); e só na loja física também copos, marmitas e açaí por quilo. Não vende lanches, salgados, pizza, refeições, bebidas alcoólicas nem outros produtos fora disso.')
on conflict (assunto) do nothing;
