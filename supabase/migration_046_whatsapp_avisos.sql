-- migration_046: avisos automáticos no WhatsApp (WhatsApp Business Cloud API).
--
-- Decisões do Kayo (2026-10-22):
--   * avisos: cadastro de revendedor aprovado; pedido do revendedor (recebido,
--     confirmado, entregue/retirado); delivery (pago, saiu, entregue); e aviso
--     interno de cadastro novo / pedido novo / delivery pago pro número PESSOAL do
--     Kayo (não pra Dilene) — guardado em whatsapp_config, só admin lê;
--   * aceite: caixinha no cadastro (marcada) e no checkout do delivery; os
--     revendedores atuais contam como aceitos e podem desligar no Perfil;
--   * começa com o número de teste da Meta; trocar o número é só mudar o secret.
--
-- Como funciona: cada evento vira uma linha em whatsapp_envios (ref única = não
-- duplica). O pg_cron chama a Edge Function whatsapp-enviar a cada minuto SÓ se
-- houver pendência; ela reivindica o lote (SKIP LOCKED), descarta aviso que ficou
-- velho (ex.: admin clicou "Desfazer") e manda o modelo aprovado pela Meta.
-- Avisos de pedido esperam 60 s antes de sair, exatamente pro "Desfazer" valer.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------- aceite ----------
alter table public.profiles add column if not exists aceita_whatsapp boolean not null default true;
alter table public.delivery_pedidos add column if not exists aceita_whatsapp boolean not null default true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
$$;

