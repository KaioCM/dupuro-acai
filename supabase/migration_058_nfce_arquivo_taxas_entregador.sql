-- migration_058 — Notas fiscais guardadas + taxa do entregador (2026-11-10)
-- 1) Cópia do XML de cada NFC-e no Storage (bucket privado 'nfce', só admin lê).
--    Quem grava é a Edge Function nfce-arquivo (service role). O Focus não promete
--    prazo de guarda e a lei pede o XML por 5 anos.
-- 2) admin_taxas_entrega(): uma linha por entrega ENTREGUE com taxa (delivery,
--    revenda e venda de loja), com o dia da entrega. O admin soma por mês.
--    Decisão do Kayo: só entregue; tudo é do mesmo entregador; mês da entrega.

alter table public.nfce_emissoes
  add column if not exists xml_path text,
  add column if not exists xml_canc_path text,
  add column if not exists arquivado_em timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nfce', 'nfce', false, 1048576, array['text/xml', 'application/xml'])
on conflict (id) do update set public = false;

drop policy if exists nfce_admin_le on storage.objects;
create policy nfce_admin_le on storage.objects
  for select to authenticated
  using (bucket_id = 'nfce' and public.is_admin());

create or replace function public.admin_taxas_entrega()
returns table (fonte text, ref text, dia date, cliente text, taxa numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Só o admin vê as taxas do entregador.';
  end if;

  return query
  select 'delivery'::text, d.codigo,
         coalesce((d.entregue_em at time zone 'America/Cuiaba')::date, d.data_entrega,
                  (d.criado_em at time zone 'America/Cuiaba')::date),
         d.cliente_nome, d.taxa
    from delivery_pedidos d
   where d.status = 'entregue' and coalesce(d.taxa, 0) > 0
  union all
  select case when o.origem = 'loja' then 'loja' else 'revenda' end, o.numero,
         case when o.origem <> 'loja' and (o.entrega_info->>'data') ~ '^\d{4}-\d{2}-\d{2}$'
              then (o.entrega_info->>'data')::date else o.data end,
         case when o.origem = 'loja' then o.entrega_info->>'nome'
              else coalesce(nullif(p.empresa, ''), p.nome) end,
         sum(o.valor)
    from orders o
    left join profiles p on p.id = o.revendedor_id
   where o.produto_id is null and o.itens ilike 'Taxa de entrega%'
     and o.status = 'entregue' and o.valor > 0
   group by o.origem, o.numero, o.entrega_info, o.data, p.empresa, p.nome;
end;
$$;

revoke all on function public.admin_taxas_entrega() from public, anon;
grant execute on function public.admin_taxas_entrega() to authenticated;
