// Dupuro Açaí — Edge Function: cancelar NFC-e (cupom fiscal) via Focus NFe
// ==========================================================================
// Cancela o cupom fiscal de uma venda (VND-XXXX) no SEFAZ, via o gateway Focus.
// Prazo legal em MT: 30 minutos após a autorização; passou disso o SEFAZ
// recusa (aí só cancelamento extemporâneo pelo portal, com o contador).
//
// Recebe { numero, justificativa } (justificativa 15–255 chars, exigência do
// SEFAZ). Acha a emissão AUTORIZADA da venda, chama DELETE /v2/nfce/{ref} no
// Focus e, se cancelar, marca a emissão como 'cancelado'. Só atendente/admin.
// Token do Focus é secret do servidor (FOCUS_TOKEN) — nunca no cliente.
// ==========================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

function focusBase(ambiente: string) {
  return ambiente === 'producao'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br'
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Sem sessão' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const focusToken = Deno.env.get('FOCUS_TOKEN')
    const ambiente = (Deno.env.get('FOCUS_AMBIENTE') || 'homologacao').toLowerCase()

    if (!focusToken) return json({ error: 'FOCUS_TOKEN não configurado na função' }, 500)

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'Sessão inválida' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: perfil } = await admin
      .from('profiles').select('role').eq('id', userData.user.id).single()
    if (!perfil || (perfil.role !== 'atendente' && perfil.role !== 'admin')) {
      return json({ error: 'Apenas caixa/admin podem cancelar NFC-e' }, 403)
    }

    const { numero, justificativa } = await req.json()
    if (!numero) return json({ error: 'numero (VND-XXXX) é obrigatório' }, 400)
    const just = String(justificativa || '').trim()
    if (just.length < 15 || just.length > 255) {
      return json({ error: 'Justificativa deve ter entre 15 e 255 caracteres.' }, 400)
    }

    // Acha a emissão autorizada dessa venda no ambiente atual.
    const { data: emissoes } = await admin
      .from('nfce_emissoes').select('*')
      .eq('venda_numero', numero).eq('ambiente', ambiente).eq('status', 'autorizado')
      .order('id', { ascending: false }).limit(1)
    const em = (emissoes || [])[0]
    if (!em) return json({ error: 'Esta venda não tem NFC-e autorizada para cancelar.' }, 404)

    const base = focusBase(ambiente)
    const resp = await fetch(base + '/v2/nfce/' + encodeURIComponent(em.ref), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(focusToken + ':'),
      },
      body: JSON.stringify({ justificativa: just }),
    })
    const retorno = await resp.json().catch(() => ({}))

    if (String(retorno.status || '') !== 'cancelado') {
      // Não cancelou (ex.: passou dos 30 min). Devolve a mensagem do SEFAZ.
      return json({
        cancelado: false,
        mensagem: retorno.mensagem_sefaz || retorno.mensagem || retorno.erros || 'Não foi possível cancelar no SEFAZ.',
        status_sefaz: retorno.status_sefaz ?? null,
        retorno,
      }, 200)
    }

    const { data: salvo } = await admin
      .from('nfce_emissoes')
      .update({
        status: 'cancelado',
        cancelamento: retorno,
        cancelado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', em.id).select().single()

    return json({ cancelado: true, emissao: salvo || null, retorno })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