-- ---------- configuração (só admin) ----------
create table if not exists public.whatsapp_config (
  id int primary key default 1 check (id = 1),
  aviso_interno text check (aviso_interno is null or aviso_interno ~ '^[0-9]{12,13}$'),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.whatsapp_config enable row level security;
drop policy if exists whatsapp_config_admin on public.whatsapp_config;
create policy whatsapp_config_admin on public.whatsapp_config for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
insert into public.whatsapp_config (id, aviso_interno) values (1, '5565999299545') on conflict (id) do nothing;

-- ---------- fila ----------
create table if not exists public.whatsapp_envios (
  id bigint generated always as identity primary key,
  ref text not null unique,              -- evento: 'pedido_confirmado:PED-1035' (não repete)
  modelo text not null,                  -- nome do modelo aprovado na Meta
  destino text not null check (destino ~ '^[0-9]{12,13}$'),
  variaveis jsonb not null default '[]',
  botao text,                            -- sufixo do botão de link (token do rastreio)
  origem_tipo text not null check (origem_tipo in ('pedido', 'delivery', 'cadastro', 'interno', 'teste')),
  origem_ref text,                       -- numero / codigo / id do perfil
  evento_status text,                    -- status que gerou o aviso (confere antes de mandar)
  enviar_apos timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviado', 'erro', 'ignorado')),
  tentativas int not null default 0,
  pego_em timestamptz,                   -- quando a Edge Function reivindicou
  erro text,
  resposta jsonb,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);
create index if not exists whatsapp_envios_pendentes on public.whatsapp_envios (enviar_apos) where status = 'pendente';
alter table public.whatsapp_envios enable row level security;
drop policy if exists whatsapp_envios_admin_le on public.whatsapp_envios;
create policy whatsapp_envios_admin_le on public.whatsapp_envios for select to authenticated using ((select public.is_admin()));

-- Telefone em formato internacional (só dígitos, com 55). Null se não der.
create or replace function public.wa_telefone(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when d ~ '^55[0-9]{10,11}$' then d
    when d ~ '^[0-9]{10,11}$' then '55' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x;
$$;

create or replace function public.wa_brl(v numeric)
returns text
language sql
immutable
as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999,999,990.00'), ',', 'X'), '.', ','), 'X', '.');
$$;

-- "sex 23/10, de manhã (8h às 12h)"
create or replace function public.wa_quando(p_data date, p_turno text)
returns text
language sql
immutable
as $$
  select nullif(concat_ws(', ',
    case when p_data is not null then (array['dom','seg','ter','qua','qui','sex','sáb'])[extract(dow from p_data)::int + 1] || ' ' || to_char(p_data, 'DD/MM') end,
    case p_turno when 'manha' then 'de manhã (8h às 12h)' when 'tarde' then 'à tarde (13h às 17h)' end), '');
$$;

-- Põe um aviso na fila (ignora se o evento já foi enfileirado).
create or replace function public.wa_enfileirar(p_ref text, p_modelo text, p_destino text, p_vars jsonb,
  p_origem_tipo text, p_origem_ref text, p_evento text, p_atraso interval default interval '0', p_botao text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_destino is null then return; end if;
  if not coalesce((select ativo from public.whatsapp_config where id = 1), false) then return; end if;
  insert into public.whatsapp_envios (ref, modelo, destino, variaveis, botao, origem_tipo, origem_ref, evento_status, enviar_apos)
  values (p_ref, p_modelo, p_destino, p_vars, p_botao, p_origem_tipo, p_origem_ref, p_evento, now() + p_atraso)
  on conflict (ref) do nothing;
end;
$$;

create or replace function public.wa_aviso_interno(p_ref text, p_titulo text, p_detalhe text, p_origem_tipo text, p_origem_ref text, p_evento text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.wa_enfileirar('interno:' || p_ref, 'dupuro_aviso_interno',
    (select aviso_interno from public.whatsapp_config where id = 1),
    jsonb_build_array(p_titulo, left(p_detalhe, 300)), p_origem_tipo, p_origem_ref, p_evento);
end;
$$;

-- ---------- cadastro ----------
create or replace function public.wa_profiles_evento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.role, 'revendedor') = 'revendedor' and not coalesce(new.conta_teste, false) then
      perform public.wa_aviso_interno('cadastro:' || new.id, 'Novo cadastro de revendedor',
        coalesce(nullif(new.empresa, ''), new.nome, 'sem nome') || coalesce(' (' || nullif(new.cidade, '') || ')', '') || ' esperando aprovação',
        'cadastro', new.id::text, 'pendente');
    end if;
  elsif new.status = 'aprovado' and old.status is distinct from 'aprovado' and new.role = 'revendedor' and new.aceita_whatsapp then
    perform public.wa_enfileirar('cadastro_aprovado:' || new.id, 'dupuro_cadastro_aprovado', public.wa_telefone(new.telefone),
      jsonb_build_array(initcap(split_part(trim(coalesce(new.nome, '')), ' ', 1))), 'cadastro', new.id::text, 'aprovado', interval '60 seconds');
  end if;
  return new;
end;
$$;
drop trigger if exists wa_profiles_evento on public.profiles;
create trigger wa_profiles_evento after insert or update of status on public.profiles
  for each row execute function public.wa_profiles_evento();

-- ---------- pedido do revendedor (1 aviso por pedido, não por linha) ----------
create or replace function public.wa_pedido_evento(p_numero text, p_status text, p_rid uuid, p_total numeric, p_info jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
        when v_quando is null then 'A gente combina com você o dia da entrega'
        when v_retira then 'Retirada na fábrica (Av. das Torres, 16) ' || v_quando
        else 'Entrega ' || v_quando end), 'pedido', p_numero, 'processando', interval '60 seconds');
  elsif p_status = 'entregue' then
    perform public.wa_enfileirar('pedido_concluido:' || p_numero, 'dupuro_pedido_concluido', v_tel,
      jsonb_build_array(p_numero, case when v_retira then 'retirado na fábrica' else 'entregue' end), 'pedido', p_numero, 'entregue', interval '60 seconds');
  end if;
end;
$$;

create or replace function public.wa_orders_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare g record;
begin
  for g in
    select numero, (array_agg(revendedor_id))[1] rid, sum(valor) total, (array_agg(entrega_info))[1] info
      from novas where origem = 'revendedor' and status = 'enviado' and revendedor_id is not null
     group by numero
  loop
    perform public.wa_pedido_evento(g.numero, 'enviado', g.rid, g.total, g.info);
  end loop;
  return null;
end;
$$;
drop trigger if exists wa_orders_insert on public.orders;
create trigger wa_orders_insert after insert on public.orders
  referencing new table as novas for each statement execute function public.wa_orders_insert();

create or replace function public.wa_orders_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
$$;
drop trigger if exists wa_orders_update on public.orders;
create trigger wa_orders_update after update on public.orders
  referencing old table as antes new table as depois for each statement execute function public.wa_orders_update();

-- ---------- delivery ----------
create or replace function public.wa_delivery_evento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tel text := case when new.aceita_whatsapp then public.wa_telefone(new.cliente_telefone) end;
  v_quando text := public.wa_quando(new.data_entrega, new.periodo);
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'pago' then
    perform public.wa_enfileirar('delivery_pago:' || new.codigo, 'dupuro_delivery_pago', v_tel,
      jsonb_build_array(initcap(split_part(trim(new.cliente_nome), ' ', 1)), new.codigo, coalesce(v_quando, 'no horário combinado')),
      'delivery', new.codigo, 'pago', interval '0', new.token::text);
    perform public.wa_aviso_interno('delivery:' || new.codigo, 'Delivery pago',
      new.codigo || ' de ' || new.cliente_nome || ', ' || public.wa_brl(new.total) || coalesce(', entrega ' || v_quando, ''),
      'delivery', new.codigo, 'pago');
  elsif new.status = 'em_rota' then
    perform public.wa_enfileirar('delivery_saiu:' || new.codigo, 'dupuro_delivery_saiu', v_tel,
      jsonb_build_array(new.codigo), 'delivery', new.codigo, 'em_rota', interval '60 seconds', new.token::text);
  elsif new.status = 'entregue' then
    perform public.wa_enfileirar('delivery_entregue:' || new.codigo, 'dupuro_delivery_entregue', v_tel,
      jsonb_build_array(new.codigo), 'delivery', new.codigo, 'entregue', interval '60 seconds');
  end if;
  return new;
end;
$$;
drop trigger if exists wa_delivery_evento on public.delivery_pedidos;
create trigger wa_delivery_evento after update of status on public.delivery_pedidos
  for each row execute function public.wa_delivery_evento();

-- ---------- lote pra Edge Function (só service_role) ----------
-- Descarta o que ficou velho (status mudou de novo, ex.: "Desfazer"), reivindica
-- até p_limite pendentes sem bloquear outra execução e devolve pra envio.
create or replace function public.wa_pegar_lote(p_limite int default 20)
returns setof public.whatsapp_envios
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.whatsapp_envios e set status = 'ignorado', erro = 'evento mudou antes do envio'
   where e.status = 'pendente' and e.enviar_apos <= now() and e.evento_status is not null and (
     (e.origem_tipo = 'pedido' and e.evento_status <> 'enviado' and coalesce((select o.status from public.orders o where o.numero = e.origem_ref limit 1), '') <> e.evento_status)
     or (e.origem_tipo = 'delivery' and coalesce((select d.status from public.delivery_pedidos d where d.codigo = e.origem_ref), '') <> e.evento_status)
     or (e.origem_tipo = 'cadastro' and e.evento_status = 'aprovado' and coalesce((select p.status from public.profiles p where p.id::text = e.origem_ref), '') <> 'aprovado'));
  -- "enviando" preso há mais de 10 min (função caiu no meio) volta pra fila
  update public.whatsapp_envios set status = 'pendente'
   where status = 'enviando' and pego_em < now() - interval '10 minutes' and tentativas < 5;
  return query
  update public.whatsapp_envios e set status = 'enviando', tentativas = e.tentativas + 1, pego_em = now()
   where e.id in (select id from public.whatsapp_envios
                   where status = 'pendente' and enviar_apos <= now()
                   order by id limit p_limite for update skip locked)
  returning e.*;
end;
$$;

create or replace function public.wa_marcar(p_id bigint, p_ok boolean, p_resposta jsonb, p_erro text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.whatsapp_envios set
    status = case when p_ok then 'enviado' when tentativas >= 5 then 'erro' else 'pendente' end,
    enviado_em = case when p_ok then now() end,
    enviar_apos = case when p_ok then enviar_apos else now() + interval '2 minutes' end,
    resposta = p_resposta, erro = p_erro
  where id = p_id;
$$;

-- Funções internas: ninguém de fora executa (triggers rodam como dono; a Edge
-- Function usa service_role).
revoke execute on function public.wa_enfileirar(text, text, text, jsonb, text, text, text, interval, text) from public, anon, authenticated;
revoke execute on function public.wa_aviso_interno(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.wa_pedido_evento(text, text, uuid, numeric, jsonb) from public, anon, authenticated;
revoke execute on function public.wa_profiles_evento() from public, anon, authenticated;
revoke execute on function public.wa_orders_insert() from public, anon, authenticated;
revoke execute on function public.wa_orders_update() from public, anon, authenticated;
revoke execute on function public.wa_delivery_evento() from public, anon, authenticated;
revoke execute on function public.wa_pegar_lote(int) from public, anon, authenticated;
revoke execute on function public.wa_marcar(bigint, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.wa_pegar_lote(int) to service_role;
grant execute on function public.wa_marcar(bigint, boolean, jsonb, text) to service_role;

-- ---------- a cada minuto, só se tiver pendência ----------
select cron.unschedule('whatsapp-enviar') where exists (select 1 from cron.job where jobname = 'whatsapp-enviar');
select cron.schedule('whatsapp-enviar', '* * * * *', $cron$
  select net.http_post(
    url := 'https://zqadfktfplrbrjmepllh.supabase.co/functions/v1/whatsapp-enviar',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000)
  where exists (select 1 from public.whatsapp_envios where status = 'pendente' and enviar_apos <= now());
$cron$);
