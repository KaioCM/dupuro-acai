// Dupuro Açaí — Edge Function: analisa e rotula respostas da pesquisa de feedback.
// ==========================================================================
// Pipeline: coleta (painel / delivery / PDV / cadastro / etc.) → rótulos Jev
// (TypeSafe, modelo jev-latest) → humano lê a zona cinzenta no admin.
//
// Três zonas de confiança (baseadas na maior probabilidade do topico):
//   ≥ 0,85 → automático (o humano só conferência).
//   0,60–0,84 → revisão humana obrigatória (cinza — o Jev não tem certeza).
//   < 0,60 → 'outro' (sem chance significativa para nenhum critério definido).
//
// Este arquivo é o registro local; a função roda no Supabase (deploy via MCP).
// Só admin chama (cada chamada custa créditos no TypeSafe).
// A chave fica no secret TYPESAFE_API_KEY, nunca no navegador.
// Entrada: { lote?: number } · Saída: { ok, analisadas, erros, restantes }
// ==========================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const TIPO = 'Dupuro Açaí, uma fábrica e loja de açaí e cremes em Cuiabá-MT, Brasil. Revende açaí para revendedores (a partir de 10 L por produto).'

// v1 calibrada com a primeira resposta real (2026-11-18): "quero testar antes" era outro → confianca
// chave renomeada de 'confianca_pagamento' para 'confianca' (alinhamento docs/pesquisa-ativacao.md)
const TOPICO_CRITERIA: Record<string, string> = {
  acai_qualidade: 'Complaint about the product itself — bad taste, wrong temperature (not cold enough / melted), consistency issues, foreign object.',
  entrega: 'Delivery complaint — late, missed route stop, wrong address, driver problem.',
  preco: 'Price objection — says the product is too expensive, the delivery fee is too high, or disputes a charge.',
  duvida_operacional: 'Does not know how to use the panel, make an order, or pay — asks for help navigating the process.',
  confianca: 'Hesitation before committing — wants to try/test the product first, doubts about quality or fit for their business, fear of buying blind.',
  elogio: 'Positive feedback — praises the quality, service, delivery, or the brand overall.',
  concorrente: 'Mentions buying from another supplier/friend and possibly switching.',
  sem_demanda: 'Business did not pick up despite receiving product — slow sales, no demand.',
  outro: 'Everything else that does not fit any category above.',
}

/** Score urgencia: nível 0 = info/elogio · 1 = dúvida simples · 2 = problema real · 3 = cobrança/clinte perdido. */
const URGENCIA_NIVEIS: string[] = [
  'info ou elogio — sem ação necessária',
  'dúvida simples sobre como funciona painel ou pagamento',
  'problema real no pedido — qualidade, entrega ou cobrança',
  'cobrança indevida reportada ou risco iminente de cliente perdido',
]

/** Índice do nível (argmax dos probabilities) → valor na escala da coluna `urgencia`.
 * O filtro do admin usa >= 6 para problema real, >= 9 para urgência máxima.
 *
 * CONTRA FONTE — rota/index.ts:269-275: lá a função `avaliarComJev` armazena o
 *  índice CRU diretamente (`pares.sort(...)[0][0]` → `nota`).  A Dupuro optou por
 *  mapear para escala estável 0-9 porque a legenda de critérios pode crescer ou
 *  renomear, enquanto a escala 0-9 é parte do contrato com o admin.
 */
const ESCALA_URG = [0, 3, 6, 9] // índice → valor

/** Resposta válida do Yes CLI (cmd_yes :113-116): noul é um número; coerente se noul ≥ 0,5. */
const COERENCIA_ESPERADA: Record<number, boolean> = {
  1: false, 2: false, 3: false, 4: true, 5: true,
}

