-- Resumo da sessão SEM fechar (mostra os totais enquanto a atendente conta o
-- dinheiro, antes de confirmar). Aplicada via MCP; espelho.
create or replace function public.resumo_caixa(p_sessao_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_fundo numeric; v_total numeric; v_dinheiro numeric; v_qtd int; v_por_forma jsonb;
begin
  if not (public.is_atendente() or public.is_admin()) then raise exception 'Sem permissão.'; end if;
  select fundo_troco into v_fundo from public.caixa_sessoes where id = p_sessao_id;
  select coalesce(sum(valor), 0),
         coalesce(sum(valor) filter (where forma_pagamento = 'dinheiro'), 0),
         count(distinct numero)
    into v_total, v_dinheiro, v_qtd
    from public.orders where caixa_sessao_id = p_sessao_id and status <> 'cancelado';
  select coalesce(jsonb_object_agg(forma, s), '{}'::jsonb) into v_por_forma from (
    select coalesce(forma_pagamento, 'sem') as forma, sum(valor) as s
      from public.orders where caixa_sessao_id = p_sessao_id and status <> 'cancelado'
      group by coalesce(forma_pagamento, 'sem')
  ) t;
  return jsonb_build_object(
    'total', v_total, 'qtd', v_qtd, 'por_forma', v_por_forma,
    'fundo_troco', coalesce(v_fundo, 0), 'dinheiro_esperado', coalesce(v_fundo, 0) + v_dinheiro
  );
end;
$$;
grant execute on function public.resumo_caixa(bigint) to authenticated;
