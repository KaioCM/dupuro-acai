// Dupuro Açaí — Edge Function: sugere a classificação fiscal (perfil de
// FISCAL_PERFIS em area-cliente/admin.html) pelo nome + modo do produto.
// Este arquivo é o registro local; a função roda no Supabase (deploy via MCP).
//
// Quem decide é o Jev (TypeSafe, pergunta Choice). Validado em 2026-10-23
// (experimentos em experimentos/typesafe/): 25/25 no gabarito do banco, 27/27
// em nomes inventados e 23/23 em nomes que não aparecem nas descrições.
// Duas coisas fazem esse resultado: o contexto da loja (sem ele "Caixa de 2
// Litros" vira refrigerante) e a opção "custom" (sem ela energético, cerveja e
// colher descartável caem em "adicional" com confiança alta).
//
// Só sugere: o admin confere e salva. Só admin chama (cada chamada custa).
// A chave fica no secret TYPESAFE_API_KEY, nunca no navegador.
// Entrada: { nome, modo }  ·  Saída: { perfil, confianca, probabilidades, modelo }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Em inglês: é a língua principal do Jev (o nome do produto vai em português).
const SHOP = 'Dupuro Açaí, an açaí factory and shop in Brazil. Unless the name says otherwise, ' +
  "boxes (caixa), tubs (pote), cups (copo), bowls (tigela) and 'marmitas' contain açaí or cream ice cream."
const MODO: Record<string, string> = {
  embalado: 'packaged item sold by the unit',
  copo: 'cup or bowl assembled and served in the shop, with toppings',
  peso: 'self-service sold by weight (price per kg)',
}
// Chaves = ids de FISCAL_PERFIS + 'custom' (= "Personalizado" na tela).
const CRITERIA = {
  acai: "Açaí or cream ice cream (sorvete). Includes any 'Creme de <flavor>' (cupuaçu, ninho, morango...) " +
    'sold in boxes or tubs by volume, cups, bowls and marmitas served in the shop, self-service by weight, popsicles.',
  agua: 'Bottled mineral or drinking water, still or sparkling.',
  refri: 'Carbonated soft drink (refrigerante).',
  granola: 'Granola or breakfast cereal sold packaged.',
  adicional: 'A small topping or complement put on the açaí (fruit, candy, chocolate, syrup, condensed milk, powdered milk, peanut).',
  custom: 'Anything that is not one of the options above; the tax codes must be entered by hand.',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'Sem sessão' }, 401)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: u } = await sb.auth.getUser(jwt)
    const { data: perfil } = u?.user ? await sb.from('profiles').select('role').eq('id', u.user.id).single() : { data: null }
    if (perfil?.role !== 'admin') return json({ error: 'Só o administrador.' }, 403)

    const body = await req.json().catch(() => ({}))
    const nome = typeof body.nome === 'string' ? body.nome.trim() : ''
    const modo = typeof body.modo === 'string' ? body.modo : ''
    if (!nome || nome.length > 120) return json({ error: 'Nome inválido' }, 400)
    if (!MODO[modo]) return json({ error: 'Modo inválido' }, 400)

    const key = Deno.env.get('TYPESAFE_API_KEY')
    if (!key) return json({ error: 'TYPESAFE_API_KEY não configurada' }, 500)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    let r: Response
    try {
      r = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'jev-latest',
          state: { shop: SHOP, product_name: nome, sale_mode: MODO[modo] },
          questions: {
            perfil: {
              type: 'choice',
              instructions: 'Which tax profile (Brazilian NFC-e) fits the product in `product_name`?',
              criteria: CRITERIA,
            },
          },
        }),
      })
    } finally {
      clearTimeout(timer)
    }
    if (!r.ok) return json({ error: 'TypeSafe ' + r.status }, 502)
    const j = await r.json()
    const a = j?.answers?.perfil
    if (!a || !(a.choice in CRITERIA)) return json({ error: 'Resposta inesperada' }, 502)
    return json({ perfil: a.choice, confianca: a.confidence, probabilidades: a.probabilities, modelo: j.model })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
