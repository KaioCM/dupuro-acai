// Dupuro Açaí — Edge Function: guardar cópia do XML das NFC-e (migration_058)
// ==========================================================================
// O Focus NFe guarda os arquivos, mas não promete prazo, e a lei pede o XML por
// 5 anos. Esta função copia o XML de cada nota (e o do cancelamento, se houver)
// para o bucket PRIVADO 'nfce' do Storage e grava o caminho em nfce_emissoes.
// De quebra, preenche o qrcode (link da consulta SEFAZ) a partir do XML quando
// a emissão antiga não tinha guardado.
//
// Chamada pelo admin ao abrir "Notas fiscais" (copia só o que falta, em lote).
// Não mexe na emissão nem no cancelamento: o caixa segue igual.
// Só admin. FOCUS_TOKEN (secret) vai no pedido do arquivo se existir.
// ==========================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const LOTE = 20

function focusBase(ambiente: string) {
  return ambiente === 'producao'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br'
}

function abs(base: string, caminho: unknown) {
  if (!caminho || typeof caminho !== 'string') return null
  return caminho.startsWith('http') ? caminho : base + caminho
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
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

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'Sessão inválida' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: perfil } = await admin
      .from('profiles').select('role').eq('id', userData.user.id).single()
    if (!perfil || perfil.role !== 'admin') return json({ error: 'Só o admin' }, 403)

    // Baixa um XML do Focus; só aceita se for mesmo o XML daquela chave.
    async function baixar(url: string, chave: string) {
      const headers: Record<string, string> = {}
      if (focusToken) headers['Authorization'] = 'Basic ' + btoa(focusToken + ':')
      const r = await fetch(url, { headers })
      if (!r.ok) throw new Error('Focus respondeu ' + r.status)
      const txt = await r.text()
      if (!txt.trim().startsWith('<') || !txt.includes(chave)) {
        throw new Error('arquivo não é o XML desta nota')
      }
      return txt
    }
    async function guardar(caminho: string, xml: string) {
      const { error } = await admin.storage.from('nfce').upload(
        caminho, new Blob([xml], { type: 'text/xml' }),
        { contentType: 'text/xml', upsert: true },
      )
      if (error) throw new Error('Storage: ' + error.message)
    }

    // Pendentes: nota sem cópia, ou cancelada sem a cópia do cancelamento
    // (só as que têm de onde copiar, pra uma nota sem arquivo não travar o lote).
    const { data: candidatas, error: selErr } = await admin
      .from('nfce_emissoes')
      .select('id, ambiente, status, chave, url_xml, qrcode, criado_em, cancelamento, xml_path, xml_canc_path')
      .in('status', ['autorizado', 'cancelado'])
      .or('xml_path.is.null,and(status.eq.cancelado,xml_canc_path.is.null)')
      .order('id', { ascending: false })
    if (selErr) return json({ error: selErr.message }, 500)
    const lista = (candidatas || []).filter((em) =>
      (!em.xml_path && em.url_xml) ||
      (em.status === 'cancelado' && !em.xml_canc_path &&
        (em.cancelamento as Record<string, unknown> | null)?.caminho_xml_cancelamento)
    ).slice(0, LOTE)

    let copiadas = 0
    const falhas: { id: number; motivo: string }[] = []

    for (const em of lista) {
      // A chave vem como 'NFe' + 44 dígitos; o XML do cancelamento só tem os dígitos.
      const chave = String(em.chave || '').replace(/\D/g, '')
      if (chave.length !== 44) { falhas.push({ id: em.id, motivo: 'sem chave' }); continue }
      const pasta = em.ambiente + '/' + String(em.criado_em).slice(0, 7).replace('-', '') + '/'
      const upd: Record<string, unknown> = {}
      try {
        if (!em.xml_path && em.url_xml) {
          const xml = await baixar(em.url_xml, chave)
          const caminho = pasta + chave + '-nfe.xml'
          await guardar(caminho, xml)
          upd.xml_path = caminho
          if (!em.qrcode) {
            const m = xml.match(/<qrCode>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/qrCode>/)
            if (m) upd.qrcode = m[1].replace(/&amp;/g, '&')
          }
        }
        const canc = em.cancelamento as Record<string, unknown> | null
        const urlCanc = canc ? abs(focusBase(em.ambiente), canc.caminho_xml_cancelamento) : null
        if (em.status === 'cancelado' && !em.xml_canc_path && urlCanc) {
          const xmlC = await baixar(urlCanc, chave)
          const caminhoC = pasta + chave + '-can.xml'
          await guardar(caminhoC, xmlC)
          upd.xml_canc_path = caminhoC
        }
      } catch (e) {
        falhas.push({ id: em.id, motivo: String((e as Error).message || e) })
      }
      if (Object.keys(upd).length) {
        upd.arquivado_em = new Date().toISOString()
        const { error: upErr } = await admin.from('nfce_emissoes').update(upd).eq('id', em.id)
        if (upErr) falhas.push({ id: em.id, motivo: upErr.message })
        else copiadas++
      }
    }

    return json({ copiadas, falhas, conferidas: lista.length })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
