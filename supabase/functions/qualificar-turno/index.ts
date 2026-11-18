// Dupuro Açaí — Edge Function: qualificar turno de chat da revenda
// ================================================================
// Chat de qualificação da revenda via WhatsApp; política de amostra ADIADA
// pelo dono (2026-11-18). O nó grava `quer_amostra`, fala transitória fica
// no front; única porta pública do funil (browser nunca toca a tabela).
//
// Modelo obrigatório: espelha fielmente
//   sugerir-fiscal/index.ts (shape TypeSafe, AbortController)
//   delivery-checkout/index.ts (rate_check via sb.rpc, ~ :66/:79)
//   pesquisa-analisar/index.ts (UM request com TRÊS perguntas nomeadas,
//       parsing answers.<chave>, argmax por índice sobre probabilities)
//
// Entrada via POST JSON {acao, ...} · Saída conforme cada ação.
// NADA de generate-offensive (zero LLM generativo no request).
// ================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

/* ── helpers internos ─────────────────────────────────────────────── */

/** Gera token UUID v4 (hex, 36 chars). */
function genToken(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15)
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/** Validação defensiva dos campos enviados ao corpo. */
const okCampos = (c: unknown): c is { nome?: unknown; negocio?: unknown; telefone?: unknown; cidade?: unknown; bairro?: unknown } =>
  typeof c === 'object' && c !== null

/** UUID v4 canônico — evita sql-injection em .eq('token', ...) */
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const capNome = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 80) : null)
const capNegocio = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 120) : null)
const capTel = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '').slice(0, 13) : null)
const capCidade = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : null)
const capBairro = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : null)

/* ── UM request TypeSafe com TRÊS perguntas (espelha pesquisa-analisar:66-164) ─*/

async function perguntarTurno(
  key: string,
  shop: string,
  mensagem: string | null,
  negocio: string | null,
  cidade: string | null,
  bairro: string | null,
): Promise<{
  objecao: [string, number]        // [choice, probability]
  interesse: number                // indice 0-3 cru
  segmento: [string, number]       // [choice, probability]
}> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000) // 6 s

  try {
    const state: Record<string, unknown> = {
      shop,
      mensagem: mensagem || '',
      negocio,
      cidade,
      bairro,
    }

    const questions: Record<string, unknown> = {
      objecao: {
        type: 'choice',
        instructions: "Classify the CUSTOMER's latest message in a WhatsApp-style qualification chat for an açaí wholesaler in Cuiabá.",
        criteria: {
          revenda_serio: 'explicit resale/wholesale intent (resell, partner, minimum, box 10L price)',
          varejo_curiosidade: 'end consumer asking retail price/flavors, no resale signal',
          amostra_teste: 'wants to try/test before committing, asks for sample',
          produto_duvida: 'purity, lactose, storage, expiration, babies',
          abrangencia_entrega: 'coverage: neighborhood, Várzea Grande, other cities',
          preco_minimo: 'price or minimum too high for their business',
          concorrente_fornecedor: 'already buys from another supplier or comparing',
          duvida_operacional: 'how to order/register/pay — stuck on process',
          sem_intencao: 'noise/joke/spam',
        },
      },
      interesse: {
        type: 'score',
        instructions: 'How much resale interest does the CUSTOMER show on a scale of 0-3?',
        criteria: [
          'asks about retail prices only, no wholesale intent whatsoever',
          'mentions wholesale casually but without concrete follow-up',
          'concrete operational questions about wholesale terms (minimum, delivery, box price, how to start)',
          'ready to act — wants sample, registration link, quote, or order',
        ],
      },
      segmento: {
        type: 'choice',
        instructions: 'What kind of buyer is this person, from their own words? Respond with exactly one option.\nRespond with "individuo_sem_negocio" if nothing suggests a business.',
        criteria: {
          delivery_acai: 'runs a small delivery/home delivery service selling açaí',
          acaieteria: 'owns or works at an açaí shop/store',
          lanchonete_bar: 'owns a snack bar, diner, or bar that might add açaí',
          feira_evento: 'seller at fairs, events, street food, or parties',
          mercado_varejo: 'small market/grocery that sells cups and boxes to walk-in customers',
          individuo_sem_negocio: 'individual without any business — end consumer only',
        },
      },
    }

    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
    })

    if (!r.ok) throw new Error(`TypeSafe ${r.status}`)
    const j: any = await r.json()

    // ---- parse objecao (espelha pesquisa-analisar:122-125: choice + probabilities) ----
    const ob = j?.answers?.objecao
    if (!ob || typeof ob.choice !== 'string') throw new Error('objecao missing')
    const objConf = ob.probabilities?.[ob.choice] ?? ob.confidence ?? 0

    // ---- parse interesse (espelha pesquisa-analisar:127-149: argmax por índice) ----
    // As probabilities vêm CHAVEADAS POR ÍNDICE (0..N-1) quando há criteria.
    const intRaw: any = j?.answers?.interesse
    if (!intRaw) throw new Error('interesse missing')
    let interesScore: number | null = null
    if (intRaw.probabilities) {
      const pares = Object.entries(intRaw.probabilities)
        .map(([k, v]) => [Number(k), Number(v)] as [number, number])
        .filter(([i]) => i >= 0 && i < 4)
      if (pares.length) {
        pares.sort((x, y) => y[1] - x[1])
        interesScore = pares[0][0]
      }
    }
    if (interesScore == null) {
      const raw = typeof intRaw.score === 'number' ? Math.round(intRaw.score) : null
      interesScore = (raw != null && raw <= 3 && raw >= 0) ? raw : null
    }
    if (interesScore == null) throw new Error('interesse score unavailable')

    // ---- parse segmento (espelha topico) ----
    const sg = j?.answers?.segmento
    if (!sg || typeof sg.choice !== 'string') throw new Error('segmento missing')
    const segConf = sg.probabilities?.[sg.choice] ?? sg.confidence ?? 0

    return { objecao: [ob.choice, objConf], interesse: interesScore, segmento: [sg.choice, segConf] }
  } finally {
    clearTimeout(timer)
  }
}

