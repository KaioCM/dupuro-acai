// Dupuro — Edge Function: avisos no WhatsApp (WhatsApp Business Cloud API)
// ==========================================================================
// Chamada sem login pelo pg_cron (a cada minuto, só quando há pendência): pega o
// lote da fila whatsapp_envios (wa_pegar_lote, SKIP LOCKED) e manda cada aviso
// como MODELO aprovado pela Meta. Quem chama de fora só consegue disparar o que já
// está na fila — nada vem do corpo da requisição.
//
// Ações de admin (precisam do login do admin no header Authorization):
//   { acao: 'status' }        → configurado? (sem mostrar segredo)
//   { acao: 'criar_modelos' } → cria os 8 modelos na conta do WhatsApp (WABA)
//   { acao: 'modelos' }       → situação de cada modelo (aprovado/pendente/rejeitado)
//   { acao: 'teste' }         → manda o "hello_world" da Meta pro número de aviso interno
//
// Secrets: WA_TOKEN (token da Meta), WA_PHONE_ID (identificação do número),
//          WA_WABA_ID (conta do WhatsApp Business), opcional WA_API_VERSION.
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const RODAPE = 'Dúvidas? (65) 99288-8228'
const RASTREIO = 'https://www.dupuroacai.com/delivery/acompanhar.html?t='

// Os modelos (texto aprovado pela Meta). Variáveis {{n}} nunca no começo/fim do texto.
const MODELOS: any[] = [
  { name: 'dupuro_cadastro_aprovado', body: 'Olá, {{1}}! Seu cadastro de revendedor na Dupuro Açaí foi aprovado. Já dá pra fazer pedidos pelo painel, com os preços de revenda.',
    ex: ['Maria'], botao: { text: 'Abrir o painel', url: 'https://www.dupuroacai.com/area-cliente/login.html' } },
  { name: 'dupuro_pedido_recebido', body: 'Recebemos o seu pedido {{1}}, no valor de {{2}}. Agora a Dupuro confere o estoque e você recebe outra mensagem quando ele for confirmado.',
    ex: ['PED-1035', 'R$ 337,00'] },
  { name: 'dupuro_pedido_confirmado', body: 'Seu pedido {{1}} foi confirmado! {{2}}. Qualquer mudança, a gente avisa por aqui.',
    ex: ['PED-1035', 'Entrega sex 23/10, de manhã (8h às 12h)'] },
  { name: 'dupuro_pedido_concluido', body: 'Seu pedido {{1}} foi {{2}}. Obrigado pela parceria com a Dupuro Açaí!',
    ex: ['PED-1035', 'entregue'] },
  { name: 'dupuro_delivery_pago', body: 'Oi, {{1}}! Recebemos o pagamento do pedido {{2}}. A entrega fica para {{3}}. Acompanhe pelo botão abaixo.',
    ex: ['Maria', 'DLV-0001', 'sex 23/10, à tarde (13h às 17h)'], botao: { text: 'Acompanhar pedido', url: RASTREIO + '{{1}}', ex: RASTREIO + 'exemplo' } },
  { name: 'dupuro_delivery_saiu', body: 'Seu pedido {{1}} saiu para entrega e logo chega aí. Acompanhe pelo botão abaixo.',
    ex: ['DLV-0001'], botao: { text: 'Acompanhar pedido', url: RASTREIO + '{{1}}', ex: RASTREIO + 'exemplo' } },
  { name: 'dupuro_delivery_entregue', body: 'Pedido {{1}} entregue. Bom açaí e obrigado por pedir na Dupuro!',
    ex: ['DLV-0001'] },
  { name: 'dupuro_aviso_interno', body: 'Aviso do sistema Dupuro Açaí. {{1}}: {{2}}. Abra o painel admin pra conferir.',
    ex: ['Novo pedido de revenda', 'PED-1035 de Açaí Cuiabano, R$ 337,00'], interno: true,
    botao: { text: 'Abrir o admin', url: 'https://www.dupuroacai.com/area-cliente/admin.html' } },
]

