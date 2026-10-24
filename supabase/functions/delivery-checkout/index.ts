// Dupuro Delivery — Edge Function: checkout (cria pedido + pagamento Mercado Pago)
// ==========================================================================
// Público (cliente anônimo). NUNCA confia no navegador: preço e estoque vêm do
// banco (delivery_catalogo), km/taxa só valem com a cotação assinada pela
// delivery-cotacao, e o período/data é revalidado contra a config (dias e corte).
// Cria o pedido 'aguardando_pagamento'. O pagamento acontece NO NOSSO SITE
// (Payment Brick do Mercado Pago + Edge Function delivery-pagar); a preferência
// do Checkout Pro continua sendo criada como plano B (init_point) caso o Brick
// não carregue. Quem baixa o estoque é delivery_confirmar_pagamento (chamada
// pela delivery-pagar e pelo webhook, idempotente).
//
// Secrets: MP_ACCESS_TOKEN (Mercado Pago, produção ou TEST-...); MP_PUBLIC_KEY
// (chave pública, vai pro navegador montar o Brick).
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SITE = 'https://www.dupuroacai.com/delivery'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

async function hmac(texto: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

// Mesma regra do front (delivery.js): Cuiabá = UTC-4 fixo.
function janelasValidas(cfg: any): Set<string> {
  const ok = new Set<string>()
  const agora = new Date(Date.now() - 4 * 3600e3)
  const minAgora = agora.getUTCHours() * 60 + agora.getUTCMinutes()
  const mins = (s: string) => { const [h, m] = String(s || '0:0').split(':'); return (+h) * 60 + (+m || 0) }
  const dias: number[] = cfg.dias || [1, 2, 3, 4, 5, 6]
  for (let d = 0; d < 10; d++) {
    const dia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + d))
    if (!dias.includes(dia.getUTCDay())) continue
    for (const per of ['manha', 'tarde']) {
      const j = cfg.janelas?.[per]; if (!j) continue
      if (d === 0 && minAgora >= mins(j.corte)) continue
      ok.add(dia.toISOString().slice(0, 10) + '|' + per)
    }
  }
  return ok
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpToken) return json({ error: 'Pagamento online ainda em configuração. Fale com a gente no WhatsApp (65) 99288-8228.' }, 503)
    const b = await req.json().catch(() => ({}))
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: row } = await sb.from('delivery_config').select('config').eq('id', 1).single()
    const cfg: any = row?.config
    if (!cfg || cfg.ativo === false) return json({ error: 'Delivery pausado no momento.' }, 503)

    // Dados do cliente
    const nome = String(b.nome || '').trim().slice(0, 80)
    const tel = String(b.telefone || '').replace(/\D/g, '').slice(0, 13)
    const endereco = String(b.endereco || '').trim().slice(0, 300)
    if (nome.length < 3) return json({ error: 'Informe seu nome.' }, 400)
    if (tel.length < 10) return json({ error: 'Informe um WhatsApp válido.' }, 400)
    if (endereco.length < 6) return json({ error: 'Informe o endereço.' }, 400)

    // Cotação assinada (km/taxa/ponto não podem ser alterados no navegador)
    const c = b.cotacao || {}
    const lat = Number(b.lat), lng = Number(b.lng), km = Number(b.km), taxa = Number(b.taxa)
    const base = [lat.toFixed(6), lng.toFixed(6), km, taxa, c.exp].join('|')
    if (!c.assinatura || !(Number(c.exp) > Date.now()) || (await hmac(base)) !== c.assinatura) {
      return json({ error: 'A cotação da entrega expirou. Calcule a entrega de novo.' }, 400)
    }

    // Período
    const periodo = b.periodo === 'manha' || b.periodo === 'tarde' ? b.periodo : null
    const data = String(b.data || '')
    if (!periodo || !janelasValidas(cfg).has(data + '|' + periodo)) {
      return json({ error: 'Esse horário de entrega não está mais disponível. Escolha outro.' }, 400)
    }

    // Itens: preço e estoque do banco
    const { data: cat } = await sb.rpc('delivery_catalogo')
    const porId = new Map<number, any>((cat || []).map((p: any) => [Number(p.id), p]))
    const pedidos = new Map<string, number>()
    const itens: any[] = []
    for (const it of (Array.isArray(b.itens) ? b.itens : []).slice(0, 30)) {
      const p = porId.get(Number(it.produto_id))
      const q = Math.floor(Number(it.quantidade))
      if (!p || !(q >= 1 && q <= 50)) return json({ error: 'Item inválido no carrinho. Recarregue a página.' }, 400)
      const sabor = p.multissabor ? String(it.sabor || '') : null
      if (p.multissabor && !(p.sabores || []).some((s: any) => s.sabor === sabor)) return json({ error: 'Escolha o sabor de ' + p.nome + '.' }, 400)
      const k = p.id + '|' + (sabor || '')
      pedidos.set(k, (pedidos.get(k) || 0) + q)
      const disp = p.multissabor ? Number((p.sabores.find((s: any) => s.sabor === sabor) || {}).estoque || 0) : Number(p.estoque || 0)
      if (pedidos.get(k)! > disp) return json({ error: `Só temos ${disp} de ${p.nome}${sabor ? ' (' + sabor + ')' : ''} no momento.` }, 409)
      itens.push({ produto_id: Number(p.id), nome: p.nome, sabor, quantidade: q, preco: Number(p.preco) })
    }
    if (!itens.length) return json({ error: 'Carrinho vazio.' }, 400)
    const subtotal = Math.round(itens.reduce((s, i) => s + i.preco * i.quantidade, 0) * 100) / 100
    const total = Math.round((subtotal + taxa) * 100) / 100

    // Pagamento na entrega (migration_049): dinheiro/débito/crédito/Pix na maquininha.
    const naEntrega = b.pagamento === 'entrega'
    const formaEntrega = naEntrega ? String(b.forma_entrega || '') : null
    if (naEntrega && !['dinheiro', 'debito', 'credito', 'pix'].includes(formaEntrega!)) return json({ error: 'Escolha como vai pagar na entrega.' }, 400)
    const trocoPara = naEntrega && formaEntrega === 'dinheiro' && b.troco_para ? Math.round(Number(b.troco_para) * 100) / 100 : null
    if (trocoPara !== null && !(trocoPara >= total)) return json({ error: 'O troco precisa ser pra um valor maior que o total.' }, 400)

    // Expira pedidos abandonados (não pagos há mais de 3h) — limpeza preguiçosa.
    await sb.from('delivery_pedidos').update({ status: 'expirado', atualizado_em: new Date().toISOString() })
      .eq('status', 'aguardando_pagamento').lt('criado_em', new Date(Date.now() - 3 * 3600e3).toISOString())

    const { data: ped, error: e1 } = await sb.from('delivery_pedidos').insert({
      cliente_nome: nome, cliente_telefone: tel, endereco, complemento: b.complemento ? String(b.complemento).slice(0, 200) : null,
      lat, lng, distancia_km: km, taxa, subtotal, total, itens, periodo, data_entrega: data,
      aceita_whatsapp: b.aceita_whatsapp !== false, // avisos do pedido no WhatsApp (migration_046)
      pagar_na_entrega: naEntrega, forma_entrega: formaEntrega, troco_para: trocoPara,
    }).select('id, codigo, token').single()
    if (e1 || !ped) return json({ error: 'Não foi possível registrar o pedido.' }, 500)

    // Na entrega: vale na hora (decisão do Kayo) — entra na rota e baixa o estoque.
    if (naEntrega) {
      await sb.rpc('delivery_confirmar_pagamento', { p_codigo: ped.codigo, p_payment_id: null, p_metodo: 'na_entrega_' + formaEntrega, p_mp_status: 'na_entrega' })
      return json({ codigo: ped.codigo, token: ped.token, total, na_entrega: true })
    }

    // Preferência do Checkout Pro (Pix + cartão; sem boleto — entrega é no mesmo dia).
    const agora = new Date(), expira = new Date(Date.now() + 2 * 3600e3)
    const pref = {
      items: [
        ...itens.map((i) => ({ id: String(i.produto_id), title: i.nome + (i.sabor ? ' - ' + i.sabor : ''), quantity: i.quantidade, unit_price: i.preco, currency_id: 'BRL' })),
        { id: 'taxa-entrega', title: 'Taxa de entrega', quantity: 1, unit_price: taxa, currency_id: 'BRL' },
      ],
      payer: { name: nome, phone: { area_code: tel.slice(0, 2), number: tel.slice(2) } },
      external_reference: ped.codigo,
      notification_url: Deno.env.get('SUPABASE_URL') + '/functions/v1/delivery-mp-webhook',
      back_urls: { success: `${SITE}/acompanhar.html?t=${ped.token}`, pending: `${SITE}/acompanhar.html?t=${ped.token}`, failure: `${SITE}/acompanhar.html?t=${ped.token}` },
      auto_return: 'approved',
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }, { id: 'debit_card' }], installments: 3 },
      statement_descriptor: 'DUPURO ACAI',
      expires: true, expiration_date_from: agora.toISOString(), expiration_date_to: expira.toISOString(),
      date_of_expiration: expira.toISOString(),
    }
    const mp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mpToken, 'X-Idempotency-Key': ped.token },
      body: JSON.stringify(pref),
    }).then((r) => r.json())
    const publicKey = Deno.env.get('MP_PUBLIC_KEY') || null
    if (!mp?.id && !publicKey) { // sem Brick e sem preferência não há como pagar
      await sb.from('delivery_pedidos').update({ status: 'cancelado', mp_status: 'erro_preferencia' }).eq('id', ped.id)
      return json({ error: 'O Mercado Pago não respondeu. Tente de novo em instantes.' }, 502)
    }
    if (mp?.id) await sb.from('delivery_pedidos').update({ mp_preference_id: mp.id }).eq('id', ped.id)
    const teste = mpToken.startsWith('TEST-')
    return json({ codigo: ped.codigo, token: ped.token, total, public_key: publicKey,
      init_point: mp?.id ? (teste ? mp.sandbox_init_point : mp.init_point) : null })
  } catch (e) {
    return json({ error: 'Falha no checkout: ' + String((e as Error)?.message || e) }, 500)
  }
})