/* ── corpo principal ──────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'Use POST' }, 405)

  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')

    /* ---------- ler e validar corpo antes de qualquer acesso ---------- */
    let body: any
    try { body = await req.json() } catch { body = {} }
    const acao = typeof body?.acao === 'string' ? body.acao : ''

    // IP para rate limit
    const ipRaw = String(req.headers.get('cf-connecting-ip') || '').trim() || 'unknown'

    /* ── INICIAR ────────────────────────────────────────────────── */
    if (acao === 'iniciar') {
      const campos = (body.campos as { nome?: unknown; negocio?: unknown; telefone?: unknown; cidade?: unknown; bairro?: unknown } | undefined) ?? {}
      if (!okCampos(campos)) return json({ erro: 'Corpo inválido.' }, 400)

      // Rate limit por IP (mesma regra do delivery-checkout: ~ :66)
      const { data: ipOk } = await sb.rpc('rate_check', { p_key: 'lvi:' + ipRaw, p_max: 8, p_janela_seg: 3600 })
      if (ipOk === false) return json({ ok: false, erro: 'limite' }, 429)

      const nome = capNome(campos.nome) ?? null
      const negocio = capNegocio(campos.negocio) ?? null
      const telefone = capTel(campos.telefone) ?? null
      const cidade = capCidade(campos.cidade) ?? null
      const bairro = capBairro(campos.bairro) ?? null
      const tokenUuid = genToken()

      const { error: insErr } = await sb.from('qualificacao_leads').insert({
        token: tokenUuid,
        nome, negocio, telefone, cidade, bairro,
        ultimo_texto: null,
        objecao: null,
        interesse: null,
        segmento: null,
        status: 'em_chat',
        quer_amostra: false,
        turns: 0,
        lead_profile: null,
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      })
      if (insErr) throw insErr
      return json({ ok: true, token: tokenUuid })
    }

    /* ── TURNO ──────────────────────────────────────────────────── */
    if (acao === 'turno') {
      const texto = ((body.texto != null ? String(body.texto).slice(0, 300) : '').trim()) || null
      const campos = (body.campos as { nome?: unknown; negocio?: unknown; telefone?: unknown; cidade?: unknown; bairro?: unknown } | undefined) ?? {}
      if (!okCampos(campos)) return json({ erro: 'Corpo inválido.' }, 400)

      // Token UUID do lead
      const leadToken = (typeof body.token === 'string' && IS_UUID.test(body.token)) ? body.token : ''
      if (!leadToken) return json({ erro: 'Token inválido.' }, 400)

      // Rate limit por token (24 turnos / 30 min)
      const { data: tokOk } = await sb.rpc('rate_check', { p_key: 'lvt:' + leadToken, p_max: 24, p_janela_seg: 1800 })
      if (tokOk === false) return json({ ok: false, erro: 'limite' }, 429)

      // Validar que linha existe e obter campos atuais
      const { data: oldRow, error: selErr } = await sb.from('qualificacao_leads')
        .select('nome, negocio, telefone, cidade, bairro, turns, objecao, segmento, interesse, quer_amostra')
        .eq('token', leadToken)
        .maybeSingle()
      if (selErr) throw selErr
      if (!oldRow) return json({ erro: 'Sessão inválida.' }, 404)

      // Chamada ÚNICA com TRÊS perguntas (paralelo-questions pattern)
      const SHOP = 'Dupuro Açaí, an açaí factory and wholesaler in Cuiabá, Brazil. They sell 10L boxes and tubs of pure açaí and cream ice cream flavors (ninho, morango, cupuaçu...). Wholesale starts at 1 box (10L). Address: Av. das Torres nº 16, Jardim Imperial II. No drive-thru.'
      const key = Deno.env.get('TYPESAFE_API_KEY') ?? null
      let result: Awaited<ReturnType<typeof perguntarTurno>> | null = null
      try {
        result = await perguntarTurno(
          key,
          SHOP,
          texto,
          oldRow.negocio,
          oldRow.cidade,
          oldRow.bairro,
        )
      } catch (_e) {
        // Best-effort: Jev falhou → rótulos serão null, mas GRAVA turno/campos
        result = null
      }

      // Constrói payload de update (best-effort se result=null)
      const up: Record<string, unknown> = {
        ultimo_texto: texto,
        atualizado_em: new Date().toISOString(),
      }

      // Classificação pegajosa: os últimos turnos são ruído natural; o sinal
      // do lead é a MELHOR mensagem, não a última. turns mantém last-write
      // (perde sob paralelo sintético — chat real é sequencial, aceitável).
      let objecaoLabel: string | null = null
      let objConf = 0
      let interesScore: number | null = null
      let segmentoLabel: string | null = null
      let segConf = 0

      if (result) {
        const [objCh, objPr] = result.objecao
        const [segCh, segPr] = result.segmento
        objecaoLabel = objCh
        objConf = objPr
        interesScore = result.interesse
        segmentoLabel = segCh
        segConf = segPr

        // interesse: max esticky — nunca rebaixa um turno fraco
        const oldInter = Number(oldRow.interesse) || 0
        if (result.interesse > oldInter) up.interesse = result.interesse

        // objecao: só grava quando vier novo E, se for sem_intencao,
        // não apaga sinal existente (nullish-coerce ''→null do Postgres).
        const novoObj = result?.objecao ? result.objecao[0] : null
        if (novoObj && !(novoObj === 'sem_intencao' && (oldRow.objecao || ''))) up.objecao = novoObj

        // segmento: nunca sobrescreve com individuo_sem_negocio se já tem valor
        if (segCh !== 'individuo_sem_negocio' || !oldRow.segmento) up.segmento = segCh

        // quer_amostra: one-way true
        ;(up.quer_amostra as boolean) = (oldRow.quer_amostra as boolean) || objCh === 'amostra_teste'

        // Campos parciais coalesce: só atualiza se vier não-null
        if (capNome(campos.nome)) up.nome = capNome(campos.nome)
        if (capNegocio(campos.negocio)) up.negocio = capNegocio(campos.negocio)
        if (capTel(campos.telefone)) up.telefone = capTel(campos.telefone)
        if (capCidade(campos.cidade)) up.cidade = capCidade(campos.cidade)
        if (capBairro(campos.bairro)) up.bairro = capBairro(campos.bairro)
      } else {
        // Best-effort: Jev falhou → labels null, mas atualiza campos parciais
        if (capNome(campos.nome)) up.nome = capNome(campos.nome)
        if (capNegocio(campos.negocio)) up.negocio = capNegocio(campos.negocio)
        if (capTel(campos.telefone)) up.telefone = capTel(campos.telefone)
        if (capCidade(campos.cidade)) up.cidade = capCidade(campos.cidade)
        if (capBairro(campos.bairro)) up.bairro = capBairro(campos.bairro)
      }

      // turns++ sempre (last-write; perde em paralelo sintético, mas chat real
      // é sequencial por token, então não há corrida no produto)
      ;(up as any).turns = (Number(oldRow.turns) || 0) + 1

      const { error: updErr } = await sb.from('qualificacao_leads').update(up).eq('token', leadToken)
      if (updErr) return json({ ok: false, erro: 'Erro ao salvar turno.' }, 500)

      return json({
        ok: true,
        objecao: objecaoLabel,
        obj_conf: objConf,
        interesse: interesScore,
        int_conf: null,
        segmento: segmentoLabel,
        seg_conf: segConf,
        quer_amostra: objecaoLabel === 'amostra_teste',
        status: 'em_chat',
      })
    }

    /* ── FLAG ───────────────────────────────────────────────────── */
    if (acao === 'flag') {
      const allowedStatuses = ['varejo','expansao','potencial','pronto_cadastro','sem_acao']
      const status = typeof body.status === 'string' ? body.status : ''
      if (!allowedStatuses.includes(status)) return json({ erro: 'Status inválido.' }, 400)

      // Só permite se status_atual == 'em_chat'; 'convertido' NÃO setável por flag
      const tFlag = (typeof body.token === 'string' && IS_UUID.test(body.token)) ? body.token : ''
      if (!tFlag) return json({ erro: 'Token inválido.' }, 400)
      const { data: led, error: selErr } = await sb.from('qualificacao_leads')
        .select('status')
        .eq('token', tFlag)
        .maybeSingle()
      if (selErr) throw selErr
      if (!led || led.status !== 'em_chat') return json({ erro: 'Não é possível alterar esse status agora.' }, 400)

      await sb.from('qualificacao_leads').update({ status, atualizado_em: new Date().toISOString() })
        .eq('token', tFlag)
      return json({ ok: true, status })
    }

    /* ── CONVERTER ──────────────────────────────────────────────── */
    if (acao === 'converter') {
      // Exige Authorization bearer próprio — qualquer usuário autenticado
      if (!jwt) return json({ erro: 'Sem sessão' }, 401)
      const { data: u } = await sb.auth.getUser(jwt)
      if (!u?.user) return json({ erro: 'Autenticação inválida' }, 401)

      const uid = u.user.id
      const leadTokenConv = (typeof body.token === 'string' && IS_UUID.test(body.token)) ? body.token : ''
      if (!leadTokenConv) return json({ erro: 'Token inválido.' }, 400)
      // Apenas se status != 'convertido'
      await sb.from('qualificacao_leads')
        .update({ status: 'convertido', lead_profile: uid, atualizado_em: new Date().toISOString() })
        .eq('token', leadTokenConv)
        .neq('status', 'convertido')
      return json({ ok: true })
    }

    return json({ erro: 'Ação inválida.' }, 400)
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500)
  }
})
