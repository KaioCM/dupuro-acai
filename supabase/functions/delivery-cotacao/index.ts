// Dupuro Delivery — Edge Function: cotação de entrega (distância + taxa)
// ==========================================================================
// Público (cliente anônimo do site /delivery). Recebe o endereço em campos
// (rua, número, bairro, cidade, CEP), localiza o ponto no servidor e calcula a
// distância DE CARRO da loja até lá pelo OpenRouteService (mapas OpenStreetMap,
// chave grátis sem cartão). Aplica a tabela de taxa da delivery_config e devolve
// a cotação ASSINADA (HMAC) — o checkout só aceita cotação assinada, então o
// cliente não consegue alterar km/taxa no navegador. O ponto é sempre achado
// aqui (nunca aceito do cliente), pra ninguém mandar coordenada perto da loja.
//
// Localização (melhor primeiro):
//   1. Pelias (geocodificador do ORS) acertando o NÚMERO da casa;
//   2. coordenada do CEP (AwesomeAPI, grátis, sem chave) — no Brasil o CEP
//      costuma ser da rua/trecho, bem preciso pra taxa;
//   3. Pelias no nível da rua/bairro (marca impreciso).
//
// Secrets: ORS_API_KEY (openrouteservice.org → Dashboard → Tokens).
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const ORS = 'https://api.heigit.org'
// Área atendida (Cuiabá + Várzea Grande), usada pra filtrar a busca.
const AREA = { minLon: -56.32, maxLon: -55.85, minLat: -15.85, maxLat: -15.40 }
const naArea = (lat: number, lng: number) => lat >= AREA.minLat && lat <= AREA.maxLat && lng >= AREA.minLon && lng <= AREA.maxLon

// Taxa: base até km_base; depois por_km a cada km; arredonda pra cima em R$0,50.
function calcTaxa(km: number, t: any): number | null {
  if (km > Number(t.max_km)) return null
  const bruto = Number(t.base) + Math.max(0, km - Number(t.km_base)) * Number(t.por_km)
  return Math.ceil(bruto * 2) / 2
}

async function hmac(texto: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function pelias(texto: string, key: string) {
  const u = `${ORS}/pelias/v1/search?size=5&boundary.country=BRA&lang=pt` +
    `&boundary.rect.min_lon=${AREA.minLon}&boundary.rect.max_lon=${AREA.maxLon}&boundary.rect.min_lat=${AREA.minLat}&boundary.rect.max_lat=${AREA.maxLat}` +
    `&focus.point.lat=-15.61&focus.point.lon=-56.07&text=${encodeURIComponent(texto)}`
  const r = await fetch(u, { headers: { Authorization: key, Accept: 'application/json' } })
  if (!r.ok) return []
  const j = await r.json()
  return (j.features || []).map((f: any) => ({
    lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    layer: f.properties.layer as string, label: f.properties.label as string,
  })).filter((f: any) => naArea(f.lat, f.lng))
}

async function pontoDoCep(cep: string) {
  if (!/^\d{8}$/.test(cep)) return null
  try {
    const r = await fetch(`https://cep.awesomeapi.com.br/json/${cep}`)
    if (!r.ok) return null
    const j = await r.json()
    const lat = Number(j.lat), lng = Number(j.lng)
    return Number.isFinite(lat) && Number.isFinite(lng) && naArea(lat, lng) ? { lat, lng } : null
  } catch { return null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const key = Deno.env.get('ORS_API_KEY')
    if (!key) return json({ error: 'O cálculo de entrega ainda está sendo configurado. Fale com a gente no WhatsApp (65) 99288-8228.' }, 503)
    const body = await req.json().catch(() => ({}))
    const s = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
    const rua = s(body.rua), numero = s(body.numero, 20), bairro = s(body.bairro), cidade = s(body.cidade, 40)
    const cep = s(body.cep, 9).replace(/\D/g, '')
    const endereco = s(body.endereco, 300) || [rua && numero ? `${rua}, ${numero}` : rua, bairro, cidade, 'MT'].filter(Boolean).join(', ')
    if (!rua || !cidade) return json({ error: 'Informe o endereço completo.' }, 400)
    if (!['Cuiabá', 'Várzea Grande'].includes(cidade)) return json({ atende: false, mensagem: 'Por enquanto entregamos só em Cuiabá e Várzea Grande.' })

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: row } = await sb.from('delivery_config').select('config').eq('id', 1).single()
    const cfg: any = row?.config
    if (!cfg || cfg.ativo === false) return json({ error: 'Delivery pausado no momento.' }, 503)
    const oLat = Number(cfg.origem?.lat), oLng = Number(cfg.origem?.lng)
    if (!Number.isFinite(oLat) || !Number.isFinite(oLng)) return json({ error: 'Localização da loja não configurada.' }, 500)

    // 1) número exato; 2) CEP; 3) rua/bairro.
    const achados = await pelias(`${rua} ${numero}, ${bairro}, ${cidade}, MT`, key)
    let dest: any = achados.find((f: any) => f.layer === 'address')
    let impreciso = false
    if (!dest) {
      const c = await pontoDoCep(cep)
      if (c) dest = { ...c, label: null }
    }
    if (!dest && achados.length) { dest = achados[0]; impreciso = true }
    if (!dest) {
      const bb = await pelias(`${bairro}, ${cidade}, MT`, key)
      if (bb.length) { dest = bb[0]; impreciso = true }
    }
    if (!dest) return json({ atende: false, mensagem: 'Não encontramos esse endereço no mapa. Confira o CEP e o número ou fale com a gente no WhatsApp.' })

    // Distância de carro (ORS Directions).
    const rr = await fetch(`${ORS}/openrouteservice/v2/directions/driving-car`, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ coordinates: [[oLng, oLat], [dest.lng, dest.lat]], radiuses: [500, 500], units: 'm' }),
    }).then((r) => r.json()).catch(() => null)
    const metros = rr?.routes?.[0]?.summary?.distance
    if (metros == null) return json({ atende: false, mensagem: 'Não conseguimos traçar a rota até esse endereço. Fale com a gente no WhatsApp.' })
    const km = Math.round(metros / 100) / 10
    const taxa = calcTaxa(km, cfg.taxa)
    if (taxa == null) return json({ atende: false, km, mensagem: `Esse endereço fica a ${String(km).replace('.', ',')} km — por enquanto entregamos até ${cfg.taxa.max_km} km da loja.` })

    const exp = Date.now() + 2 * 3600e3 // cotação vale 2h
    const base = [dest.lat.toFixed(6), dest.lng.toFixed(6), km, taxa, exp].join('|')
    return json({
      atende: true, km, taxa, lat: dest.lat, lng: dest.lng, place_id: null,
      endereco_formatado: endereco, impreciso,
      cotacao: { exp, assinatura: await hmac(base) },
    })
  } catch (e) {
    return json({ error: 'Falha ao calcular a entrega: ' + String((e as Error)?.message || e) }, 500)
  }
})
