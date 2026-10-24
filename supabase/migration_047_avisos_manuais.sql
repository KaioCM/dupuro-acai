-- migration_047 — Avisos ao cliente pelo WhatsApp do próprio admin (2026-10-23)
--
-- A Meta travou a Cloud API (migration_046 fica guardada, desligada). No lugar,
-- o admin avisa à mão: cada mudança que o cliente precisa saber vira uma linha
-- "falta avisar"; o botão abre o WhatsApp com a mensagem pronta e marca avisado.
--
-- Eventos: cadastro aprovado/rejeitado; pedido do revendedor confirmado,
-- entregue, recusado (cancelado vindo de "enviado") ou cancelado; delivery saiu
-- pra entrega, entregue ou cancelado. Quando o status muda de novo ("Desfazer"),
-- o aviso que ainda não foi dado e deixou de valer some sozinho.

-- Automático da Meta: guardado e desligado (decisão do Kayo).
update public.whatsapp_config set ativo = false where id = 1;

create table if not exists public.avisos_cliente (
  id bigint generated always as identity primary key,
  ref text not null unique,              -- origem:ref:evento (não duplica)
  origem_tipo text not null check (origem_tipo in ('cadastro', 'pedido', 'delivery')),
  origem_ref text not null,              -- id do perfil, PED-XXXX ou DLV-XXXX
  evento text not null,                  -- aprovado, rejeitado, processando, entregue, recusado, cancelado, em_rota
  nome text,                             -- foto do contato na hora do evento
  telefone text,
  dados jsonb,
  criado_em timestamptz not null default now(),
  avisado_em timestamptz,
  dispensado_em timestamptz
);
create index if not exists avisos_cliente_pendentes on public.avisos_cliente (criado_em) where avisado_em is null and dispensado_em is null;
alter table public.avisos_cliente enable row level security;
create policy avisos_cliente_admin on public.avisos_cliente for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Registra (ou reabre) o aviso e apaga os pendentes da mesma origem que não valem mais.
create or replace function public.aviso_registrar(p_tipo text, p_ref text, p_evento text, p_nome text, p_tel text, p_dados jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.avisos_cliente
   where origem_tipo = p_tipo and origem_ref = p_ref and evento is distinct from p_evento
     and avisado_em is null and dispensado_em is null;
  if p_evento is null then return; end if;
  insert into public.avisos_cliente (ref, origem_tipo, origem_ref, evento, nome, telefone, dados)
  values (p_tipo || ':' || p_ref || ':' || p_evento, p_tipo, p_ref, p_evento, p_nome, p_tel, p_dados)
  on conflict (ref) do update set criado_em = now(), avisado_em = null, dispensado_em = null,
    nome = excluded.nome, telefone = excluded.telefone, dados = excluded.dados;
end $$;

create or replace function public.aviso_profiles_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status or new.role <> 'revendedor' or coalesce(new.conta_teste, false) then return new; end if;
  perform public.aviso_registrar('cadastro', new.id::text,
    case when new.status in ('aprovado', 'rejeitado') then new.status end,
    new.nome, new.telefone, jsonb_build_object('empresa', new.empresa, 'email', new.email));
  return new;
end $$;
create trigger aviso_profiles_evento after update of status on public.profiles
  for each row execute function public.aviso_profiles_evento();

-- Pedido = várias linhas com o mesmo número: trigger por statement, um aviso por pedido.
create or replace function public.aviso_orders_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare g record;
begin
  for g in
    select n.numero, (array_agg(n.status))[1] novo, (array_agg(o.status))[1] antigo, (array_agg(n.revendedor_id))[1] rid
      from novas n join antigas o on o.id = n.id
     where n.status is distinct from o.status and n.origem is distinct from 'loja' and n.revendedor_id is not null
     group by n.numero
  loop
    perform public.aviso_registrar('pedido', g.numero,
      case when g.novo = 'cancelado' and g.antigo = 'enviado' then 'recusado'
           when g.novo in ('processando', 'entregue', 'cancelado') then g.novo end,
      p.nome, p.telefone, jsonb_build_object('empresa', p.empresa))
      from public.profiles p where p.id = g.rid;
  end loop;
  return null;
end $$;
create trigger aviso_orders_evento after update on public.orders
  referencing old table as antigas new table as novas
  for each statement execute function public.aviso_orders_evento();

create or replace function public.aviso_delivery_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  perform public.aviso_registrar('delivery', new.codigo,
    case when new.status in ('em_rota', 'entregue') then new.status
         when new.status = 'cancelado' and old.status in ('pago', 'em_rota') then 'cancelado' end,
    new.cliente_nome, new.cliente_telefone, null);
  return new;
end $$;
create trigger aviso_delivery_evento after update of status on public.delivery_pedidos
  for each row execute function public.aviso_delivery_evento();

revoke execute on function public.aviso_registrar(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.aviso_profiles_evento() from public, anon, authenticated;
revoke execute on function public.aviso_orders_evento() from public, anon, authenticated;
revoke execute on function public.aviso_delivery_evento() from public, anon, authenticated;
