// Dupuro Delivery — Edge Function: pagar no nosso site (Payment Brick)
// ==========================================================================
// Público (cliente anônimo, identificado só pelo token secreto do pedido).
// acao 'pagar'  : recebe o formData do Payment Brick (cartão tokenizado no
//                 navegador pelo SDK do MP, ou Pix) e cria o pagamento em
//                 /v1/payments. O VALOR é sempre o total do pedido no banco,
//                 nunca o do navegador. Pix devolve o QR (copia e cola).
// acao 'status' : o site pergunta a cada poucos segundos enquanto espera o
//                 Pix; reconsulta o pagamento no MP e, se aprovado, confirma
//                 (assim não depende só do webhook).
// Aprovado → delivery_confirmar_pagamento (pago + baixa estoque, idempotente).
//
// Secrets: MP_ACCESS_TOKEN.
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const METODO: Record<string, string> = { credit_card: 'credito', debit_card: 'debito', bank_transfer: 'pix', account_money: 'saldo_mp' }

// Recusa do cartão em português do dia a dia (status_detail do MP).
const RECUSA: Record<string, string> = {
  cc_rejected_insufficient_amount: 'O cartão não tem limite ou saldo suficiente. Tente outro cartão ou o Pix.',
  cc_rejected_bad_filled_security_code: 'O código de segurança (CVV) está errado. Confira atrás do cartão.',
  cc_rejected_bad_filled_date: 'A validade do cartão está errada. Confira e tente de novo.',
  cc_rejected_bad_filled_card_number: 'O número do cartão está errado. Confira e tente de novo.',
  cc_rejected_bad_filled_other: 'Algum dado do cartão está errado. Confira e tente de novo.',
  cc_rejected_call_for_authorize: 'O banco pediu pra você autorizar a compra. Ligue pro banco ou use o Pix.',
  cc_rejected_card_disabled: 'Esse cartão está bloqueado. Ligue pro banco ou use outro cartão.',
  cc_rejected_duplicated_payment: 'Esse pagamento já foi feito. Confira seu pedido.',
  cc_rejected_high_risk: 'O pagamento foi recusado por segurança. Tente o Pix ou outro cartão.',
  cc_rejected_max_attempts: 'Muitas tentativas com esse cartão. Use outro cartão ou o Pix.',
}

// "2026-10-24T15:30:00.000-04:00" (formato que o MP aceita, no fuso de Cuiabá)
function dataMP(ms: number): string {
  return new Date(ms - 4 * 3600e3).toISOString().replace('Z', '-04:00')
}

async function confirmar(sb: any, ped: any, pg: any) {
  if (Number(pg.transaction_amount) + 0.009 < Number(ped.total)) {
    await sb.from('delivery_pedidos').update({ mp_payment_id: String(pg.id), mp_status: 'valor_divergente', atualizado_em: new Date().toISOString() }).eq('id', ped.id)
    return false
  }
  const metodo = METODO[pg.payment_type_id] || pg.payment_method_id || null
  await sb.rpc('delivery_confirmar_pagamento', { p_codigo: ped.codigo, p_payment_id: String(pg.id), p_metodo: metodo, p_mp_status: pg.status })
  return true
}

