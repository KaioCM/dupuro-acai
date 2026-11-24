-- 079: gravação atômica de anotacoes/jev_log/turns da Puri (reforma da Puri, Etapa 2).
-- Problema: a Edge lia o lead no início da requisição e gravava a cópia inteira de `anotacoes`/`jev_log`;
-- chamadas lentas em segundo plano (aprofundar/palpite) terminavam depois de outras e apagavam o que elas tinham gravado.
-- Solução: a Edge manda só o PATCH (chaves que a requisição mudou) e o banco mescla numa única instrução.
-- Mescla rasa em `anotacoes`, exceto a chave `qualif` (objeto de campos), que é mesclada campo a campo.
-- Só a service_role (Edge) executa; anon/authenticated não.
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
         turns = q.turns + (case when p_soma_turno then 1 else 0 end),
         atualizado_em = now()
   where q.id = p_id;
$$;

revoke all on function public.puri_merge_lead(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.puri_merge_lead(uuid, jsonb, jsonb, boolean) to service_role;