function graph(path: string) {
  return `https://graph.facebook.com/${Deno.env.get('WA_API_VERSION') || 'v23.0'}/${path}`
}
async function chamar(path: string, body?: unknown) {
  const r = await fetch(graph(path), {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + Deno.env.get('WA_TOKEN'), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const dados = await r.json().catch(() => ({}))
  return { ok: r.ok, dados }
}

function componentesModelo(m: any) {
  const c: any[] = [{ type: 'BODY', text: m.body, example: { body_text: [m.ex] } }]
  if (!m.interno) c.push({ type: 'FOOTER', text: RODAPE })
  if (m.botao) {
    const b: any = { type: 'URL', text: m.botao.text, url: m.botao.url }
    if (m.botao.ex) b.example = [m.botao.ex]
    c.push({ type: 'BUTTONS', buttons: [b] })
  }
  return c
}

async function enviarLinha(e: any) {
  const comps: any[] = [{ type: 'body', parameters: (e.variaveis || []).map((t: string) => ({ type: 'text', text: String(t).slice(0, 900) })) }]
  if (e.botao) comps.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: e.botao }] })
  return chamar(Deno.env.get('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: e.destino, type: 'template',
    template: { name: e.modelo, language: { code: 'pt_BR' }, components: comps },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const configurado = !!(Deno.env.get('WA_TOKEN') && Deno.env.get('WA_PHONE_ID'))
  const b = await req.json().catch(() => ({}))

  try {
    // ----- ações do admin -----
    if (b.acao) {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      const { data: u } = await sb.auth.getUser(jwt)
      const { data: perfil } = u?.user ? await sb.from('profiles').select('role').eq('id', u.user.id).single() : { data: null }
      if (perfil?.role !== 'admin') return json({ error: 'Só o administrador.' }, 403)

      if (b.acao === 'status') return json({ configurado, waba: !!Deno.env.get('WA_WABA_ID') })
      if (!configurado) return json({ error: 'Faltam os segredos WA_TOKEN e WA_PHONE_ID no Supabase.' }, 400)

      if (b.acao === 'teste') {
        const { data: cfg } = await sb.from('whatsapp_config').select('aviso_interno').eq('id', 1).single()
        if (!cfg?.aviso_interno) return json({ error: 'Sem número de aviso interno.' }, 400)
        const r = await chamar(Deno.env.get('WA_PHONE_ID') + '/messages', {
          messaging_product: 'whatsapp', to: cfg.aviso_interno, type: 'template',
          template: { name: 'hello_world', language: { code: 'en_US' } },
        })
        return json(r.ok ? { ok: true } : { error: r.dados?.error?.message || 'A Meta recusou o envio.' }, r.ok ? 200 : 400)
      }

      const waba = Deno.env.get('WA_WABA_ID')
      if (!waba) return json({ error: 'Falta o segredo WA_WABA_ID no Supabase.' }, 400)
      if (b.acao === 'criar_modelos') {
        const res: any[] = []
        for (const m of MODELOS) {
          const r = await chamar(waba + '/message_templates', { name: m.name, language: 'pt_BR', category: 'UTILITY', components: componentesModelo(m) })
          res.push({ modelo: m.name, ok: r.ok, status: r.dados?.status || null, erro: r.ok ? null : (r.dados?.error?.error_user_msg || r.dados?.error?.message || 'erro') })
        }
        return json({ resultados: res })
      }
      if (b.acao === 'modelos') {
        const r = await chamar(waba + '/message_templates?fields=name,status,rejected_reason&limit=100')
        const nossos = new Set(MODELOS.map((m) => m.name))
        return json({ modelos: (r.dados?.data || []).filter((m: any) => nossos.has(m.name)) })
      }
      return json({ error: 'Ação desconhecida.' }, 400)
    }

    // ----- fila (pg_cron) -----
    if (!configurado) return json({ ok: false, motivo: 'sem configuração; avisos ficam na fila' })
    const { data: lote, error } = await sb.rpc('wa_pegar_lote', { p_limite: 20 })
    if (error) return json({ error: error.message }, 500)
    let enviados = 0
    for (const e of lote || []) {
      const r = await enviarLinha(e)
      const erro = r.ok ? null : (r.dados?.error?.message || 'erro desconhecido')
      await sb.rpc('wa_marcar', { p_id: e.id, p_ok: r.ok, p_resposta: r.dados, p_erro: erro })
      if (r.ok) enviados++
    }
    return json({ ok: true, lote: (lote || []).length, enviados })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
