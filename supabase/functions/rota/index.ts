// Dupuro — Edge Function: rotas de entrega (admin)
// ==========================================================================
// Junta, por dia e período, as entregas do delivery (pagas/confirmadas) e os
// pedidos de revendedor confirmados com entrega, e monta a rota saindo e
// voltando pra fábrica na ordem mais rápida:
//   1. otimizador VROOM do OpenRouteService (distâncias reais de carro);
//   2. se ele falhar: matriz de tempos do ORS + busca exata (até 8 paradas) ou
//      vizinho mais próximo + 2-opt;
//   3. traçado (Directions) pra desenhar no mapa e estimar a chegada em cada parada.
// Endereço de revendedor é texto: vira ponto pelo Pelias, e o Jev (TypeSafe,
// Choice) escolhe entre os candidatos o que é o mesmo lugar — só o endereço vai
// pro Jev, nunca nome/telefone. Ponto duvidoso volta com `geo_alerta` pro admin
// conferir/arrastar no mapa. O delivery já tem o ponto da cotação do cliente.
// Depois de ordenar, o Jev dá uma segunda opinião (rota escolhida x outras
// ordens, com os km) que aparece pro admin em `rotas.avaliacao`.
//
// Ações (POST {acao}): montar {dia, periodo} · recalcular {rota_id, ordem?} ·
// mover_pin {parada_id, lat, lng} · iniciar {rota_id} · parada {parada_id,
// feita|pulada|reabrir, recebido_forma?}. Só admin (JWT conferido aqui).
// Secrets: ORS_API_KEY; TYPESAFE_API_KEY (opcional, Jev).
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const ORS = 'https://api.heigit.org'
const AREA = { minLon: -56.32, maxLon: -55.85, minLat: -15.85, maxLat: -15.40 }
const naArea = (lat: number, lng: number) => lat >= AREA.minLat && lat <= AREA.maxLat && lng >= AREA.minLon && lng <= AREA.maxLon
const SERVICO_S = 300 // ~5 min em cada parada
const INICIO: Record<string, string> = { manha: '08:00', tarde: '13:00' }
type Pt = { lat: number, lng: number }

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

// ---------- Geocodificação (endereço de revendedor) ----------
async function pelias(texto: string, key: string) {
  const u = `${ORS}/pelias/v1/search?size=5&boundary.country=BRA&lang=pt` +
    `&boundary.rect.min_lon=${AREA.minLon}&boundary.rect.max_lon=${AREA.maxLon}&boundary.rect.min_lat=${AREA.minLat}&boundary.rect.max_lat=${AREA.maxLat}` +
    `&focus.point.lat=-15.61&focus.point.lon=-56.07&text=${encodeURIComponent(texto)}`
  const r = await fetch(u, { headers: { Authorization: key, Accept: 'application/json' } }).catch(() => null)
  if (!r || !r.ok) return []
  const j = await r.json()
  return (j.features || []).map((f: any) => ({
    lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    layer: f.properties.layer as string, label: f.properties.label as string,
  })).filter((f: any) => naArea(f.lat, f.lng) && ['address', 'street', 'venue', 'neighbourhood'].includes(f.layer))
}

// Jev: qual candidato é o mesmo lugar do endereço digitado (índice, -1 nenhum, null dúvida).
async function escolherCandidato(digitado: string, cands: { label: string }[]): Promise<number | null> {
  const key = Deno.env.get('TYPESAFE_API_KEY')
  if (!key || !cands.length) return null
  const criteria: Record<string, string> = {}
  cands.forEach((c, i) => { criteria['c' + i] = c.label })
  criteria.nenhum = "None of the candidates is the customer's address."
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: 'Delivery address typed by a reseller in Cuiabá/Várzea Grande (MT, Brazil): ' + digitado,
        questions: {
          lugar: {
            type: 'choice',
            instructions: 'Which candidate from the map search is the same place as the typed address? ' +
              "Same street (abbreviations like R., Av. and accents don't matter), same house number when there is one, " +
              "same neighbourhood or city. Pick 'nenhum' if none is that place.",
            criteria,
          },
        },
      }),
    })
    if (!r.ok) return null
    const a = (await r.json())?.answers?.lugar
    if (!a || !(a.choice in criteria)) return null
    if (a.choice === 'nenhum') return a.confidence >= 0.7 ? -1 : null
    return a.confidence >= 0.5 ? Number(a.choice.slice(1)) : null
  } catch (_e) { return null } finally { clearTimeout(timer) }
}

