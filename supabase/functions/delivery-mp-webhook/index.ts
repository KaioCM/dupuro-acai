// Dupuro Delivery — Edge Function: webhook do Mercado Pago
// ==========================================================================
// O MP avisa aqui quando um pagamento muda. NUNCA confiamos no corpo da
// notificação: pegamos só o id e reconsultamos o pagamento na API do MP com o
// nosso token (assim uma notificação forjada não marca nada como pago).
// Aprovado → delivery_confirmar_pagamento (status 'pago' + baixa de estoque,
// idempotente). Sempre responde 200 (senão o MP fica reenviando).
//
// Secrets: MP_ACCESS_TOKEN; MP_WEBHOOK_SECRET (opcional — se configurado,
// valida a assinatura x-signature do MP).
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ok = (b: unknown = { ok: true }) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })

async function hmacHex(secret: string, texto: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto)))
  return Array.from(sig).map((x) => x.toString(16).padStart(2, '0')).join('')
}

const METODO: Record<string, string> = { credit_card: 'credito', debit_card: 'debito', bank_transfer: 'pix', account_money: 'saldo_mp' }

Deno.serve(async (req: Request) => {
  try {
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return ok({ ok: false, motivo: 'sem token' })
    const url = new URL(req.url)
    const body: any = await req.json().catch(() => ({}))
    const tipo = body.type || url.searchParams.get('type') || url.searchParams.get('topic')
    const id = String(body?.data?.id || url.searchParams.get('data.id') || (tipo === 'payment' ? url.searchParams.get('id') : '') || '')
    if (tipo !== 'payment' || !id) return ok({ ok: true, ignorado: tipo || 'sem tipo' })

    // Assinatura (se o secret estiver configurado no painel do MP e aqui).
    const secret = Deno.env.get('MP_WEBHOOK_SECRET')
    if (secret) {
      const sig = req.headers.get('x-signature') || ''
      const reqId = req.headers.get('x-request-id') || ''
      const partes = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')))
      const manifesto = `id:${id.toLowerCase()};request-id:${reqId};ts:${partes.ts};`
      if (!partes.v1 || (await hmacHex(secret, manifesto)) !== partes.v1) {
        return new Response('assinatura inválida', { status: 401 })
      }
    }

    const pg: any = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(id), {
      headers: { Authorization: 'Bearer ' + mpToken },
    }).then((r) => r.json())
    const codigo = pg?.external_reference
    if (!codigo || !String(codigo).startsWith('DLV-')) return ok({ ok: true, ignorado: 'nao_e_delivery' })

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ped } = await sb.from('delivery_pedidos').select('id, total, status').eq('codigo', codigo).single()
    if (!ped) return ok({ ok: false, motivo: 'pedido nao encontrado' })

    if (pg.status === 'approved') {
      // Confere o valor (não aceita pagamento menor que o total do pedido).
      if (Number(pg.transaction_amount) + 0.009 < Number(ped.total)) {
        await sb.from('delivery_pedidos').update({ mp_payment_id: id, mp_status: 'valor_divergente', atualizado_em: new Date().toISOString() }).eq('id', ped.id)
        return ok({ ok: false, motivo: 'valor divergente' })
      }
      const metodo = METODO[pg.payment_type_id] || pg.payment_method_id || pg.payment_type_id || null
      const { data: r } = await sb.rpc('delivery_confirmar_pagamento', { p_codigo: codigo, p_payment_id: id, p_metodo: metodo, p_mp_status: pg.status })
      return ok(r)
    }
    // Pendente/recusado/estornado: só registra o status do MP (admin acompanha).
    await sb.from('delivery_pedidos').update({ mp_payment_id: id, mp_status: pg.status, atualizado_em: new Date().toISOString() }).eq('id', ped.id)
    return ok({ ok: true, status_mp: pg.status })
  } catch (e) {
    return ok({ ok: false, erro: String((e as Error)?.message || e) })
  }
})
