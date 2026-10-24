// Dupuro Revenda — Edge Function: pagar o pedido online (Payment Brick)
// ==========================================================================
// Só revendedor logado (JWT). Mesmo fluxo do delivery-pagar:
//   iniciar {rows, entrega}  → revenda_iniciar_checkout valida tudo no banco
//                              (simula o pedido e desfaz) e devolve token/total;
//   pagar   {token, formData}→ cobra /v1/payments com o TOTAL do banco;
//                              aprovado → revenda_confirmar_checkout cria o
//                              pedido (já confirmado, baixa o estoque);
//   status  {token}          → enquanto espera o Pix: reconsulta o MP.
// external_reference = 'REV-<id do checkout>' (o webhook também confirma).
// Secrets: MP_ACCESS_TOKEN, MP_PUBLIC_KEY.
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const METODO: Record<string, string> = { credit_card: 'credito', debit_card: 'debito', bank_transfer: 'pix', account_money: 'saldo_mp' }
const RECUSA: Record<string, string> = {
  cc_rejected_insufficient_amount: 'O cartão não tem limite ou saldo suficiente. Tente outro cartão ou o Pix.',
  cc_rejected_bad_filled_security_code: 'O código de segurança (CVV) está errado. Confira atrás do cartão.',
  cc_rejected_bad_filled_date: 'A validade do cartão está errada. Confira e tente de novo.',
  cc_rejected_bad_filled_card_number: 'O número do cartão está errado. Confira e tente de novo.',
  cc_rejected_bad_filled_other: 'Algum dado do cartão está errado. Confira e tente de novo.',
  cc_rejected_call_for_authorize: 'O banco pediu pra você autorizar a compra. Ligue pro banco ou use o Pix.',
  cc_rejected_card_disabled: 'Esse cartão está bloqueado. Ligue pro banco ou use outro cartão.',
  cc_rejected_duplicated_payment: 'Esse pagamento já foi feito. Confira seus pedidos.',
  cc_rejected_high_risk: 'O pagamento foi recusado por segurança. Tente o Pix ou outro cartão.',
  cc_rejected_max_attempts: 'Muitas tentativas com esse cartão. Use outro cartão ou o Pix.',
}
const dataMP = (ms: number) => new Date(ms - 4 * 3600e3).toISOString().replace('Z', '-04:00')