async function geocodificar(sb: any, key: string, endereco: string, cidade: string) {
  const texto = [endereco, cidade || 'Cuiabá', 'MT'].filter(Boolean).join(', ')
  const chave = semAcento(texto)
  const { data: c } = await sb.from('geo_enderecos').select('lat, lng, label, fonte').eq('chave', chave).maybeSingle()
  if (c) return { lat: c.lat, lng: c.lng, fonte: c.fonte === 'manual' ? 'manual' : 'mapa', alerta: null }
  let achados = await pelias(texto, key)
  const escolha = await escolherCandidato(texto, achados)
  if (escolha === -1) return null
  if (escolha != null) achados = [achados[escolha], ...achados.filter((_: any, i: number) => i !== escolha)]
  const exato = achados.find((f: any) => f.layer === 'address' || f.layer === 'venue')
  const ponto = exato || achados[0]
  if (!ponto) return null
  const alerta = exato ? (escolha == null ? 'Ponto achado sem confirmação: confira no mapa' : null) : 'Achamos só a rua ou o bairro: confira o ponto no mapa'
  await sb.from('geo_enderecos').upsert({ chave, lat: ponto.lat, lng: ponto.lng, label: ponto.label, fonte: 'mapa', atualizado_em: new Date().toISOString() })
  return { lat: ponto.lat, lng: ponto.lng, fonte: 'mapa', alerta }
}

// ---------- Ordem ----------
async function vroom(key: string, origem: Pt, pts: Pt[]): Promise<number[] | null> {
  const body = {
    jobs: pts.map((p, i) => ({ id: i + 1, location: [p.lng, p.lat], service: SERVICO_S })),
    vehicles: [{ id: 1, profile: 'driving-car', start: [origem.lng, origem.lat], end: [origem.lng, origem.lat] }],
  }
  for (const url of [`${ORS}/openrouteservice/optimization`, `${ORS}/optimization`, 'https://api.openrouteservice.org/optimization']) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) continue
      const j = await r.json()
      const steps = j?.routes?.[0]?.steps
      if (!Array.isArray(steps)) continue
      const ordem = steps.filter((s: any) => s.type === 'job').map((s: any) => s.job ?? s.id).map((id: number) => id - 1)
      for (const u of (j.unassigned || [])) ordem.push(u.id - 1)
      if (ordem.length === pts.length) return ordem
    } catch (_e) { /* tenta o próximo */ }
  }
  return null
}

async function matriz(key: string, pts: Pt[]): Promise<number[][] | null> {
  try {
    const r = await fetch(`${ORS}/openrouteservice/v2/matrix/driving-car`, {
      method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ locations: pts.map((p) => [p.lng, p.lat]), metrics: ['duration'] }),
    })
    if (!r.ok) return null
    return (await r.json())?.durations || null
  } catch { return null }
}

// D[0] = fábrica; volta pra ela no fim. Devolve a ordem das paradas (índices 0..n-1).
function resolver(D: number[][]): number[] {
  const n = D.length - 1
  const custo = (o: number[]) => { let c = D[0][o[0] + 1]; for (let i = 1; i < o.length; i++) c += D[o[i - 1] + 1][o[i] + 1]; return c + D[o[o.length - 1] + 1][0] }
  const base = [...Array(n).keys()]
  if (n <= 1) return base
  if (n <= 8) { // exata
    let melhor = base.slice(), mc = custo(base)
    const perm = (a: number[], k: number) => {
      if (k === a.length) { const c = custo(a); if (c < mc) { mc = c; melhor = a.slice() } return }
      for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; perm(a, k + 1); [a[k], a[i]] = [a[i], a[k]] }
    }
    perm(base.slice(), 0)
    return melhor
  }
  // vizinho mais próximo + 2-opt
  const resta = new Set(base), o: number[] = []
  let atual = 0
  while (resta.size) {
    let m = -1, mv = Infinity
    for (const j of resta) if (D[atual][j + 1] < mv) { mv = D[atual][j + 1]; m = j }
    o.push(m); resta.delete(m); atual = m + 1
  }
  let melhorou = true
  while (melhorou) {
    melhorou = false
    for (let i = 0; i < n - 1; i++) for (let k = i + 1; k < n; k++) {
      const nova = o.slice(0, i).concat(o.slice(i, k + 1).reverse(), o.slice(k + 1))
      if (custo(nova) + 1 < custo(o)) { o.splice(0, n, ...nova); melhorou = true }
    }
  }
  return o
}

