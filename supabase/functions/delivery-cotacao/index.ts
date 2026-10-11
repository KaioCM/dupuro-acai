// Dupuro Delivery — Edge Function: cotação de entrega (distância + taxa)
// ==========================================================================
// Público (cliente anônimo do site /delivery). Recebe o endereço (texto) ou o
// ponto escolhido no autocompletar (lat/lng/place_id), calcula a distância DE
// CARRO da loja até lá (Google Routes API) e aplica a tabela de taxa da
// delivery_config. Devolve a cotação ASSINADA (HMAC) — o checkout só aceita
// cotação assinada, então o cliente não consegue alterar km/taxa no navegador.
//
// Secrets: GOOGLE_MAPS_KEY (chave de servidor: Geocoding + Routes).
// ==========================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

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

async function geocode(endereco: string, gkey: string) {
  const u = 'https://maps.googleapis.com/maps/api/geocode/json?language=pt-BR&region=br&components=country:BR'
    + '&bounds=-15.80,-56.25|-15.40,-55.85&address=' + encodeURIComponent(endereco) + '&key=' + gkey
  const r = await (await fetch(u)).json()
  if (r.status !== 'OK' || !r.results?.length) return null
  const g = r.results[0]
  return { lat: g.geometry.location.lat, lng: g.geometry.location.lng, formatado: g.formatted_address as string, place_id: g.place_id as string,
           impreciso: g.partial_match === true || !(g.types || []).some((t: string) => ['street_address', 'premise', 'subpremise'].includes(t)) }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const gkey = Deno.env.get('GOOGLE_MAPS_KEY')
    if (!gkey) return json({ error: 'O cálculo de entrega ainda está sendo configurado. Fale com a gente no WhatsApp (65) 99288-8228.' }, 503)
    const body = await req.json().catch(() => ({}))
    const endereco = String(body.endereco || '').trim().slice(0, 300)
    if (endereco.length < 6 && !(body.lat && body.lng)) return json({ error: 'Informe o endereço.' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: row } = await sb.from('delivery_config').select('config').eq('id', 1).single()
    const cfg: any = row?.config
    if (!cfg || cfg.ativo === false) return json({ error: 'Delivery pausado no momento.' }, 503)

    // Origem (loja): geocodifica uma vez e guarda na config.
    let { lat: oLat, lng: oLng } = cfg.origem || {}
    if (oLat == null || oLng == null) {
      const o = await geocode(cfg.origem.endereco, gkey)
      if (!o) return json({ error: 'Endereço da loja não localizado (config).' }, 500)
      oLat = o.lat; oLng = o.lng
      cfg.origem = { ...cfg.origem, lat: oLat, lng: oLng }
      await sb.from('delivery_config').update({ config: cfg, atualizado_em: new Date().toISOString() }).eq('id', 1)
    }

    // Destino: ponto do autocompletar ou geocodificação do texto.
    let dest: any
    if (typeof body.lat === 'number' && typeof body.lng === 'number') {
      dest = { lat: body.lat, lng: body.lng, formatado: endereco, place_id: body.place_id || null, impreciso: false }
    } else {
      dest = await geocode(endereco, gkey)
      if (!dest) return json({ atende: false, mensagem: 'Não encontramos esse endereço. Confira rua, número e bairro.' })
    }

    // Distância de carro (Routes API).
    const rr = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': gkey, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: oLat, longitude: oLng } } },
        destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'pt-BR', units: 'METRIC',
      }),
    }).then((r) => r.json())
    const metros = rr?.routes?.[0]?.distanceMeters
    if (!metros) return json({ atende: false, mensagem: 'Não conseguimos traçar a rota até esse endereço.' })
    const km = Math.round(metros / 100) / 10
    const taxa = calcTaxa(km, cfg.taxa)
    if (taxa == null) return json({ atende: false, km, mensagem: `Esse endereço fica a ${String(km).replace('.', ',')} km — por enquanto entregamos até ${cfg.taxa.max_km} km da loja.` })

    const exp = Date.now() + 2 * 3600e3 // cotação vale 2h
    const base = [dest.lat.toFixed(6), dest.lng.toFixed(6), km, taxa, exp].join('|')
    return json({
      atende: true, km, taxa, lat: dest.lat, lng: dest.lng, place_id: dest.place_id,
      endereco_formatado: dest.formatado, impreciso: dest.impreciso,
      cotacao: { exp, assinatura: await hmac(base) },
    })
  } catch (e) {
    return json({ error: 'Falha ao calcular a entrega: ' + String((e as Error)?.message || e) }, 500)
  }
})