async function confirmar(sb: any, ck: any, pg: any) {
  const { data } = await sb.rpc('revenda_confirmar_checkout', {
    p_token: ck.token, p_payment_id: String(pg.id), p_metodo: METODO[pg.payment_type_id] || pg.payment_method_id || null,
    p_valor: Number(pg.transaction_amount) || 0,
  })
  return data || { ok: false }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'Pagamento online ainda em configuração.' }, 503)
    const auth = req.headers.get('Authorization') || ''
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
    const uid = u?.user?.id
    if (!uid) return json({ error: 'Entre de novo no painel.' }, 401)
    const b = await req.json().catch(() => ({}))

    // ---- iniciar: valida no banco (como o próprio revendedor) e guarda o checkout ----
    if (b.acao === 'iniciar') {
      const comoEle = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      const { data, error } = await comoEle.rpc('revenda_iniciar_checkout', { p_rows: b.rows, p_entrega: b.entrega })
      if (error) return json({ error: error.message, code: error.code }, 400)
      const { data: p } = await sb.from('profiles').select('email, nome').eq('id', uid).single()
      return json({ token: data.token, total: data.total, public_key: Deno.env.get('MP_PUBLIC_KEY') || null, email: p?.email || null })
    }

    const token = String(b.token || '')
    if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'Pagamento inválido. Volte e tente de novo.' }, 400)
    const { data: ck } = await sb.from('revenda_checkouts').select('*').eq('token', token).eq('revendedor_id', uid).single()
    if (!ck) return json({ error: 'Pagamento não encontrado.' }, 404)

    // ---- status (esperando o Pix) ----
    if (b.acao === 'status') {
      if (ck.status === 'pago') return json({ status: 'pago', numero: ck.numero })
      if (ck.status === 'erro') return json({ status: 'erro', erro: ck.erro })
      if (!ck.mp_payment_id) return json({ status: ck.status })
      const pg: any = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(ck.mp_payment_id), { headers: { Authorization: 'Bearer ' + mpToken } }).then((r) => r.json())
      if (pg?.status === 'approved') {
        const r = await confirmar(sb, ck, pg)
        return json(r.ok ? { status: 'pago', numero: r.numero } : { status: 'erro', erro: r.erro })
      }
      return json({ status: ck.status, mp_status: pg?.status || null })
    }

    // ---- pagar ----
    if (ck.status !== 'aguardando') return json({ error: ck.status === 'pago' ? 'Esse pedido já está pago.' : 'Esse pagamento não está mais aberto. Volte e faça o pedido de novo.' }, 409)
    if (Date.parse(ck.criado_em) < Date.now() - 3 * 3600e3) return json({ error: 'O pagamento expirou. Volte e faça o pedido de novo.' }, 409)
    const fd = b.formData || {}
    const metodo = String(fd.payment_method_id || '')
    if (!metodo) return json({ error: 'Escolha a forma de pagamento.' }, 400)
    const pix = metodo === 'pix'
    const { data: prof } = await sb.from('profiles').select('nome, email, telefone').eq('id', uid).single()
    const nome = String(prof?.nome || '').trim().split(/\s+/)
    const payer: any = { email: String(fd.payer?.email || prof?.email || '').slice(0, 120), first_name: nome[0] || undefined, last_name: nome.slice(1).join(' ') || undefined }
    if (fd.payer?.identification?.number) payer.identification = { type: String(fd.payer.identification.type || 'CPF'), number: String(fd.payer.identification.number).replace(/\D/g, '') }
    if (!payer.email) return json({ error: 'Informe seu e-mail.' }, 400)
    const corpo: any = {
      transaction_amount: Number(ck.total), // o valor é o do banco
      description: 'Dupuro Revenda',
      external_reference: 'REV-' + ck.id,
      notification_url: Deno.env.get('SUPABASE_URL') + '/functions/v1/delivery-mp-webhook',
      statement_descriptor: 'DUPURO ACAI',
      payment_method_id: metodo,
      payer,
    }
    if (pix) corpo.date_of_expiration = dataMP(Date.now() + 30 * 60e3)
    else {
      if (!fd.token) return json({ error: 'Confira os dados do cartão.' }, 400)
      corpo.token = String(fd.token)
      corpo.installments = Math.min(3, Math.max(1, Math.floor(Number(fd.installments) || 1)))
      if (fd.issuer_id) corpo.issuer_id = String(fd.issuer_id)
    }
    // Trocou de forma com um Pix pendente: cancela o antigo (ninguém paga duas vezes).
    if (ck.mp_payment_id && ck.mp_status === 'pending') {
      const velho: any = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(ck.mp_payment_id), { headers: { Authorization: 'Bearer ' + mpToken } }).then((r) => r.json()).catch(() => null)
      if (velho?.status === 'approved') { const r = await confirmar(sb, ck, velho); return json(r.ok ? { status: 'pago', numero: r.numero } : { status: 'erro', erro: r.erro }) }
      if (velho?.status === 'pending') await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(ck.mp_payment_id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mpToken }, body: JSON.stringify({ status: 'cancelled' }),
      }).catch(() => null)
    }
    const chave = ck.token + ':' + String(b.tentativa || '').replace(/[^0-9a-z-]/gi, '').slice(0, 40)
    const pg: any = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mpToken, 'X-Idempotency-Key': chave },
      body: JSON.stringify(corpo),
    }).then((r) => r.json())
    if (!pg?.id) return json({ error: 'O Mercado Pago não aceitou o pagamento: ' + String(pg?.message || 'tente de novo') + '.' }, 502)
    await sb.from('revenda_checkouts').update({ mp_payment_id: String(pg.id), mp_status: pg.status }).eq('id', ck.id)

    if (pg.status === 'approved') {
      const r = await confirmar(sb, ck, pg)
      return json(r.ok ? { status: 'pago', numero: r.numero } : { status: 'erro', erro: 'O pagamento foi aprovado, mas algo mudou no pedido (' + (r.erro || 'estoque') + '). A Dupuro já foi avisada e fala com você.' })
    }
    if (pix && pg.status === 'pending') {
      const t = pg?.point_of_interaction?.transaction_data || {}
      return json({ status: 'pix', pix: { qr_code: t.qr_code || null, qr_code_base64: t.qr_code_base64 || null, expira: pg.date_of_expiration || null } })
    }
    if (pg.status === 'in_process' || pg.status === 'pending') return json({ status: 'em_analise' })
    return json({ status: 'recusado', motivo: RECUSA[pg.status_detail] || 'O pagamento foi recusado. Tente outro cartão ou o Pix.' })
  } catch (e) {
    return json({ error: 'Falha no pagamento: ' + String((e as Error)?.message || e) }, 500)
  }
})