async function otimizar(key: string, origem: Pt, pts: Pt[]): Promise<{ ordem: number[], metodo: string }> {
  if (pts.length <= 1) return { ordem: pts.map((_, i) => i), metodo: 'direta' }
  const v = await vroom(key, origem, pts)
  if (v) return { ordem: v, metodo: 'vroom' }
  const D = await matriz(key, [origem, ...pts])
  if (D) return { ordem: resolver(D), metodo: 'matriz' }
  return { ordem: pts.map((_, i) => i), metodo: 'sem_otimizacao' }
}

// Traçado da volta completa: legs[i] = trecho até a parada i (o último volta pra fábrica).
async function tracar(key: string, inicio: Pt, pts: Pt[], fim: Pt) {
  const coords = [inicio, ...pts, fim].map((p) => [p.lng, p.lat])
  try {
    const r = await fetch(`${ORS}/openrouteservice/v2/directions/driving-car/geojson`, {
      method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' },
      body: JSON.stringify({ coordinates: coords, radiuses: coords.map(() => 1000) }),
    })
    if (!r.ok) return null
    const f = (await r.json())?.features?.[0]
    if (!f) return null
    const linha: number[][] = f.geometry.coordinates
    const passo = Math.max(1, Math.ceil(linha.length / 600))
    return {
      geometria: linha.filter((_, i) => i % passo === 0 || i === linha.length - 1).map((c) => [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5]),
      legs: (f.properties.segments || []).map((s: any) => ({ duracao: Number(s.duration) || 0, distancia: Number(s.distance) || 0 })),
      distancia_km: Math.round((Number(f.properties.summary?.distance) || 0) / 100) / 10,
      duracao_min: Math.round(((Number(f.properties.summary?.duration) || 0) + pts.length * SERVICO_S) / 60),
    }
  } catch { return null }
}