/** One TypeSafe request packing ALL THREE questions (parallel-questions pattern). */
async function perguntar(
  key: string,
  nota: number | null,
  texto: string,
  canal: string,
): Promise<{
  topico: [string, number] // [choice, probability]
  urgencia: number         // valor na escala 0-9
  coerente: boolean | null // null when nota === null
}> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5_000)

  try {
    // Build the state payload.
    const state: Record<string, unknown> = { tipo_loja: TIPO, canal, texto: texto || '' }
    if (nota != null) {
      state.nota = nota
      state.exp_coerencia = COERENCIA_ESPERADA[nota] ?? null
    }

    // Only include the coerencia question when we have a note to validate.
    const questions: Record<string, unknown> = {
      topico: {
        type: 'choice',
        instructions: 'Which concern category best fits this customer feedback? Return ONLY the key name.',
        criteria: TOPICO_CRITERIA,
      },
      urgencia: {
        type: 'score',
        instructions: 'How urgent is this case?',
        criteria: URGENCIA_NIVEIS,
      },
    }
    if (nota != null) {
      // NOTE: type is 'noul' (NOT 'noult'); response value is answers.<chave>.noul (number), NOT .result.
      questions.coerente = {
        type: 'noul',
        instructions: 'Does the free text match the numeric rating?',
      }
    }

    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state,
        questions,
      }),
    })

    if (!r.ok) throw new Error(`TypeSafe ${r.status}`)
    const j: any = await r.json()

    // ---- parse topico (espelha sugerir-fiscal:73-76) ----
    const tp = j?.answers?.topico
    if (!tp || typeof tp.choice !== 'string') throw new Error('topico missing')
    const confTopico = tp.probabilities?.[tp.choice] ?? tp.confidence ?? 0

    // ---- parse urgencia (espelha rota/index.ts:269-275) ----
    // NOTE: com criteria, a API devolve probabilidades CHAVEADAS POR ÍNDICE (0..N-1).
    // Argmax dá o índice; mapeamos para ESCALA_URG = [0, 3, 6, 9].
    // Rota/grava o índice cru (ver comentário em ESCALA_URG); Dupuro mapeia para escala estável.
    const ug = j?.answers?.urgencia
    if (!ug) throw new Error('urgencia missing')
    const paresUrg = Object.entries(ug.probabilities || {})
      .map(([k, v]) => [Number(k), Number(v)] as [number, number])
      .filter(([i]) => i >= 0 && i < URGENCIA_NIVEIS.length)
    let urgenciaScore: number | null = null
    if (paresUrg.length) {
      const idx = paresUrg.sort((x, y) => y[1] - x[1])[0][0]
      urgenciaScore = ESCALA_URG[idx] ?? null
    }
    // Fallback: se a API já devolveu score direto (sem criteria), normaliza também.
    // Se veio 0-3 (índice de legenda curta): usa ESCALA_URG; senão: próprio valor.
    if (urgenciaScore == null) {
      const raw = typeof ug.score === 'number' ? Math.round(ug.score) : null
      urgenciaScore = (raw != null && raw <= 3 && raw >= 0)
        ? (ESCALA_URG[raw] ?? raw)
        : (raw ?? null)
    }
    if (urgenciaScore == null) throw new Error('urgencia score unavailable')

    // ---- parse coerencia (espelha tools/jev:cmd_yes:113-116) ----
    // NOTE: noul é um NÚMERO; coerente = noul >= 0.5 (NÃO boolean .result).
    let cr: boolean | null = null
    if (nota != null) {
      const co = j?.answers?.coerente
      if (!co || typeof co.noul !== 'number') throw new Error('coerencia noul missing')
      cr = co.noul >= 0.5
    }

    return { topico: [tp.choice, confTopico], urgencia: urgenciaScore, coerente: cr }
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    // ---------- auth: JWT + admin ----------
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'Sem sessão' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: u } = await sb.auth.getUser(jwt)
    const { data: perfil } = u?.user ? await sb.from('profiles').select('role').eq('id', u.user.id).single() : { data: null }
    if (perfil?.role !== 'admin') return json({ error: 'Só o administrador.' }, 403)

    // ---------- batch size ----------
    const key = Deno.env.get('TYPESAFE_API_KEY')
    if (!key) return json({ error: 'TYPESAFE_API_KEY não configurada' }, 500)

    const body = await req.json().catch(() => ({}))
    const tamanho = Math.min(Math.max(Number(body.lote) || 20, 1), 50)

    // ---------- fetch unlabelled rows ----------
    const { data: linhas, error: getErr } = await sb
      .from('pesquisa_respostas')
      .select('id, canal, nota, texto')
      .is('rotulado_em', null)
      .order('id', { ascending: false })
      .limit(tamanho)

    if (getErr) throw getErr

    if (!linhas || linhas.length === 0) {
      // Count still-unlabelled rows for the response.
      const { count: restantes } = await sb
        .from('pesquisa_respostas')
        .select('id', { count: 'exact', head: true })
        .is('rotulado_em', null)
      return json({ ok: true, analisadas: 0, erros: 0, restantes })
    }

    let analisadas = 0
    let erros = 0

    // ---------- label in chunks of 8 (padrão sugerir-fiscal:102-112) ----------
    for (let i = 0; i < linhas.length; i += 8) {
      const lote = await Promise.all(linhas.slice(i, i + 8).map(async (linha) => {
        try {
          const { topico, urgencia, coerente } = await perguntar(key, linha.nota, linha.texto || '', linha.canal)

          const confTopico = topico[1] ?? 0
          const confUrgencia = 1
          const confianca = Math.min(confTopico, confUrgencia)

          // espelha rotação do banco — checar erro do update
          const { error: updErr } = await sb.from('pesquisa_respostas')
            .update({
              topico: topico[0],
              urgencia,
              coerente,
              confianca,
              rotulado_em: new Date().toISOString(),
            })
            .eq('id', linha.id)

          if (updErr) throw updErr

          return true
        } catch (_e) {
          return false
        }
      }))
      for (const ok of lote) {
        if (ok) analisadas++
        else erros++
      }
    }

    // ---------- remaining count ----------
    const { count: restantes } = await sb
      .from('pesquisa_respostas')
      .select('id', { count: 'exact', head: true })
      .is('rotulado_em', null)

    return json({ ok: true, analisadas, erros, restantes })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