function pixDe(pg: any) {
  const t = pg?.point_of_interaction?.transaction_data || {}
  return { qr_code: t.qr_code || null, qr_code_base64: t.qr_code_base64 || null, expira: pg.date_of_expiration || null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'Pagamento online ainda em configuração.' }, 503)
    const b = await req.json().catch(() => ({}))
    const token = String(b.token || '')
    if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'Pedido inválido. Recarregue a página.' }, 400)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ped } = await sb.from('delivery_pedidos')
      .select('id, codigo, token, total, status, cliente_nome, cliente_telefone, itens, taxa, mp_payment_id, mp_status, criado_em')
      .eq('token', token).single()
    if (!ped) return json({ error: 'Pedido não encontrado. Recarregue a página.' }, 404)

    // ---- Consulta (enquanto espera o Pix) ----
    if (b.acao === 'status') {
      if (ped.status !== 'aguardando_pagamento') return json({ status: ped.status })
      if (!ped.mp_payment_id) return json({ status: ped.status })
      const pg: any = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(ped.mp_payment_id), {
        headers: { Authorization: 'Bearer ' + mpToken },
      }).then((r) => r.json())
      if (pg?.status === 'approved' && await confirmar(sb, ped, pg)) return json({ status: 'pago' })
      return json({ status: ped.status, mp_status: pg?.status || null })
    }

    // ---- Pagar ----
    if (ped.status !== 'aguardando_pagamento') {
      return json({ error: ped.status === 'pago' ? 'Esse pedido já está pago.' : 'Esse pedido não está mais aberto pra pagamento. Faça o pedido de novo.' }, 409)
    }
    if (Date.parse(ped.criado_em) < Date.now() - 3 * 3600e3) return json({ error: 'O pedido expirou. Faça o pedido de novo.' }, 409)

    const fd = b.formData || {}
    const metodo = String(fd.payment_method_id || '')
    if (!metodo) return json({ error: 'Escolha a forma de pagamento.' }, 400)
    const pix = metodo === 'pix'
    const payer: any = { email: String(fd.payer?.email || '').slice(0, 120) }
    const nome = String(ped.cliente_nome || '').trim().split(/\s+/)
    payer.first_name = nome[0] || undefined
    payer.last_name = nome.slice(1).join(' ') || undefined
    if (fd.payer?.identification?.number) {
      payer.identification = { type: String(fd.payer.identification.type || 'CPF'), number: String(fd.payer.identification.number).replace(/\D/g, '') }
    }
    if (!payer.email) return json({ error: 'Informe seu e-mail.' }, 400)

    const corpo: any = {
      transaction_amount: Number(ped.total), // o valor é o do banco
      description: 'Dupuro Delivery ' + ped.codigo,
      external_reference: ped.codigo,
      notification_url: Deno.env.get('SUPABASE_URL') + '/functions/v1/delivery-mp-webhook',
      statement_descriptor: 'DUPURO ACAI',
      payment_method_id: metodo,
      payer,
      additional_info: {
        items: [
          ...(ped.itens || []).map((i: any) => ({ id: String(i.produto_id), title: i.nome + (i.sabor ? ' - ' + i.sabor : ''), quantity: i.quantidade, unit_price: Number(i.preco) })),
          { id: 'taxa-entrega', title: 'Taxa de entrega', quantity: 1, unit_price: Number(ped.taxa) },
        ],
        payer: { first_name: payer.first_name, phone: { area_code: String(ped.cliente_telefone).slice(0, 2), number: String(ped.cliente_telefone).slice(2) } },
      },
    }
    if (pix) {
      corpo.date_of_expiration = dataMP(Date.now() + 30 * 60e3) // QR vale 30 min
    } else {
      if (!fd.token) return json({ error: 'Confira os dados do cartão.' }, 400)
      corpo.token = String(fd.token)
      corpo.installments = Math.min(3, Math.max(1, Math.floor(Number(fd.installments) || 1)))
      if (fd.issuer_id) corpo.issuer_id = String(fd.issuer_id)
    }

    // Trocou de forma (ex.: gerou Pix e foi pro cartão): cancela o Pix que ficou
    // pendente, pra ninguém pagar duas vezes o mesmo pedido.
    if (ped.mp_payment_id && ped.mp_status === 'pending') {
      const velho: any = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(ped.mp_payment_id), {
        headers: { Authorization: 'Bearer ' + mpToken },
      }).then((r) => r.json()).catch(() => null)
      if (velho?.status === 'approved') { await confirmar(sb, ped, velho); return json({ status: 'pago' }) }
      if (velho?.status === 'pending') {
        await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(ped.mp_payment_id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mpToken },
          body: JSON.stringify({ status: 'cancelled' }),
        }).catch(() => null)
      }
    }

    // Uma chave por tentativa (o navegador gera): toque duplo não cobra duas vezes.
    const chave = ped.token + ':' + String(b.tentativa || '').replace(/[^0-9a-z-]/gi, '').slice(0, 40)
    const pg: any = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mpToken, 'X-Idempotency-Key': chave },
      body: JSON.stringify(corpo),
    }).then((r) => r.json())
    if (!pg?.id) {
      return json({ error: 'O Mercado Pago não aceitou o pagamento: ' + String(pg?.message || 'tente de novo') + '.' }, 502)
    }

    await sb.from('delivery_pedidos').update({
      mp_payment_id: String(pg.id), mp_status: pg.status, pagamento_metodo: METODO[pg.payment_type_id] || metodo,
      atualizado_em: new Date().toISOString(),
    }).eq('id', ped.id)

    if (pg.status === 'approved') {
      if (!await confirmar(sb, ped, pg)) return json({ error: 'O valor pago não confere com o pedido. Fale com a gente.' }, 409)
      return json({ status: 'pago' })
    }
    if (pix && pg.status === 'pending') return json({ status: 'pix', pix: pixDe(pg) })
    if (pg.status === 'in_process' || pg.status === 'pending') return json({ status: 'em_analise' })
    return json({ status: 'recusado', motivo: RECUSA[pg.status_detail] || 'O pagamento foi recusado. Tente outro cartão ou o Pix.' })
  } catch (e) {
    return json({ error: 'Falha no pagamento: ' + String((e as Error)?.message || e) }, 500)
  }
})