// Segunda opinião do Jev (Score + Noul). Sozinho ele não conhece a geografia
// da cidade (no teste respondeu com confiança 0), então recebe a rota escolhida
// COMPARADA com outras ordens possíveis — a ordem em que os pedidos chegaram e
// "ir sempre no mais perto" — com os km de cada uma, medidos pela matriz de
// distâncias reais do ORS. Só endereços e km vão pro Jev. Não muda a ordem:
// só avisa o admin, e a tela só mostra a nota com confiança >= 0,5.
const NIVEIS = ['much worse than the alternatives', 'worse than at least one alternative', 'about the same as the best alternative', 'better than the alternatives', 'clearly the cheapest option']
async function matrizKm(key: string, pts: Pt[]): Promise<number[][] | null> {
  try {
    const r = await fetch(`${ORS}/openrouteservice/v2/matrix/driving-car`, {
      method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ locations: pts.map((p) => [p.lng, p.lat]), metrics: ['distance'] }),
    })
    if (!r.ok) return null
    return (await r.json())?.distances || null
  } catch { return null }
}
async function avaliarComJev(key: string, inicio: Pt, fim: Pt, pend: any[]) {
  const jevKey = Deno.env.get('TYPESAFE_API_KEY')
  if (!jevKey || pend.length < 3) return null
  const M = await matrizKm(key, [inicio, ...pend, fim]) // 0 = início, 1..n = paradas, n+1 = fábrica
  if (!M) return null
  const n = pend.length
  const km = (ordem: number[]) => {
    let m = M[0][ordem[0] + 1]
    for (let i = 1; i < ordem.length; i++) m += M[ordem[i - 1] + 1][ordem[i] + 1]
    return Math.round((m + M[ordem[ordem.length - 1] + 1][n + 1]) / 100) / 10
  }
  const escolhida = [...Array(n).keys()]
  const chegada = escolhida.slice().sort((a, b) => String(pend[a].ref).localeCompare(String(pend[b].ref)))
  const perto: number[] = [], resta = new Set(escolhida)
  let atual = 0
  while (resta.size) { let mj = -1, mv = Infinity; for (const j of resta) if (M[atual][j + 1] < mv) { mv = M[atual][j + 1]; mj = j } perto.push(mj); resta.delete(mj); atual = mj + 1 }
  const kmE = km(escolhida), kmC = km(chegada), kmP = km(perto)
  const nome = (o: number[]) => o.map((i) => 'stop ' + (i + 1)).join(' → ')
  const linhas = pend.map((p, i) => `Stop ${i + 1}: ${p.endereco || 'address unknown'}`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + jevKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: 'One car delivers açaí in Cuiabá/Várzea Grande (MT, Brazil), leaving from and returning to the factory. Stops:\n' + linhas.join('\n') +
          '\n\nDriving distances measured on real roads for three possible orders:' +
          `\n- CHOSEN order (${nome(escolhida)}): ${kmE} km` +
          `\n- order the orders arrived (${nome(chegada)}): ${kmC} km` +
          `\n- always go to the nearest next stop (${nome(perto)}): ${kmP} km`,
        questions: {
          economia: {
            type: 'score',
            instructions: 'Comparing the driving distances, how economical is the CHOSEN order against the other two orders?',
            criteria: NIVEIS,
          },
          zigue: {
            type: 'noul',
            instructions: 'Is the CHOSEN order longer than at least one of the other two orders?',
          },
        },
      }),
    })
    const base = { km_escolhida: kmE, km_ordem_pedidos: kmC, km_mais_perto: kmP, em: new Date().toISOString() }
    if (!r.ok) return base
    const a = (await r.json())?.answers || {}
    const sc = a.economia, zg = a.zigue
    if (!sc) return base
    // Nota 0..4 = nível mais provável (probabilities vem com chaves "0".."4").
    const pares = Object.entries(sc.probabilities || {}).map(([k, v]) => [Number(k), Number(v)] as [number, number]).filter(([i]) => i >= 0 && i < NIVEIS.length)
    const nota = pares.length ? pares.sort((x, y) => y[1] - x[1])[0][0] : (typeof sc.score === 'number' ? Math.round(sc.score) : null)
    return { ...base, nota, score: sc.score ?? null, confianca: sc.confidence ?? null, pior_que_alternativa: typeof zg?.noul === 'number' ? zg.noul : null }
  } catch (_e) { return { km_escolhida: kmE, km_ordem_pedidos: kmC, km_mais_perto: kmP } } finally { clearTimeout(timer) }
}

function inicioDoPeriodo(dia: string, periodo: string): Date {
  const d = new Date(`${dia}T${INICIO[periodo] || '08:00'}:00-04:00`)
  return d.getTime() < Date.now() ? new Date() : d
}

// Recalcula ordem/ETA/traçado das paradas pendentes a partir de `inicio`.
async function recalcular(sb: any, key: string, rotaId: number, origem: Pt, opts: { ordemIds?: number[], inicio?: Pt, base?: Date } = {}) {
  const { data: rota } = await sb.from('rotas').select('*').eq('id', rotaId).single()
  const { data: todas } = await sb.from('rota_paradas').select('*').eq('rota_id', rotaId).order('ordem')
  const feitas = (todas || []).filter((p: any) => p.status !== 'pendente')
  let pend = (todas || []).filter((p: any) => p.status === 'pendente' && p.lat != null)
  const semPonto = (todas || []).filter((p: any) => p.status === 'pendente' && p.lat == null)
  if (opts.ordemIds) {
    const pos = new Map(opts.ordemIds.map((id, i) => [Number(id), i]))
    pend.sort((a: any, b: any) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999))
  }
  const inicio = opts.inicio || origem
  const base = opts.base || (rota.status === 'em_andamento' ? new Date() : inicioDoPeriodo(rota.dia, rota.periodo))
  const t = pend.length ? await tracar(key, inicio, pend, origem) : null
  let acum = 0
  const ups = pend.map((p: any, i: number) => {
    acum += (t?.legs[i]?.duracao || 0) + (i > 0 ? SERVICO_S : 0)
    return { id: p.id, ordem: feitas.length + i + 1, eta: t ? new Date(base.getTime() + acum * 1000).toISOString() : null }
  })
  semPonto.forEach((p: any, i: number) => ups.push({ id: p.id, ordem: 1000 + i, eta: null }))
  for (const u of ups) await sb.from('rota_paradas').update({ ordem: u.ordem, eta: u.eta }).eq('id', u.id)
  const avaliacao = t ? await avaliarComJev(key, inicio, origem, pend) : null
  await sb.from('rotas').update({
    geometria: t?.geometria || null, distancia_km: t?.distancia_km ?? null, duracao_min: t?.duracao_min ?? null, avaliacao,
  }).eq('id', rotaId)
}

