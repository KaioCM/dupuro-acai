-- 080: puri_merge_lead igual à 079, mas com turns = coalesce(q.turns,0) + ... (evita null quando turns vier nulo).
create or replace function public.puri_merge_lead(p_id uuid, p_anot jsonb, p_log jsonb, p_soma_turno boolean)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.qualificacao_leads q
     set anotacoes = (
           (case when jsonb_typeof(q.anotacoes) = 'object' then q.anotacoes else '{}'::jsonb end)
           || (case when jsonb_typeof(p_anot) = 'object' then p_anot - 'qualif' else '{}'::jsonb end)
           || (case when jsonb_typeof(p_anot) = 'object' and jsonb_typeof(p_anot -> 'qualif') = 'object'
                    then jsonb_build_object('qualif',
                           (case when jsonb_typeof(q.anotacoes -> 'qualif') = 'object' then q.anotacoes -> 'qualif' else '{}'::jsonb end)
                           || (p_anot -> 'qualif'))
                    else '{}'::jsonb end)
         ),
         jev_log = coalesce((
           select jsonb_agg(s.e order by s.o)
             from (
               select t.e, t.o
                 from jsonb_array_elements(
                        (case when jsonb_typeof(q.jev_log) = 'array' then q.jev_log else '[]'::jsonb end)
                        || (case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end)
                      ) with ordinality as t(e, o)
                order by t.o desc
                limit 60
             ) s
         ), '[]'::jsonb),
         turns = coalesce(q.turns, 0) + (case when p_soma_turno then 1 else 0 end),
         atualizado_em = now()
   where q.id = p_id;
$$;

revoke all on function public.puri_merge_lead(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.puri_merge_lead(uuid, jsonb, jsonb, boolean) to service_role;