async function carregar(sb: any, rotaId: number) {
  const { data: rota } = await sb.from('rotas').select('*').eq('id', rotaId).single()
  const { data: paradas } = await sb.from('rota_paradas').select('*').eq('rota_id', rotaId).order('ordem')
  return { rota, paradas: paradas || [] }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = await sb.auth.getUser(jwt)
    const { data: perfil } = u?.user ? await sb.from('profiles').select('role').eq('id', u.user.id).single() : { data: null }
    if (perfil?.role !== 'admin') return json({ error: 'Só o admin mexe nas rotas.' }, 403)

    const key = Deno.env.get('ORS_API_KEY')
    if (!key) return json({ error: 'Falta a chave do mapa (ORS_API_KEY).' }, 503)
    const b = await req.json().catch(() => ({}))
    const { data: row } = await sb.from('delivery_config').select('config').eq('id', 1).single()
    const origem: Pt = { lat: Number(row?.config?.origem?.lat), lng: Number(row?.config?.origem?.lng) }
    if (!Number.isFinite(origem.lat)) return json({ error: 'Localização da fábrica não configurada.' }, 500)

    // ---------- montar ----------
    if (b.acao === 'montar') {
      const dia = String(b.dia || ''), periodo = String(b.periodo || '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !INICIO[periodo]) return json({ error: 'Escolha o dia e o período.' }, 400)
      const { data: existente } = await sb.from('rotas').select('id, status').eq('dia', dia).eq('periodo', periodo).maybeSingle()
      if (existente && existente.status !== 'planejada') return json({ error: existente.status === 'concluida' ? 'Essa rota já foi concluída.' : 'Essa rota já começou. Mude a ordem das paradas que faltam arrastando na lista.' }, 409)

      const paradas: any[] = []
      const { data: dl } = await sb.from('delivery_pedidos')
        .select('codigo, cliente_nome, cliente_telefone, endereco, complemento, lat, lng, status')
        .eq('data_entrega', dia).eq('periodo', periodo).in('status', ['pago', 'em_rota'])
      for (const d of dl || []) {
        const ok = d.lat != null && naArea(d.lat, d.lng)
        paradas.push({ tipo: 'delivery', ref: d.codigo, nome: d.cliente_nome, telefone: d.cliente_telefone,
          endereco: d.endereco + (d.complemento ? ' · ' + d.complemento : ''), lat: ok ? d.lat : null, lng: ok ? d.lng : null,
          geo_fonte: ok ? 'pedido' : null, geo_alerta: ok ? null : 'Sem localização: marque no mapa' })
      }
      const { data: ords } = await sb.from('orders').select('numero, revendedor_id, entrega_info, status')
        .eq('origem', 'revendedor').in('status', ['processando', 'enviado'])
        .eq('entrega_info->>tipo', 'entrega').eq('entrega_info->>data', dia).eq('entrega_info->>turno', periodo)
      const porNum = new Map<string, any>()
      for (const o of ords || []) if (!porNum.has(o.numero)) porNum.set(o.numero, o)
      const naoConfirmados = [...porNum.values()].filter((o) => o.status === 'enviado').map((o) => o.numero)
      const confirmados = [...porNum.values()].filter((o) => o.status === 'processando')
      const ids = [...new Set(confirmados.map((o) => o.revendedor_id).filter(Boolean))]
      const { data: profs } = ids.length ? await sb.from('profiles').select('id, nome, empresa, telefone, endereco, cidade').in('id', ids) : { data: [] }
      const pPorId = new Map((profs || []).map((p: any) => [p.id, p]))
      for (const o of confirmados) {
        const p: any = pPorId.get(o.revendedor_id) || {}
        const end = String(o.entrega_info?.endereco || p.endereco || '').trim()
        const g = end ? await geocodificar(sb, key, end, p.cidade || '') : null
        paradas.push({ tipo: 'revenda', ref: o.numero, nome: p.empresa || p.nome || 'Revendedor', telefone: p.telefone || null,
          endereco: end || null, lat: g?.lat ?? null, lng: g?.lng ?? null, geo_fonte: g?.fonte || null,
          geo_alerta: !end ? 'Revendedor sem endereço cadastrado' : !g ? 'Endereço não achado no mapa: marque o ponto' : g.alerta })
      }

      const comPonto = paradas.filter((p) => p.lat != null)
      const { ordem, metodo } = await otimizar(key, origem, comPonto)
      const ordenadas = ordem.map((i) => comPonto[i]).concat(paradas.filter((p) => p.lat == null))

      let rotaId = existente?.id
      if (!rotaId) {
        const { data: nova, error } = await sb.from('rotas').insert({ dia, periodo }).select('id').single()
        if (error) return json({ error: 'Não deu pra criar a rota.' }, 500)
        rotaId = nova.id
      }
      await sb.from('rota_paradas').delete().eq('rota_id', rotaId)
      if (ordenadas.length) await sb.from('rota_paradas').insert(ordenadas.map((p, i) => ({ ...p, rota_id: rotaId, ordem: i + 1 })))
      await recalcular(sb, key, rotaId!, origem)
      return json({ ...(await carregar(sb, rotaId!)), metodo, nao_confirmados: naoConfirmados, origem })
    }

    // ---------- recalcular (nova ordem arrastada pelo admin) ----------
    if (b.acao === 'recalcular') {
      const rotaId = Number(b.rota_id)
      const { data: pos } = await sb.from('rota_posicao').select('lat, lng, atualizado_em').eq('rota_id', rotaId).maybeSingle()
      const fresca = pos && Date.parse(pos.atualizado_em) > Date.now() - 5 * 60e3
      await recalcular(sb, key, rotaId, origem, { ordemIds: Array.isArray(b.ordem) ? b.ordem : undefined, inicio: fresca ? pos : undefined })
      return json({ ...(await carregar(sb, rotaId)), origem })
    }

    // ---------- mover o pino de uma parada ----------
    if (b.acao === 'mover_pin') {
      const lat = Number(b.lat), lng = Number(b.lng)
      if (!naArea(lat, lng)) return json({ error: 'O ponto precisa ficar em Cuiabá ou Várzea Grande.' }, 400)
      const { data: p } = await sb.from('rota_paradas').select('*').eq('id', Number(b.parada_id)).single()
      if (!p) return json({ error: 'Parada não encontrada.' }, 404)
      await sb.from('rota_paradas').update({ lat, lng, geo_fonte: 'manual', geo_alerta: null }).eq('id', p.id)
      if (p.tipo === 'revenda' && p.endereco) {
        const { data: o } = await sb.from('orders').select('revendedor_id').eq('numero', p.ref).limit(1).maybeSingle()
        const { data: prof } = o?.revendedor_id ? await sb.from('profiles').select('cidade').eq('id', o.revendedor_id).single() : { data: null }
        const chave = semAcento([p.endereco, prof?.cidade || 'Cuiabá', 'MT'].filter(Boolean).join(', '))
        await sb.from('geo_enderecos').upsert({ chave, lat, lng, label: p.endereco, fonte: 'manual', atualizado_em: new Date().toISOString() })
      }
      await recalcular(sb, key, p.rota_id, origem)
      return json({ ...(await carregar(sb, p.rota_id)), origem })
    }

    // ---------- iniciar ----------
    if (b.acao === 'iniciar') {
      const rotaId = Number(b.rota_id)
      const { data: rota } = await sb.from('rotas').select('*').eq('id', rotaId).single()
      if (!rota) return json({ error: 'Rota não encontrada.' }, 404)
      if (rota.status === 'concluida') return json({ error: 'Essa rota já foi concluída.' }, 409)
      const agora = new Date().toISOString()
      await sb.from('rotas').update({ status: 'em_andamento', iniciada_em: rota.iniciada_em || agora }).eq('id', rotaId)
      const { data: ps } = await sb.from('rota_paradas').select('ref').eq('rota_id', rotaId).eq('tipo', 'delivery').eq('status', 'pendente')
      const codigos = (ps || []).map((p: any) => p.ref)
      if (codigos.length) await sb.from('delivery_pedidos').update({ status: 'em_rota', saiu_em: agora, atualizado_em: agora }).in('codigo', codigos).eq('status', 'pago')
      await recalcular(sb, key, rotaId, origem, { base: new Date() })
      return json({ ...(await carregar(sb, rotaId)), origem })
    }

    // ---------- parada: feita / pulada / reabrir ----------
    if (b.acao === 'parada') {
      const { data: p } = await sb.from('rota_paradas').select('*').eq('id', Number(b.parada_id)).single()
      if (!p) return json({ error: 'Parada não encontrada.' }, 404)
      const agora = new Date().toISOString()
      const como = String(b.como || '')
      if (como === 'feita') {
        if (p.tipo === 'delivery') {
          const { data: d } = await sb.from('delivery_pedidos').select('pagar_na_entrega').eq('codigo', p.ref).single()
          const forma = ['dinheiro', 'debito', 'credito', 'pix'].includes(String(b.recebido_forma)) ? String(b.recebido_forma) : null
          if (d?.pagar_na_entrega && !forma) return json({ error: 'Diga como o cliente pagou.' }, 400)
          await sb.from('delivery_pedidos').update({ status: 'entregue', entregue_em: agora, atualizado_em: agora,
            ...(d?.pagar_na_entrega ? { recebido_forma: forma, recebido_em: agora } : {}) }).eq('codigo', p.ref).in('status', ['pago', 'em_rota'])
        } else {
          await sb.from('orders').update({ status: 'entregue' }).eq('numero', p.ref).eq('status', 'processando')
        }
        await sb.from('rota_paradas').update({ status: 'feita', chegou_em: agora }).eq('id', p.id)
      } else if (como === 'pulada') {
        await sb.from('rota_paradas').update({ status: 'pulada', chegou_em: agora }).eq('id', p.id)
      } else if (como === 'reabrir') {
        if (p.tipo === 'delivery') await sb.from('delivery_pedidos').update({ status: 'em_rota', entregue_em: null, recebido_forma: null, recebido_em: null, atualizado_em: agora }).eq('codigo', p.ref).eq('status', 'entregue')
        else await sb.from('orders').update({ status: 'processando' }).eq('numero', p.ref).eq('status', 'entregue')
        await sb.from('rota_paradas').update({ status: 'pendente', chegou_em: null }).eq('id', p.id)
        await sb.from('rotas').update({ status: 'em_andamento', concluida_em: null }).eq('id', p.rota_id).eq('status', 'concluida')
      } else return json({ error: 'Ação inválida.' }, 400)

      const { count } = await sb.from('rota_paradas').select('id', { count: 'exact', head: true }).eq('rota_id', p.rota_id).eq('status', 'pendente')
      if (!count) await sb.from('rotas').update({ status: 'concluida', concluida_em: agora }).eq('id', p.rota_id)
      else {
        const aqui = p.lat != null ? { lat: p.lat, lng: p.lng } : undefined
        await recalcular(sb, key, p.rota_id, origem, { inicio: como === 'reabrir' ? undefined : aqui, base: new Date() })
      }
      return json({ ...(await carregar(sb, p.rota_id)), origem })
    }

    if (b.acao === 'carregar') {
      const { data: r } = await sb.from('rotas').select('id').eq('dia', String(b.dia || '')).eq('periodo', String(b.periodo || '')).maybeSingle()
      return json(r ? { ...(await carregar(sb, r.id)), origem } : { rota: null, paradas: [], origem })
    }
    return json({ error: 'Ação inválida.' }, 400)
  } catch (e) {
    return json({ error: 'Falha na rota: ' + String((e as Error)?.message || e) }, 500)
  }
})
