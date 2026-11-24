// Dupuro Açaí — Edge Function `assistente` (Puri) — F0 (abertura), F1 (dúvida, com histórico), F3 (visita), revenda (4B-1), converter, catálogo, F5/F6 (humano/limites).
// Registro local; roda no Supabase (deploy via MCP, verify_jwt = true: o anon key do site passa).
// Contrato e regras: docs/assistente/BASTIDORES.md. Jev (TypeSafe) decide; Haiku escreve só com os fatos de fatos.ts.
// Segredos: TYPESAFE_API_KEY (Jev) e ANTHROPIC_API_KEY (Haiku). Nunca logar chave nem texto do usuário.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AsyncLocalStorage } from 'node:async_hooks'
import { passoBloqueadoPorConsumo, mascarar, validarTexto, UUID_RE, ehSaude, ehSaudeLeite, ehSaudeGluten, perguntaDeRestricao, ehPendente, diaCuiaba, limparResposta, semMarcadores, normalizarIp, decidirAbertura, socialAbertura, validarVisita, empilharHistorico, historicoParaMessages, paresCompletos, normalizarCidade, decidirCaminho, checarResposta, montarFatos, cacheAposLeitura, cacheAposFalha, type CacheFatos, notasDaPergunta, respostaSemInfo, semPalpitePorAcai, juntarLog, normalizarSegmento, validarPerfil, calcularSimulacao, parseTopicos, parsePerguntasAprof, parsePalpite, parseAlternativasPalpite, ordenarAlternativas, parseResumo, parseMapa, setasDosNos, inserirNoContexto, montarPatch, TIPOS_MAPA, type MapaIA, validarPalpiteResp, limparIA, LIMIARES, aberturaAmbigua, validarInterpretar, decidirInterpretar, validarQualif, validarListaEspera, ehConfirmaAcai, parseCartoes, parsePerguntaEsclarecer, regraInicioMovimento, ordenarOpcoesCompra, topSegmentos, SEGMENTOS, CIDADES_VISITA, calcularEsforco, escolherDestino, normalizarTelefone, type EntradaDestino } from './logica.ts'
import type { Turno, LeituraJev, EntradaJev } from './logica.ts'
import { FATOS_LISTA } from './fatos.ts'
import { SHOP, CHIPS_FORA, TXT_RESERVA, TXT_SEM_FATO, TXT_SAUDE, TXT_SAUDE_LEITE, TXT_SAUDE_GLUTEN, TXT_PEDE_PESSOA, TXT_INSTAGRAM, NOTAS, MOTIVOS, SEGURA, JEV_ANTES, JEV_DEPOIS, PENDENTES_DEPOIS, sistemaHaikuFixo, mensagemFinalDuvida, JEV_ABERTURA, JEV_SEGMENTO, JEV_TIPO_OBJETIVO, JEV_ESCUTA, JEV_MELHOR_INSTR, JEV_PALPITE, JEV_PRIORIDADE, REGRAS_IA, SYS_TOPICOS, SYS_H3, SYS_H4, SYS_H5, SYS_H6, SYS_H7, TXT_ABERTURA_AMBIGUA, TXT_EXPLICA_COMPRA, JEV_ABERTURA_EMPRESA, jevInterpretar, JEV_LEITURA, JEV_LEITURA_CENA, SYS_CARTOES, JEV_CARTOES, MOTIVOS_CARTOES, NOTAS_DESENCONTRO, PERGUNTAS_ESCLARECER_FIXAS, SYS_ESCLARECER, JEV_ESCLARECER, MOTIVOS_ESCLARECER, SYS_H4_ALT, JEV_APROFUNDAR, MOTIVOS_PALPITE, j8Instr, motivoMapa, JEV_MAPA_TIPOS, JEV_OBJETIVO_VALE, JEV_RESUMO_INVENTA, MOTIVO_RESUMO, NOTA_OBJETIVO_MUDOU, JEV_CONSUMIDOR, JEV_PONTO_DEFINIDO, JEV_PROVAR } from './prompts.ts'

const ORIGENS = ['https://www.dupuroacai.com', 'https://dupuroacai.com', 'https://pws.dupuroacai.com', 'http://localhost:8855']
const corsDe = (req: Request) => {
  const o = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ORIGENS.includes(o) ? o : ORIGENS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

/* ── Estado POR REQUISIÇÃO (ambiente, modelo, acumuladores). Nada mutável de requisição fica em variável de módulo. ── */
type Amb = 'dev' | 'prod'
type CtxReq = { amb: Amb; modelo: string; haikuMax: boolean; sb: any; pend: Promise<unknown>[] }
const als = new AsyncLocalStorage<CtxReq>()
const rq = (): CtxReq => {
  const c = als.getStore()
  if (!c) throw new Error('sem contexto de requisição')
  return c
}
const modeloDe = (amb: Amb) => amb === 'dev' ? (Deno.env.get('ASSISTENTE_MODELO_DEV') || 'claude-haiku-5-5') : (Deno.env.get('ASSISTENTE_MODELO') || 'claude-haiku-5-5')

/** Preços em USD por milhão de tokens. */
const PRECOS: Record<string, { ent: number; sai: number; esc: number; lei: number }> = {
  'claude-haiku-5-5': { ent: 0.10, sai: 0.50, esc: 0.125, lei: 0.01 },
  'claude-haiku-4-5': { ent: 1, sai: 5, esc: 1.25, lei: 0.10 },
}
/** Preço pelo id do modelo (a API devolve com data, ex.: claude-haiku-4-5-20251001): chave mais longa de PRECOS que for prefixo. */
function precoDe(id: string) {
  let melhor = ''
  for (const k of Object.keys(PRECOS)) if (id.startsWith(k) && k.length > melhor.length) melhor = k
  return melhor ? PRECOS[melhor] : undefined
}
/** Código curto de erro para log (nunca texto livre). */
function codErro(e: unknown): string {
  const n = (e as Error)?.name, m = String((e as Error)?.message ?? '')
  if (n === 'AbortError' || n === 'TimeoutError') return 'timeout'
  const h = /^Anthropic (\d{3})/.exec(m); if (h) return 'haiku_http_' + h[1]
  const t = /^TypeSafe (\d{3})/.exec(m); if (t) return 'jev_http_' + t[1]
  if (m.startsWith('sem chave')) return 'sem_chave'
  return 'erro'
}
const JEV_USD_POR_MI_ENTRADA = 0.042
const JEV_MODELO = 'jev-1.13.0' // versão fixa do Jev em todas as chamadas e em puri_uso (jev-latest hoje = 1.14.0)
/** Trava de custo: teto mensal padrão (app_settings.puri_teto_usd) e limiar de aviso. */
const TETO_PADRAO_USD = 5
const TETO_AVISO = 0.8
const TETO_CACHE_MS = 60000

// Limites de volume (dev multiplica por MULT_LIMITES_DEV em limiteOk/lim; produção inalterada). Limiares do Jev: LIMIARES em logica.ts.
const MULT_LIMITES_DEV = 10
const lim = (n: number) => n * (rq().amb === 'dev' ? MULT_LIMITES_DEV : 1)
const LIMITE_CONVERSAS_DIA = 40 // conversas que chamam Jev/Haiku (contadas na 1ª mensagem)
const LIMITE_MSG_DIA = 800 // mensagens/dia globais que chamam Jev/Haiku
const LIMITE_MSG_CONVERSA = 60 // turnos BEM-SUCEDIDOS por conversa (turns só soma quando o passo deu certo)
const LIMITE_TOK_BRUTO = LIMITE_MSG_CONVERSA * 3 // teto de requisições por conversa (inclui falhas): impede repetição infinita
const LIMITE_INICIAR_IP_DIA = 10
const LIMITE_INICIAR_GLOBAL_DIA = 200 // teto folgado de criação (não consome o teto principal)
const LIMITE_MSG_IP_DIA = 150
const LIMITE_CATALOGO_IP_DIA = 60
const LIMITE_VISITA_IP_DIA = 3
const LIMITE_ESCUTAR_TOKEN = 4 // chamadas `escutar` com final:false por token (cota própria)
const LIMITE_ESCUTAR_IP_DIA = 40
const LIMITE_ESCUTAR_GLOBAL_DIA = 300
const LIMITE_CONVERTER_TOKEN = 3
const LIMITE_LISTA_ESPERA_IP_DIA = 3
const LIMITE_CONTATO_IP_DIA = 3 // passo contato ("Só quero que me chamem"), por IP
const LIMITE_INTERPRETAR_TOKEN = 12 // cota própria e leve do passo interpretar (não soma turno)
const LIMITE_INTERPRETAR_IP_DIA = 150
const LIMITE_INTERPRETAR_GLOBAL_DIA = 1500

const TXT_SOCIAL_CUMPRIMENTO = 'Oi, tudo bem? Eu sou a Puri. Me conta: você quer revender, comprar pra você, provar antes ou tirar uma dúvida?'
const TXT_SOCIAL_AGRADECIMENTO = 'Por nada! Se precisar de mais alguma coisa, é só falar.'
/** Log de motivo: só códigos curtos; nunca texto do usuário, token, IP ou resposta. */
const logPuri = (etapa: string, tipo: string, motivo: string, extra: Record<string, string> = {}) =>
  console.log(JSON.stringify({ ev: 'puri', etapa, tipo, motivo, ...extra }))
/* ── Jev (TypeSafe) ───────────────────────────────────────────────── */
/** Registro de uso (tabela puri_uso). Nunca derruba a resposta: falha = só log (sem texto do cliente). */
function registrarUso(servico: 'anthropic' | 'jev', funcao: string, modelo: string, t: { ent: number; sai: number; esc: number; lei: number }, estimado: boolean) {
  try {
    const c = rq()
    let custo: number
    let marca = estimado
    if (servico === 'jev') custo = t.ent * JEV_USD_POR_MI_ENTRADA / 1e6
    else {
      let p = precoDe(modelo) ?? precoDe(c.modelo)
      if (!p) { p = PRECOS['claude-haiku-4-5']; marca = true }
      custo = (t.ent * p.ent + t.sai * p.sai + t.esc * p.esc + t.lei * p.lei) / 1e6
    }
    const linha = { ambiente: c.amb, servico, funcao, modelo, input_tokens: t.ent, output_tokens: t.sai, cache_write_tokens: t.esc, cache_read_tokens: t.lei, estimado: marca, custo_usd: Number(custo.toFixed(6)) }
    c.pend.push(Promise.resolve(c.sb.from('puri_uso').insert(linha)).then((r: any) => { if (r?.error) console.error('uso gravar falha', String(r.error.code ?? '?')) }).catch(() => console.error('uso gravar falha')))
  } catch { console.error('uso registrar falha') }
}

/** Trava de custo: gasto do mês (dev+prod, fuso Cuiabá) vs teto; cache ~60 s por instância; falha = não bloqueia. */
let custoCache: { t: number; pct: number } | null = null
let custoErroT = 0 // falha aberta: cacheia o erro ~10 s para não repetir o RPC a cada requisição
async function tetoEstourado(): Promise<boolean> {
  try {
    if (!custoCache || Date.now() - custoCache.t > TETO_CACHE_MS) {
      if (Date.now() - custoErroT < 10000) return false
      const { data, error } = await rq().sb.rpc('puri_custo_mes_interno')
      const row = Array.isArray(data) ? data[0] : data
      if (error || !row) { console.error('custo mes falha'); custoErroT = Date.now(); return false }
      const teto = Number(row.teto) > 0 ? Number(row.teto) : TETO_PADRAO_USD
      custoCache = { t: Date.now(), pct: Number(row.gasto) / teto }
      if (custoCache.pct >= TETO_AVISO && custoCache.pct < 1) logPuri('custo', 'aviso', 'pct_80')
    }
    return custoCache.pct >= 1
  } catch { console.error('custo mes erro'); custoErroT = Date.now(); return false }
}

/** Modelos 5.x (Haiku 5.5): sem temperature/top_p/top_k, thinking desligado, max_tokens +30% (tokenizer novo). */
function ehModelo5x(modelo: string): boolean { return modelo.startsWith('claude-haiku-5') }
function corpoAnthropic(modelo: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (!ehModelo5x(modelo)) return { model: modelo, ...payload }
  const { temperature: _t, top_p: _p, top_k: _k, ...resto } = payload as Record<string, unknown>
  const mt = Number(resto.max_tokens)
  return { model: modelo, ...resto, ...(mt > 0 ? { max_tokens: Math.ceil(mt * 1.3) } : {}), thinking: { type: 'disabled' } }
}
/** Texto = só os blocos type 'text' (ignora 'thinking'). */
function textoAnthropic(j: any): string {
  return Array.isArray(j?.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => String(b?.text ?? '')).join('') : ''
}

/** Chamada à Anthropic (modelo do ambiente) com registro de uso. Devolve status e JSON; nunca registra texto. */
async function anthropic(funcao: string, payload: Record<string, unknown>, ms: number): Promise<{ ok: boolean; status: number; j: any }> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) throw new Error('sem chave Anthropic')
  const c = rq()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(corpoAnthropic(c.modelo, payload)),
    })
    if (!r.ok) {
      if (c.amb === 'dev') {
        // diagnóstico só em dev: tipo e mensagem do erro vêm da API (nunca texto do cliente/prompt)
        try {
          const ej = await r.json()
          console.error('anthropic erro', r.status, String(ej?.error?.type ?? ''), String(ej?.error?.message ?? '').slice(0, 200))
        } catch (_) { /* corpo ilegível */ }
      }
      return { ok: false, status: r.status, j: null }
    }
    const j = await r.json()
    const u = j?.usage ?? {}
    registrarUso('anthropic', funcao, String(j?.model || c.modelo), { ent: Number(u.input_tokens) || 0, sai: Number(u.output_tokens) || 0, esc: Number(u.cache_creation_input_tokens) || 0, lei: Number(u.cache_read_input_tokens) || 0 }, false)
    return { ok: true, status: r.status, j }
  } finally {
    clearTimeout(timer)
  }
}

async function jev(state: Record<string, unknown>, questions: Record<string, unknown>, funcao = 'jev'): Promise<any> {
  const key = Deno.env.get('TYPESAFE_API_KEY')
  if (!key) throw new Error('sem chave TypeSafe')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const corpo = JSON.stringify({ model: JEV_MODELO, state, questions })
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: corpo,
    })
    if (!r.ok) throw new Error('TypeSafe ' + r.status)
    const j = await r.json()
    const tk = Number(j?.usage?.input_tokens ?? j?.usage?.prompt_tokens)
    if (Number.isFinite(tk) && tk > 0) registrarUso('jev', funcao, JEV_MODELO, { ent: tk, sai: Number(j?.usage?.output_tokens ?? j?.usage?.completion_tokens) || 0, esc: 0, lei: 0 }, false)
    else registrarUso('jev', funcao, JEV_MODELO, { ent: Math.ceil(corpo.length / 4), sai: 0, esc: 0, lei: 0 }, true)
    return j?.answers ?? {}
  } finally {
    clearTimeout(timer)
  }
}
const noul = (a: any, k: string): number => {
  const v = a?.[k]?.noul
  if (typeof v !== 'number') throw new Error('noul ausente: ' + k)
  return v
}

/** J1 intenção + J11 humano; regra em decidirAbertura (logica.ts). O texto vai sem os marcadores [contato]/[nome]. */
async function classificarAbertura(texto: string, pagina: string, log: LogJev): Promise<{ intencao: string; ambiguo: boolean }> {
  const a = await jev(
    { shop: SHOP, page_of_site: pagina, customer_message: semMarcadores(texto) },
    { ...JEV_ABERTURA, empresa_sem_intencao: JEV_ABERTURA_EMPRESA },
  'jev_abertura')
  const j11 = noul(a, 'humano')
  const ch = a?.intencao?.choice
  const pr = a?.intencao?.probabilities
  const p = pr?.[ch] ?? a?.intencao?.confidence ?? 0
  const intencao = decidirAbertura(typeof ch === 'string' ? ch : undefined, typeof p === 'number' ? p : 0, j11)
  const num = (x: unknown) => typeof x === 'number' ? x : 0
  let empresa = 0
  try { empresa = noul(a, 'empresa_sem_intencao') } catch { empresa = 0 }
  const ambiguo = aberturaAmbigua(intencao, num(pr?.revender), num(pr?.consumir), empresa)
  jl(log, 'abertura', 'empresa_sem_intencao', empresa, empresa >= LIMIARES.EMPRESA_AMBIGUA_MIN ? 'ambigua' : 'nada')
  jl(log, 'abertura', 'revender_ou_consumir', num(pr?.revender), ambiguo ? 'pergunta_revender_ou_consumir' : 'segue')
  return { intencao, ambiguo }
}

/* ── Catálogo ao vivo (preços, sabores, delivery) para o Haiku/Jev; cache 5 min; falha → '' ── */
let cacheCtx: { t: number; v: string } | null = null
const okNum = (n: unknown) => n !== null && n !== '' && n !== undefined && Number.isFinite(Number(n))
const brl = (n: unknown) => okNum(n) ? 'R$ ' + Number(n).toFixed(2).replace('.', ',').replace(',00', '') : ''
async function contextoBanco(): Promise<string> {
  if (cacheCtx && Date.now() - cacheCtx.t < 300000) return cacheCtx.v
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: cfg } = await sb.from('delivery_config').select('config').eq('id', 1).maybeSingle()
    const c = cfg?.config
    if (!c) { cacheCtx = { t: Date.now() - 300000 + 60000, v: '' }; return '' } // falha: cache curto (60 s)
    const ids: number[] = Array.isArray(c.produtos) ? c.produtos.map(Number).filter(Number.isFinite) : []
    const { data: dels } = await sb.from('products').select('id, nome, preco').in('id', ids.length ? ids : [-1])
    const { data: atas } = await sb.from('products').select('id, nome, preco').eq('tipo', 'atacado').order('id')
    const { data: balc } = await sb.from('products').select('nome').eq('tipo', 'varejo').in('modo', ['copo', 'peso']).order('id')
    const { data: sab } = await sb.from('product_flavor_stock').select('sabor, estoque').in('produto_id', ids.length ? ids : [-1]).gt('estoque', 0)
    const L: string[] = ['CATÁLOGO AO VIVO (lido do sistema agora):']
    if (dels?.length) L.push('Preços do site para consumidor (delivery): ' + dels.filter((p: any) => okNum(p.preco)).sort((a: any, b: any) => Number(a.preco) - Number(b.preco)).map((p: any) => `${p.nome} ${brl(p.preco)}`).join('; ') + '.')
    const atac = (atas ?? []).filter((p: any) => okNum(p.preco) && Number(p.preco) > 0)
    if (atac.length) L.push('Atacado (revenda), preço por unidade: ' + atac.map((p: any) => `${p.nome} ${brl(p.preco)}`).join('; ') + '. Não existe mínimo por produto no atacado. A regra é: pedido de atacado soma no mínimo 30 L (caixas de 5 e 10 L somadas; granola e complementos não entram na conta), e o primeiro pedido não tem mínimo.')
    if (balc?.length) L.push('Só na loja física (não vendidos pelo site; não cite preço): ' + [...new Set(balc.map((x: any) => String(x.nome).trim()))].join(', ') + '.')
    const nomes = [...new Set((sab ?? []).map((x: any) => String(x.sabor).trim()).filter(Boolean))]
    if (nomes.length) L.push('Sabores com estoque hoje no delivery: ' + nomes.join(', ') + '.')
    const dn = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
    const dias = Array.isArray(c.dias) ? c.dias.map(Number).sort().map((d: number) => dn[d]).filter(Boolean) : []
    const h = (x: string) => String(x).replace(/^0/, '').replace(':00', 'h').replace(':', 'h')
    const jn: string[] = []
    for (const [k, nome] of [['manha', 'manhã'], ['tarde', 'tarde']] as const) { const j = c.janelas?.[k]; if (j) jn.push(`${nome} ${h(j.inicio)} às ${h(j.fim)} (pedido até ${h(j.corte)})`) }
    const t = c.taxa
    L.push(`Delivery: dias ${dias.join(', ')}; turnos ${jn.join(' e ')}.` + (t && okNum(t.base) && okNum(t.km_base) && okNum(t.por_km) && okNum(t.max_km) ? ` Taxa de entrega: ${brl(t.base)} até ${t.km_base} km, mais ${brl(t.por_km)} por km adicional, até ${t.max_km} km.` : '') + (okNum(c.pedido_minimo_delivery) && Number(c.pedido_minimo_delivery) > 0 ? ` Pedido mínimo do delivery: ${brl(c.pedido_minimo_delivery)} em produtos, sem contar a taxa.` : ''))
    const v = L.join('\n')
    cacheCtx = { t: Date.now(), v }
    return v
  } catch (e) { console.error('contextoBanco falha', codErro(e)); cacheCtx = { t: Date.now() - 300000 + 60000, v: '' }; return '' }
}

/* ── Fatos da Puri (tabela puri_fatos): dev lê rascunho, oficial lê publicado; cache por ambiente (60 s dev, 5 min prod); falha → código ── */
const cacheFatos: Partial<Record<Amb, CacheFatos>> = {}
const lendoFatos: Partial<Record<Amb, Promise<string>>> = {}
function carregarFatos(amb: Amb): Promise<string> {
  const c = cacheFatos[amb]
  if (c && Date.now() - c.t < c.ttl) return Promise.resolve(c.v)
  const andando = lendoFatos[amb]
  if (andando) return andando
  const p = lerFatos(amb).finally(() => { delete lendoFatos[amb] })
  lendoFatos[amb] = p
  return p
}
async function lerFatos(amb: Amb): Promise<string> {
  const ttlOk = amb === 'dev' ? 60000 : 300000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const lido = await Promise.race([
      sb.from('puri_fatos').select('assunto, ordem, publicado, rascunho'),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('prazo')), 2000) }),
    ]) as { data: any[] | null; error: unknown }
    if (lido.error) throw new Error('leitura')
    const m = montarFatos(lido.data, amb, FATOS_LISTA)
    if (m.origem === 'codigo') logPuri('fatos', 'codigo', m.motivo ?? 'codigo', { amb })
    if (m.trocados.length) logPuri('fatos', 'assunto_codigo', m.trocados.join(','), { amb })
    cacheFatos[amb] = cacheAposLeitura(Date.now(), ttlOk, m)
    return m.texto
  } catch (_e) {
    const r = cacheAposFalha(cacheFatos[amb], Date.now(), montarFatos(null, amb, FATOS_LISTA).texto)
    logPuri('fatos', 'codigo', r.usou === 'antigo' ? 'falha_leitura_texto_antigo' : 'falha_leitura', { amb })
    cacheFatos[amb] = r.cache
    return r.cache.v
  } finally { if (timer) clearTimeout(timer) }
}

/* ── Atalhos da dúvida (sem IA); valem na abertura (dúvida/incerto→dúvida) e no ramo dúvida ── */
type Resp = { tipo: 'resposta' | 'humano'; texto: string; fora?: boolean; humano?: boolean; chips?: string[]; acoes?: string[]; intencao?: string }
export function atalhosDuvida(texto: string, so?: 'pre' | 'saude'): { r: Resp; logTipo: string; motivo: string } | null {
  if (so !== 'pre' && ehSaude(texto)) {
    const leite = ehSaudeLeite(texto), gluten = ehSaudeGluten(texto)
    if (leite) return { r: { tipo: 'resposta', texto: TXT_SAUDE_LEITE }, logTipo: 'resposta', motivo: 'saude_leite' }
    if (gluten) return { r: { tipo: 'resposta', texto: TXT_SAUDE_GLUTEN }, logTipo: 'resposta', motivo: 'saude_gluten' }
    return { r: { tipo: 'resposta', texto: TXT_SAUDE, humano: true }, logTipo: 'resposta', motivo: 'saude' }
  }
  if (so === 'saude') return null
  if (ehPendente(texto)) return { r: { tipo: 'resposta', texto: TXT_SEM_FATO, humano: true }, logTipo: 'resposta', motivo: 'pendente' }
  if (/\b(quero|preciso|posso|pode|gostaria de|deixa eu|me passa|chama|chamar)\b.{0,25}\b(atendente|pessoa|algu[eé]m|humano)\b|\bfalar com (uma |alguma |a |um )?(pessoa|atendente|algu[eé]m)\b|\bpessoa de verdade\b/i.test(texto)) return { r: { tipo: 'humano', texto: TXT_PEDE_PESSOA }, logTipo: 'humano', motivo: 'pedido_humano' }
  return null
}

/* ── Registro do Jev (jev_log): só rótulo, valor e efeito ── */
type LogJev = EntradaJev[]
const jl = (log: LogJev, e: string, r: string, v: string | number, x: string) => log.push({ t: Math.floor(Date.now() / 1000), e, r, v: typeof v === 'number' ? Number(v.toFixed(2)) : v, x })

/* ── Jev ANTES: uma chamada com várias perguntas sobre a mensagem ── */
async function jevAntes(texto: string, hist: Turno[], fatos: string): Promise<LeituraJev> {
  const prev = paresCompletos(hist).slice(-2).flatMap((p) => ['customer: ' + p.u, 'assistant: ' + p.a])
  const a = await jev({ shop: SHOP, facts: fatos, previous_turns: prev, message: semMarcadores(texto) }, JEV_ANTES, 'jev_duvida_antes')
  const ch = a?.categoria?.choice
  const p = a?.categoria?.probabilities?.[ch] ?? a?.categoria?.confidence ?? 0
  return {
    cat: typeof ch === 'string' && ch in JEV_ANTES.categoria.criteria ? ch : 'pergunta_dupuro',
    p: typeof p === 'number' ? p : 0,
    irritado: noul(a, 'irritado'), respondivel: noul(a, 'respondivel'), ambiguo: noul(a, 'ambiguo'),
  }
}

/* ── Haiku escreve (notas + rascunho/motivo na reescrita) ── */
const sistemaHaiku = (ctx: string, fatosTxt: string) => [
  { type: 'text', text: sistemaHaikuFixo(fatosTxt), cache_control: { type: 'ephemeral' } }, // prefixo fixo (regras + FATOS) com cache
  ...(ctx ? [{ type: 'text', text: ctx }] : []), // catálogo ao vivo (muda a cada ~5 min), fora do cache
]
async function haikuDuvida(texto: string, hist: Turno[], ctx: string, fatosTxt: string, notas: string[], rascunho: string | null, motivo: string | null, ms = 9000): Promise<string> {
  const msgs = historicoParaMessages(hist, texto)
  msgs[msgs.length - 1] = { role: 'user', content: mensagemFinalDuvida(texto, notas, rascunho, motivo) }
  const r = await anthropic('haiku_duvida', { max_tokens: 220, temperature: 0.3, system: sistemaHaiku(ctx, fatosTxt), messages: msgs }, ms)
  if (!r.ok) { console.error('haiku status', r.status); throw new Error('Anthropic ' + r.status) }
  if (r.j?.stop_reason === 'refusal') throw new Error('Anthropic refusal')
  if (r.j?.stop_reason === 'max_tokens') return ''
  return textoAnthropic(r.j)
}

/* ── Jev DEPOIS: confere o rascunho (inventou? respondeu? seguiu as notas?) ── */
async function jevDepois(texto: string, fatos: string, rascunho: string, notas: string[]): Promise<{ inventou: number; respondeu: number; seguiu: number | null }> {
  const q: Record<string, unknown> = { inventou_fato_da_dupuro: JEV_DEPOIS.inventou_fato_da_dupuro, respondeu_o_que_foi_perguntado: JEV_DEPOIS.respondeu_o_que_foi_perguntado }
  if (notas.length) q.seguiu_as_notas = JEV_DEPOIS.seguiu_as_notas
  const a = await jev({ shop: SHOP, facts: fatos, question: semMarcadores(texto), draft_answer: rascunho, notes: notas, pending_topics_not_in_facts: PENDENTES_DEPOIS }, q, 'jev_duvida_depois')
  return { inventou: noul(a, 'inventou_fato_da_dupuro'), respondeu: noul(a, 'respondeu_o_que_foi_perguntado'), seguiu: notas.length ? noul(a, 'seguiu_as_notas') : null }
}

/** Prazo global da dúvida (desde o início da requisição) e estimativas de cada chamada. */
const PRAZO_DUVIDA_MS = 15000, EST_HAIKU_MS = 6000, EST_JEV_MS = 3000

/** Motor da dúvida: Jev antes → Haiku escreve → Jev depois (+ checagens por código) → até 2 reescritas → resposta segura.
 *  Degradação parcial: falha do Jev/Haiku não vira TXT_RESERVA; vira o melhor resultado disponível. Teto de 15 s desde `t0`. */
async function responderDuvida(texto: string, hist: Turno[], log: LogJev, et: string, t0: number): Promise<{ r: Resp; motivo: string }> {
  const restante = () => PRAZO_DUVIDA_MS - (Date.now() - t0)
  const [ctx, fatosTxt] = await Promise.all([contextoBanco(), carregarFatos(rq().amb)])
  const fatos = fatosTxt + (ctx ? '\n' + ctx : '')
  let leitura: LeituraJev
  try {
    leitura = await jevAntes(texto, hist, fatos)
  } catch {
    // Jev antes falhou: segue como pergunta comum respondível, sem notas; o Haiku escreve normalmente
    leitura = { cat: 'pergunta_dupuro', p: 0, respondivel: 1, irritado: 0, ambiguo: 0 }
    jl(log, et, 'jev_antes_falhou', 0, 'segue_sem_notas')
    console.error('jev antes falhou')
  }
  const cam = decidirCaminho(leitura)
  const ass = notasDaPergunta(texto)
  if (ass.emprego && cam.tipo === 'resposta' && !cam.fora) { cam.fora = true; cam.notas.push('fora'); cam.chips = [...CHIPS_FORA] }
  cam.notas.push(...ass.notas)
  jl(log, et, 'categoria', leitura.cat + ':' + leitura.p.toFixed(2), cam.cat)
  jl(log, et, 'irritado', leitura.irritado, leitura.irritado >= LIMIARES.IRRITADO_FORTE_MIN ? 'encaminha' : leitura.irritado >= LIMIARES.IRRITADO_NOTA_MIN ? 'nota' : 'nada')
  jl(log, et, 'respondivel', leitura.respondivel, leitura.respondivel < LIMIARES.RESPONDIVEL_MIN ? 'oferece_pessoa' : 'ok')
  jl(log, et, 'ambiguo', leitura.ambiguo, leitura.ambiguo >= LIMIARES.AMBIGUO_MIN ? 'pergunta_ou_dois_casos' : 'nada')
  const base: Resp = { tipo: cam.tipo, texto: '', ...(cam.fora ? { fora: true } : {}), ...(cam.humano ? { humano: true } : {}), ...(cam.chips ? { chips: cam.chips } : {}), ...(cam.acoes ? { acoes: cam.acoes } : {}), ...(cam.intencao ? { intencao: cam.intencao } : {}) }
  if (cam.fixo === 'instagram') return { r: { tipo: 'resposta', texto: TXT_INSTAGRAM }, motivo: 'instagram' }
  if (cam.fixo === 'pede_pessoa') return { r: { tipo: 'humano', texto: TXT_PEDE_PESSOA }, motivo: 'pede_pessoa' }
  if (/(festa|evento|anivers|casamento|formatura|churrasco)/i.test(texto) && cam.tipo === 'resposta') base.humano = true
  const semPessoa = ass.semPessoa || !!cam.fora
  const fim = (txt: string, motivo: string): { r: Resp; motivo: string } => ({ r: { ...base, texto: txt, ...(!semPessoa && respostaSemInfo(txt) ? { humano: true } : {}) }, motivo })
  const notas = cam.notas.map((k) => NOTAS[k]).filter(Boolean)
  let ultimaFalha: string | null = null
  const segura = (motivo: string): { r: Resp; motivo: string } => {
    if (ultimaFalha === 'saude' && perguntaDeRestricao(texto)) {
      const chave = ehSaudeGluten(texto) || /cel[ií]ac/i.test(texto) ? 'saude_gluten' : ehSaudeLeite(texto) ? 'saude_leite' : 'saude'
      jl(log, et, 'resposta_segura', 0, chave)
      return { r: { ...base, texto: chave === 'saude_gluten' ? TXT_SAUDE_GLUTEN : chave === 'saude_leite' ? TXT_SAUDE_LEITE : TXT_SAUDE, ...(semPessoa ? {} : { humano: true }) }, motivo: motivo + '_' + chave }
    }
    const chave = ass.emprego ? 'fora_do_assunto' : ass.notas.includes('cupom_frete') ? 'cupom_frete' : ass.notas.includes('vagas_turno') ? 'vagas_turno' : cam.segura
    const sg = SEGURA[chave] ?? SEGURA.pergunta_dupuro
    jl(log, et, 'resposta_segura', 0, chave)
    return { r: { ...base, texto: sg.texto, ...(sg.humano && !semPessoa ? { humano: true } : {}), ...(sg.fora ? { fora: true } : {}) }, motivo: motivo + '_' + chave }
  }
  let rascunho: string | null = null, motivo: string | null = null
  for (let tent = 0; tent <= LIMIARES.REESCRITAS_MAX; tent++) {
    if (restante() < (tent ? EST_HAIKU_MS : 2000)) { jl(log, et, 'prazo', Math.max(0, restante()) / 1000, 'segura_antes_haiku'); return segura('segura_prazo') }
    let txt: string
    let bruto: string
    try {
      bruto = await haikuDuvida(texto, hist, ctx, fatosTxt, notas, rascunho, motivo, Math.min(tent ? 6000 : 9000, restante()))
      txt = limparResposta(bruto)
    } catch {
      jl(log, et, 'haiku_falhou', tent, tent ? 'segura_na_reescrita' : 'segura_na_escrita')
      console.error('haiku falhou')
      return segura('segura_haiku_falhou')
    }
    let falha: string | null = checarResposta(bruto, texto, cam.tipo === 'humano' || cam.fixo === 'pede_pessoa')
    if (falha) jl(log, et, 'checagem_codigo', 0, falha)
    else if (restante() < EST_JEV_MS) {
      jl(log, et, 'prazo', Math.max(0, restante()) / 1000, 'entrega_so_checagem_codigo')
      return fim(txt, 'ok_prazo')
    } else {
      try {
        const d = await jevDepois(texto, fatos, txt, notas)
        jl(log, et, 'inventou', d.inventou, d.inventou >= LIMIARES.INVENTOU_MAX ? 'reprova' : 'ok')
        jl(log, et, 'respondeu', d.respondeu, d.respondeu < LIMIARES.RESPONDEU_MIN ? 'reprova' : 'ok')
        if (d.seguiu != null) jl(log, et, 'seguiu_notas', d.seguiu, d.seguiu < LIMIARES.SEGUIU_NOTAS_MIN ? 'reprova' : 'ok')
        if (d.inventou >= LIMIARES.INVENTOU_MAX) falha = 'inventou'
        else if (d.respondeu < LIMIARES.RESPONDEU_MIN) falha = 'nao_respondeu'
        else if (d.seguiu != null && d.seguiu < LIMIARES.SEGUIU_NOTAS_MIN) falha = 'nao_seguiu_notas'
      } catch {
        // Jev depois falhou (inclui noul ausente): só valem as checagens por código, que já passaram
        jl(log, et, 'jev_depois_falhou', tent, 'entrega_so_checagem_codigo')
        console.error('jev depois falhou')
        return fim(txt, 'ok_sem_jev_depois')
      }
    }
    if (!falha) return fim(txt, tent ? 'ok_reescrita_' + tent : 'ok')
    jl(log, et, 'reescrita', tent + 1, falha)
    ultimaFalha = falha
    rascunho = txt || null
    motivo = MOTIVOS[falha]
  }
  return segura('segura')
}

/* ── Etapa 4B-1: revenda (segmento J5, coerência J9, escuta J2 + H2) ───────────── */
const LABEL_MOV: Record<string, string> = { ate20: 'up to 20 cups a day', '20a50': '20 to 50 cups a day', '50a100': '50 to 100 cups a day', '100mais': 'more than 100 cups a day' }

async function classificarSegmento(texto: string): Promise<{ segmento: string; confianca: number; sugestoes: string[] }> {
  const a = await jev(
    { shop: SHOP, customer_message: semMarcadores(texto) },
    JEV_SEGMENTO,
  'jev_segmento')
  const ch = a?.segmento?.choice
  const p = a?.segmento?.probabilities?.[ch] ?? a?.segmento?.confidence ?? 1
  const confianca = typeof p === 'number' ? Number(p.toFixed(2)) : 1
  const segmento = typeof ch === 'string' && (typeof p !== 'number' || p >= LIMIARES.SEGMENTO_P_MIN) ? normalizarSegmento(ch) : 'outro'
  return { segmento, confianca, sugestoes: topSegmentos(a?.segmento?.probabilities, normalizarSegmento(ch)) }
}

/** Coerência do perfil. 1) Regra fixa sem IA (regraInicioMovimento): usa ja_vende, papel e leitura.iniciante das anotações; o papel só conta se já foi respondido (vazio/ausente é ignorado). 2) Pergunta estreita ao Jev se o objetivo descreve outro tipo de negócio: só vão o segmento (rótulo), a loja e o objetivo já mascarado (e-mail, telefone, documento, endereço, CEP); nunca nome, telefone, cidade ou bairro como campos. Cidade/bairro soltos no texto livre do objetivo não são mascarados (ver logica.ts). */
async function coerencia(segmento: string, movimento: string, foraArea: boolean, log: LogJev, anotacoes?: unknown): Promise<{ coerente: boolean | null; desencontro: string | null }> {
  try {
    const an = anotacoes && typeof anotacoes === 'object' && !Array.isArray(anotacoes) ? anotacoes as Record<string, any> : {}
    const q = an.qualif && typeof an.qualif === 'object' && !Array.isArray(an.qualif) ? an.qualif as Record<string, unknown> : {}
    const ini = an.leitura && typeof an.leitura === 'object' ? an.leitura.iniciante : null
    // 1) Regra fixa (sem IA): quem vai começar/abrir não declara 100+ copos por dia.
    const regra = regraInicioMovimento(q.ja_vende, q.papel, typeof ini === 'number' ? ini : null, movimento)
    jl(log, 'revenda_perfil', 'regra_inicio_movimento', regra ? 1 : 0, regra ? 'pede_esclarecimento:inicio_movimento' : 'ok')
    if (regra) return { coerente: false, desencontro: 'inicio_movimento' }
    // 2) Pergunta estreita ao Jev: o objetivo descreve outro tipo de negócio? Só roda se houver objetivo.
    const quer = limparIA(an.quer, 300)
    if (!quer) return { coerente: true, desencontro: null }
    const a = await jev({ shop: SHOP, business_type: ROT_SEG[segmento] ?? segmento, goal_summary: quer }, JEV_TIPO_OBJETIVO, 'jev_coerencia')
    const p = noul(a, 'tipo_objetivo')
    const incoerente = p >= LIMIARES.TIPO_OBJETIVO_MIN
    jl(log, 'revenda_perfil', 'tipo_objetivo', p, incoerente ? 'pede_esclarecimento:tipo_objetivo' : 'ok')
    return incoerente ? { coerente: false, desencontro: 'tipo_objetivo' } : { coerente: true, desencontro: null }
  } catch { return { coerente: null, desencontro: null } }
}

/** Grava, de forma atômica no banco (RPC puri_merge_lead), só o PATCH de anotacoes + novas entradas do jev_log + turno. Nunca reescreve a cópia lida no início da requisição. */
async function mesclarLead(sb: any, id: string, anot?: Record<string, unknown> | null, log?: EntradaJev[] | null, soma = false): Promise<{ error: unknown }> {
  const temAnot = !!anot && Object.keys(anot).length > 0
  if (!temAnot && !(log && log.length) && !soma) return { error: null }
  try {
    const { error } = await sb.rpc('puri_merge_lead', { p_id: id, p_anot: temAnot ? anot : {}, p_log: log ?? [], p_soma_turno: soma })
    return { error: error ?? null }
  } catch (e) { return { error: e } }
}

async function haikuTopicos(texto: string): Promise<string[] | null> {
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return null
  try {
    const r = await anthropic('haiku_topicos', {
        max_tokens: 200,
        temperature: 0.2,
        system: SYS_TOPICOS,
        messages: [{ role: 'user', content: `<texto>${texto.replace(/[<>]/g, '')}</texto>` }],
    }, 6000)
    if (!r.ok) return null
    if (r.j?.stop_reason === 'max_tokens' || r.j?.stop_reason === 'refusal') return null
    return parseTopicos(textoAnthropic(r.j))
  } catch { return null }
}

/* ── Etapa 4B-2: aprofundar (H3+J6), palpite (H4+J7), resumo (H5) ───────────── */
const ROT_SEG: Record<string, string> = { delivery_acai: 'delivery de açaí', acaiteria: 'açaiteria', lanchonete_bar: 'lanchonete ou bar', sorveteria: 'sorveteria', feira_evento: 'feira ou evento', mercado_varejo: 'mercado ou varejo', revenda_casa: 'revenda em casa', outro: 'outro negócio' }
const ROT_MOV: Record<string, string> = { ate20: 'até 20 copos por dia', '20a50': '20 a 50 copos por dia', '50a100': '50 a 100 copos por dia', '100mais': 'mais de 100 copos por dia' }

/** Contexto para a IA: SÓ segmento (rótulo), movimento (rótulo), anotações já mascaradas e respostas anteriores. Sem nome/telefone/cidade/bairro. Sem `quer` → null. */
function contextoRevenda(lead: any, com: { palpite?: boolean | 'confirmado' } = {}): string | null {
  const a = lead?.anotacoes && typeof lead.anotacoes === 'object' ? lead.anotacoes : {}
  const quer = limparIA(a.quer, 500)
  if (!quer) return null
  const L: string[] = []
  if (ROT_SEG[lead?.segmento]) L.push('Negócio: ' + ROT_SEG[lead.segmento])
  if (ROT_MOV[lead?.movimento]) L.push('Movimento esperado: ' + ROT_MOV[lead.movimento])
  L.push('O que a pessoa quer: ' + quer)
  if (Array.isArray(a.topicos) && a.topicos.length) L.push('Tópicos: ' + a.topicos.filter((x: unknown) => typeof x === 'string').map((x: string) => limparIA(x, 80)).join('; '))
  if (a.aprof_pergunta && a.aprof_resposta) L.push('Pergunta feita: ' + limparIA(a.aprof_pergunta, 200) + '\nResposta da pessoa: ' + limparIA(a.aprof_resposta, 300))
  // respostas de qualificação (só rótulos/ids e textos já mascarados), esclarecimento e confirmação de açaí; sem nome/telefone/cidade
  const q = a.qualif && typeof a.qualif === 'object' && !Array.isArray(a.qualif) ? a.qualif as Record<string, unknown> : {}
  const ROT_Q: Record<string, [string, Record<string, string>]> = {
    ja_vende: ['Já vende açaí?', { ja_vendo: 'já vende', quero_comecar: 'quer começar', outras_coisas: 'vende outras coisas' }],
    compra: ['Como pensa em comprar', { testar_1cx: 'testar com 1 caixa', '30l_mais': '30 L ou mais por pedido' }],
    comeco: ['Quando quer começar', { esta_semana: 'esta semana', este_mes: 'este mês', pesquisando: 'só pesquisando' }],
    papel: ['Papel da pessoa', { dono: 'dono', socio: 'sócio', trabalho: 'trabalha no negócio', vou_abrir: 'vai abrir o negócio' }],
    conheceu: ['Como conheceu a Dupuro', { instagram: 'Instagram', indicacao: 'indicação', google: 'Google', compro_loja: 'compra na loja', outro: 'outro' }],
  }
  for (const [campo, [rot, vals]] of Object.entries(ROT_Q)) {
    const v = q[campo]
    if (v === 'texto' && typeof q[campo + '_texto'] === 'string') L.push(rot + ': ' + limparIA(q[campo + '_texto'], 200))
    else if (typeof v === 'string' && vals[v]) L.push(rot + ' ' + vals[v])
  }
  if (typeof a.esclarecimento === 'string' && a.esclarecimento) L.push('Esclarecimento da pessoa: ' + limparIA(a.esclarecimento, 300))
  if (a.confirma_acai === 'sim') L.push('A pessoa confirmou que o objetivo é vender açaí')
  const ini = a.leitura && typeof a.leitura === 'object' ? (a.leitura as any).iniciante : null
  if (typeof ini === 'number' && ini >= LIMIARES.INICIANTE_MIN) L.push('Parece estar começando agora')
  if (typeof a.palpite_final === 'string' && a.palpite_final) L.push('Frase final escolhida pela pessoa sobre a causa: ' + limparIA(a.palpite_final, 220))
  if (com.palpite === 'confirmado') {
    // mapa: o palpite (hipótese da IA) só vira fato se a pessoa confirmou em cheio; senão só entra a correção dela
    if (a.palpite && a.palpite_valor === 'mosca') L.push('Palpite confirmado pela pessoa: ' + limparIA(a.palpite, 220))
    else if (a.palpite_correcao) L.push('A pessoa corrigiu: ' + limparIA(a.palpite_correcao, 300))
  } else if (com.palpite && a.palpite) {
    L.push('Palpite mostrado: ' + limparIA(a.palpite, 220))
    if (['mosca', 'parte', 'nao'].includes(a.palpite_valor)) L.push('Reação da pessoa ao palpite: ' + ({ mosca: 'acertou em cheio', parte: 'acertou em parte', nao: 'não era isso' } as Record<string, string>)[a.palpite_valor])
    if (a.palpite_correcao) L.push('Correção da pessoa: ' + limparIA(a.palpite_correcao, 300))
  }
  return `<contexto>\n${L.join('\n')}\n</contexto>`
}

/** Chamada Haiku genérica: devolve o texto ou null (falha, timeout, max_tokens). */
async function haikuTexto(system: string, user: string, maxTokens: number, funcao = 'haiku_texto'): Promise<string | null> {
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return null
  try {
    const r = await anthropic(funcao, { max_tokens: maxTokens, temperature: 0.3, system, messages: [{ role: 'user', content: user }] }, 8000)
    if (!r.ok) return null
    if (r.j?.stop_reason === 'max_tokens' || r.j?.stop_reason === 'refusal') return null
    return textoAnthropic(r.j).trim() || null // vazio nunca vale como resposta
  } catch { return null }
}


/** Cartões da cena: Haiku escreve, Jev confere (inventou?) com até CARTOES_REESCRITAS_MAX reescritas. Falha/prazo → null. */
async function escreverCartoes(texto: string, log: LogJev, fim: number): Promise<{ cenario: string; trava: string; chegar: string } | null> {
  let rascunho: string | null = null, motivo: string | null = null
  for (let tent = 0; tent <= LIMIARES.CARTOES_REESCRITAS_MAX; tent++) {
    if (fim - Date.now() < 7000) { jl(log, 'cartoes', 'prazo', 0, 'sem_cena'); return null }
    const user = `<texto>${texto.replace(/[<>]/g, '')}</texto>` + (rascunho && motivo ? `\n<rascunho_anterior>${rascunho.replace(/[<>]/g, '')}</rascunho_anterior>\n<motivo>${motivo}</motivo>` : '')
    const bruto = await haikuTexto(SYS_CARTOES, user, 260, 'haiku_cartoes')
    if (!bruto) { jl(log, 'cartoes', 'haiku_falhou', tent, 'sem_cena'); return null }
    const c = parseCartoes(bruto)
    let falha: string | null = c ? null : 'formato'
    if (c && fim - Date.now() >= 3500) {
      try {
        const a = await jev({ shop: SHOP, person_context: semMarcadores(texto), cards: JSON.stringify(c) }, JEV_CARTOES, 'jev_cartoes')
        const inv = noul(a, 'cartao_ruim')
        jl(log, 'cartoes', 'inventou', inv, inv >= LIMIARES.CARTOES_INVENTOU_MAX ? 'reprova' : 'ok')
        if (inv >= LIMIARES.CARTOES_INVENTOU_MAX) falha = 'inventou'
      } catch { jl(log, 'cartoes', 'jev_falhou', tent, 'sem_cena'); return null }
    } else if (c) { jl(log, 'cartoes', 'prazo', 0, 'sem_cena'); return null }
    if (!falha && c) return c
    jl(log, 'cartoes', 'reescrita', tent + 1, falha ?? 'formato')
    rascunho = bruto.slice(0, 400)
    motivo = MOTIVOS_CARTOES[falha ?? 'formato']
  }
  return null
}

/** Pergunta de esclarecimento (perfil que não bate): Haiku escreve com a nota do Jev; Jev confere; 1 reescrita. Esgotadas as tentativas → pergunta fixa por tipo de desencontro. */
async function escreverEsclarecer(desencontro: string, log: LogJev): Promise<string | null> {
  const nota = NOTAS_DESENCONTRO[desencontro] ?? NOTAS_DESENCONTRO.tipo_objetivo
  let rascunho: string | null = null, motivo: string | null = null
  for (let tent = 0; tent <= LIMIARES.ESCLARECER_REESCRITAS_MAX; tent++) {
    const user = `<nota>${nota}</nota>` + (rascunho && motivo ? `\n<rascunho_anterior>${rascunho}</rascunho_anterior>\n<motivo>${motivo}</motivo>` : '')
    const bruto = await haikuTexto(SYS_ESCLARECER, user, 120, 'haiku_esclarecer')
    if (!bruto) { jl(log, 'esclarecer', 'haiku_falhou', tent, 'sem_pergunta'); return null }
    const q = parsePerguntaEsclarecer(bruto)
    let falha: string | null = q ? null : 'formato'
    if (q) {
      try {
        const a = await jev({ shop: SHOP, question: q, mismatch_note: nota }, JEV_ESCLARECER, 'jev_esclarecer')
        const ad = noul(a, 'pergunta_adequada')
        jl(log, 'esclarecer', 'adequada', ad, ad >= LIMIARES.PERGUNTA_ESCLARECER_MIN ? 'ok' : 'reprova')
        if (ad < LIMIARES.PERGUNTA_ESCLARECER_MIN) falha = 'inadequada'
      } catch { jl(log, 'esclarecer', 'jev_falhou', tent, 'sem_pergunta'); return null }
    }
    if (!falha && q) return q
    jl(log, 'esclarecer', 'reescrita', tent + 1, falha ?? 'formato')
    rascunho = bruto.slice(0, 200).replace(/[<>]/g, '')
    motivo = MOTIVOS_ESCLARECER[falha ?? 'formato']
  }
  const fixa = PERGUNTAS_ESCLARECER_FIXAS[desencontro] ?? PERGUNTAS_ESCLARECER_FIXAS.tipo_objetivo
  jl(log, 'esclarecer', 'fixa', 0, 'pergunta_fixa')
  return fixa
}
/** Jev decide se vale perguntar (abaixo do limiar → null, sem Haiku); H3 gera 3 candidatas (filtro de proibidas no parse); J6 escolhe 1. Falha → null. */
async function aprofundar(ctx: string, log: LogJev, fim: number): Promise<{ pergunta: string; respostas: string[] } | null> {
  const pc = ctx.replace(/<\/?contexto>/g, '')
  if (fim - Date.now() < 3500) { jl(log, 'aprofundar', 'prazo', 0, 'pula'); return null }
  try {
    const a = await jev({ shop: SHOP, person_context: pc }, JEV_APROFUNDAR, 'jev_precisa_aprofundar')
    const p = noul(a, 'precisa_aprofundar')
    jl(log, 'aprofundar', 'precisa_aprofundar', p, p >= LIMIARES.PRECISA_APROFUNDAR_MIN ? 'pergunta' : 'pula')
    if (p < LIMIARES.PRECISA_APROFUNDAR_MIN) return null
  } catch { jl(log, 'aprofundar', 'jev_falhou', 0, 'pula'); return null }
  if (fim - Date.now() < 7000) { jl(log, 'aprofundar', 'prazo', 1, 'pula'); return null }
  const t = await haikuTexto(SYS_H3, ctx, 400, 'haiku_aprofundar')
  const cand = t ? parsePerguntasAprof(t) : null
  if (!cand) { jl(log, 'aprofundar', 'candidatas', 0, 'sem_pergunta'); return null }
  if (cand.length === 1) return cand[0]
  if (fim - Date.now() < 3500) { jl(log, 'aprofundar', 'prazo', 2, 'q1'); return cand[0] }
  try {
    const criteria: Record<string, string> = {}
    cand.forEach((c, i) => { criteria['q' + (i + 1)] = c.pergunta })
    const a = await jev(
      { shop: SHOP, person_context: pc },
      { melhor: { type: 'choice', instructions: JEV_MELHOR_INSTR, criteria } },
    'jev_aprofundar')
    const i = Number(String(a?.melhor?.choice ?? '').replace('q', '')) - 1
    const ok = Number.isInteger(i) && i >= 0 && i < cand.length
    jl(log, 'aprofundar', 'melhor_pergunta', cand.length, ok ? 'q' + (i + 1) : 'q1')
    return cand[ok ? i : 0]
  } catch { return cand[0] }
}

/** H4 + J7 com motor: reprovado → motivo volta ao Haiku (até PALPITE_REESCRITAS_MAX); depois, ou no prazo, null. */
async function palpiteRevenda(ctx: string, log: LogJev, fim: number): Promise<string | null> {
  const pc = ctx.replace(/<\/?contexto>/g, '')
  let rascunho: string | null = null, motivo: string | null = null
  for (let tent = 0; tent <= LIMIARES.PALPITE_REESCRITAS_MAX; tent++) {
    if (fim - Date.now() < 7000) { jl(log, 'palpite', 'prazo', tent, 'sem_palpite'); return null }
    const user = ctx + (rascunho && motivo ? `\n<rascunho_anterior>${rascunho}</rascunho_anterior>\n<motivo>${motivo}</motivo>` : '')
    const t = await haikuTexto(SYS_H4, user, 150, 'haiku_palpite')
    if (!t) { jl(log, 'palpite', 'haiku_falhou', tent, 'sem_palpite'); return null }
    if (/^\W*NENHUM\W*$/i.test(t.trim())) { jl(log, 'palpite', 'sem_base', tent, 'sem_palpite'); return null }
    const p = parsePalpite(t)
    let falha: string | null = p ? null : 'formato'
    if (p) {
      if (fim - Date.now() < 3500) { jl(log, 'palpite', 'prazo', tent, 'sem_palpite'); return null }
      try {
        const a = await jev({ shop: SHOP, person_context: pc, guess: p }, JEV_PALPITE, 'jev_palpite_j7')
        const nv = noul(a, 'inventa')
        jl(log, 'palpite', 'inventa', nv, nv >= LIMIARES.PALPITE_INVENTA_MAX ? 'reprova' : 'ok')
        if (nv >= LIMIARES.PALPITE_INVENTA_MAX) falha = 'inventou'
      } catch { jl(log, 'palpite', 'jev_falhou', tent, 'sem_palpite'); return null }
    }
    if (!falha && p) return p
    jl(log, 'palpite', 'reescrita', tent + 1, falha ?? 'formato')
    rascunho = (p ?? t).slice(0, 220).replace(/[<>]/g, '')
    motivo = MOTIVOS_PALPITE[falha ?? 'formato']
  }
  return null
}

/** palpite_resp: H4 propõe até 3 frases a partir da correção; o Jev confere cada uma; o código descarta as reprovadas e ordena. Falha → []. */
async function alternativasPalpite(ctx: string, correcao: string, log: LogJev, fim: number): Promise<string[]> {
  if (fim - Date.now() < 7000) { jl(log, 'palpite_alt', 'prazo', 0, 'sem_alternativas'); return [] }
  const t = await haikuTexto(SYS_H4_ALT, ctx + `\n<correcao>${correcao.replace(/[<>]/g, '')}</correcao>`, 350, 'haiku_palpite_alt')
  const alts = t ? parseAlternativasPalpite(t) : null
  if (!alts) { jl(log, 'palpite_alt', 'haiku_falhou', 0, 'sem_alternativas'); return [] }
  const pc = ctx.replace(/<\/?contexto>/g, '') + '\nCorreção da pessoa: ' + correcao.replace(/[<>]/g, '')
  const semTempo = fim - Date.now() < 3500
  if (semTempo) jl(log, 'palpite_alt', 'prazo', 1, 'sem_conferencia')
  const itens = await Promise.all(alts.map(async (frase) => {
    if (semTempo) return { frase, inventa: null as number | null }
    try { return { frase, inventa: noul(await jev({ shop: SHOP, person_context: pc, guess: frase }, JEV_PALPITE, 'jev_palpite_alt'), 'inventa') } }
    catch { return { frase, inventa: null as number | null } }
  }))
  itens.forEach((i, n) => jl(log, 'palpite_alt', 'inventa', i.inventa ?? 1, i.inventa !== null && i.inventa < LIMIARES.PALPITE_ALT_INVENTA_MAX ? 'ok_' + (n + 1) : 'descarta_' + (n + 1)))
  return ordenarAlternativas(itens)
}

/** J10: prioridade do lead 0–3 (esforço + interesse + encaixe). Só rótulos e tópicos já mascarados; falha → null. */
async function prioridadeLead(lead: any): Promise<number | null> {
  try {
    const a = lead?.anotacoes && typeof lead.anotacoes === 'object' ? lead.anotacoes : {}
    const palp: Record<string, string> = { mosca: 'right on target', parte: 'partly right', nao: 'not what they meant' }
    const r = await jev(
      {
        shop: SHOP,
        business_type: ROT_SEG[lead?.segmento] ? lead.segmento : 'unknown',
        expected_cups_per_day: LABEL_MOV[lead?.movimento] ?? 'unknown',
        fits_business_profile: lead?.coerente === true ? 'yes' : lead?.coerente === false ? 'no' : 'unknown',
        topics: Array.isArray(a.topicos) ? a.topicos.filter((x: unknown) => typeof x === 'string').slice(0, 4).map((x: string) => limparIA(x, 80)) : [],
        answered_follow_up_question: !!a.aprof_resposta,
        reaction_to_guess: palp[a.palpite_valor] ?? 'none',
        ...(typeof lead?.esforco === 'number' ? { effort_score_0_to_3: lead.esforco } : {}),
      },
      JEV_PRIORIDADE,
    'jev_prioridade')
    const n = Number(String(r?.prioridade?.choice ?? '').replace('p', ''))
    return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null
  } catch { return null }
}

type ResumoR = { resumo: string; problema: string; termo: string | null }
/** Decisão 19: o Jev rejulga a frase do objetivo contra as respostas seguintes. true = o objetivo mudou (baixo). Sem respostas seguintes ou Jev falhou → false. */
async function objetivoMudou(ctx: string, quer: string, log: LogJev): Promise<boolean> {
  const later = ctx.replace(/<\/?contexto>/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(Negócio|O que a pessoa quer|Tópicos):/.test(l))
  if (!quer || !later.length) return false
  try {
    const v = noul(await jev({ shop: SHOP, goal: quer, later_answers: later }, JEV_OBJETIVO_VALE, 'jev_objetivo_vale'), 'objetivo_ainda_vale')
    const mudou = v < LIMIARES.OBJETIVO_VALE_MIN
    jl(log, 'resumo', 'objetivo_ainda_vale', v, mudou ? 'nota_objetivo_mudou' : 'ok')
    return mudou
  } catch { jl(log, 'resumo', 'objetivo_jev_falhou', 0, 'segue_sem_nota'); return false }
}

/** H5 (resumo + problema + termo) com conferência do Jev (inventou?): motivo devolvido ao Haiku, até RESUMO_REESCRITAS_MAX reescritas; reprovado/falha/prazo → null. */
async function resumoRevenda(ctx: string, log: LogJev, fim: number, extra = ''): Promise<ResumoR | null> {
  const pc = ctx.replace(/<\/?contexto>/g, '')
  let rascunho: string | null = null, motivo: string | null = null
  for (let tent = 0; tent <= LIMIARES.RESUMO_REESCRITAS_MAX; tent++) {
    if (fim - Date.now() < 7000) { jl(log, 'resumo', 'prazo', tent, 'sem_resumo'); return null }
    const user = ctx + extra + (rascunho && motivo ? `\n<rascunho_anterior>${rascunho}</rascunho_anterior>\n<motivo>${motivo}</motivo>` : '')
    const t = await haikuTexto(SYS_H5, user, 250, 'haiku_resumo')
    if (!t) { jl(log, 'resumo', 'haiku_falhou', tent, 'sem_resumo'); return null }
    const r = parseResumo(t, tent < LIMIARES.RESUMO_REESCRITAS_MAX) // última tentativa: problema longo é cortado por código
    if (r) {
      if (fim - Date.now() < 3500) { jl(log, 'resumo', 'prazo', tent, 'sem_resumo'); return null }
      try {
        const nv = noul(await jev({ shop: SHOP, person_context: pc, summary: r.resumo }, JEV_RESUMO_INVENTA, 'jev_resumo_inventa'), 'inventa')
        jl(log, 'resumo', 'inventa', nv, nv >= LIMIARES.RESUMO_INVENTA_MAX ? 'reprova' : 'ok')
        if (nv < LIMIARES.RESUMO_INVENTA_MAX) { jl(log, 'resumo', 'termo', r.termo ? 1 : 0, r.termo ? 'ok' : 'sem_termo'); return r }
      } catch { jl(log, 'resumo', 'jev_falhou', tent, 'sem_resumo'); return null }
    }
    jl(log, 'resumo', 'reescrita', tent + 1, r ? 'inventou' : 'formato')
    rascunho = (r?.resumo ?? t).slice(0, 300).replace(/[<>]/g, '')
    motivo = r ? MOTIVO_RESUMO : 'Sua resposta não veio como o JSON pedido {"resumo","problema","termo"}, ou o "problema" passou de 40 caracteres. O "problema" deve ter até 40 caracteres, frase curta e completa. Reescreva.'
  }
  return null
}

/* ── Etapa 5B: mapa do caso (H6 monta, H7 ajusta, J8 confere) ───────────────── */
const PASSO_TXT = 'Primeiro pedido sem mínimo: começar pequeno e medir a saída'
const TIT_MAPA: Record<string, string> = { negocio: 'Seu negócio', problema: 'O que trava', causa: 'Por que trava', risco: 'O risco', destino: 'Onde quer chegar', passo: 'Primeiro passo' }
type NoMapa = { tipo: string; titulo: string; texto: string; ajustado: boolean }
type MapaCaso = { nos: NoMapa[]; setas: (string | null)[]; simples: boolean; ajustes: number }

/** Nó "Seu negócio": só código (rótulo do segmento + bairro e cidade do lead). */
function textoNegocio(lead: any): string {
  const rot = ROT_SEG[lead?.segmento] ?? 'negócio'
  const loc = [lead?.bairro, lead?.cidade].filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.replace(/[<>]/g, '').trim()).join(', ')
  return (rot.charAt(0).toUpperCase() + rot.slice(1) + (loc ? ' · ' + loc : '')).slice(0, 70)
}
/** Monta o mapa a partir do que a IA devolveu (ia) ou, sem IA, só com código. `antes` serve para calcular `ajustado`. */
function montarMapa(lead: any, ia: MapaIA | null, antes: MapaCaso | null, ajustes: number): MapaCaso {
  const a = lead?.anotacoes && typeof lead.anotacoes === 'object' ? lead.anotacoes : {}
  const antesTxt = (tipo: string) => antes?.nos.find((n) => n.tipo === tipo)
  const no = (tipo: string, texto: string): NoMapa => {
    const ant = antesTxt(tipo)
    return { tipo, titulo: TIT_MAPA[tipo], texto, ajustado: !!antes && (!ant || ant.ajustado || (ia != null && ant.texto !== texto)) }
  }
  const nos: NoMapa[] = [no('negocio', textoNegocio(lead))]
  let setas: (string | null)[]
  if (ia) {
    nos.push(no('problema', ia.problema))
    if (ia.causa) nos.push(no('causa', ia.causa))
    if (ia.risco) nos.push(no('risco', ia.risco))
    if (ia.destino) nos.push(no('destino', ia.destino))
    if (ia.passo) nos.push(no('passo', PASSO_TXT))
    // setas por par de tipos (de>para) entre os nós que de fato entraram; o passo sempre liga com "começa por"
    setas = [...setasDosNos(nos.filter((n) => n.tipo !== 'passo').map((n) => n.tipo), ia.setasPar ?? {}), ...(ia.passo ? ['começa por'] : [])]
  } else {
    const prob = limparIA(a.problema, 60)
    const top0 = Array.isArray(a.topicos) && typeof a.topicos[0] === 'string' ? limparIA(a.topicos[0], 80) : ''
    const quer = limparIA(a.quer, 500)
    let dest = 'Vender açaí com segurança'
    if (top0.length >= 4 && top0.length <= 60) dest = top0
    else if (quer.length >= 4) {
      if (quer.length <= 60) dest = quer
      else { const corte = quer.slice(0, 57).replace(/\s+\S*$/, '').trim(); if (corte.length >= 4) dest = corte + '…' }
    }
    nos.push(no('problema', prob.length >= 4 ? prob : 'O que você quer resolver'), no('destino', dest), no('passo', PASSO_TXT))
    setas = nos.slice(1).map(() => null)
  }
  const m: MapaCaso = { nos, setas, simples: !ia, ajustes }
  if (antes) m.nos.forEach((n) => { if (n.tipo === 'negocio' || n.tipo === 'passo') n.ajustado = false })
  return m
}
/** O Jev escolhe os tipos de nó do mapa (noul por tipo: relevante E há informação dita pela pessoa). negocio e problema sempre entram. Jev falhou → todos. */
async function escolherTiposMapa(pc: string, log: LogJev): Promise<string[]> {
  try {
    const a = await jev({ shop: SHOP, person_context: pc }, JEV_MAPA_TIPOS, 'jev_mapa_tipos')
    const entram = new Set(['negocio', 'problema'])
    for (const k of Object.keys(JEV_MAPA_TIPOS)) {
      const v = noul(a, k), ok = v >= LIMIARES.MAPA_TIPO_MIN
      jl(log, 'mapa', 'tipo_' + k, v, ok ? 'entra' : 'fora')
      if (ok) entram.add(k)
    }
    return TIPOS_MAPA.filter((k) => entram.has(k))
  } catch (e) { console.error('mapa tipos falha', codErro(e)); jl(log, 'mapa', 'tipos_jev_falhou', 0, 'todos'); return TIPOS_MAPA }
}
/** H6/H7 + J8 por rótulo. Devolve o mapa da IA ou null (Haiku/parse/Jev falharam, prazo, ou J8 ≥ MAPA_J8_MAX mesmo após MAPA_REESCRITAS_MAX reescritas com o motivo) + o maior J8 visto. */
async function gerarMapaIA(sys: string, user: string, log: LogJev, fim: number, trace?: unknown[]): Promise<{ ia: MapaIA | null; j8: number | null }> {
  const pc = user.replace(/<\/?contexto>/g, '')
  const tipos = await escolherTiposMapa(pc, log)
  const nos = tipos.filter((k) => ['problema', 'causa', 'risco', 'destino'].includes(k))
  let j8: number | null = null, rascunho: string | null = null, motivo: string | null = null
  for (let tent = 0; tent <= LIMIARES.MAPA_REESCRITAS_MAX; tent++) {
    if (fim - Date.now() < 7000) { jl(log, 'mapa', 'prazo', tent, 'mapa_simples'); break }
    const u = user + '\n<nos>' + nos.join(', ') + '</nos>' + (rascunho && motivo ? `\n<rascunho_anterior>${rascunho}</rascunho_anterior>\n<motivo>${motivo}</motivo>` : '')
    const t = await haikuTexto(sys, u, 300, 'haiku_mapa')
    const ia = t ? parseMapa(t, tipos) : null
    trace?.push({ tent, tipos, bruto: t, ia })
    if (!ia) { jl(log, 'mapa', 'haiku_ou_formato', tent, 'mapa_simples'); return { ia: null, j8 } }
    if (fim - Date.now() < 3500) { jl(log, 'mapa', 'prazo', tent, 'mapa_simples'); break }
    const labels: Record<string, string> = { problema: ia.problema }
    if (ia.causa) labels.causa = ia.causa
    if (ia.risco) labels.risco = ia.risco
    if (ia.destino) labels.destino = ia.destino
    const perg: Record<string, unknown> = {}
    for (const c of Object.keys(labels)) perg['ruim_' + c] = { type: 'noul', instructions: j8Instr(c) }
    const ruins: string[] = []
    try {
      const a = await jev({ shop: SHOP, person_context: pc, labels }, perg, 'jev_mapa_j8')
      for (const c of Object.keys(labels)) {
        const v = noul(a, 'ruim_' + c)
        j8 = Math.max(j8 ?? 0, v)
        jl(log, 'mapa', 'j8_' + c, v, v >= LIMIARES.MAPA_J8_MAX ? 'reprova' : 'ok')
        if (v >= LIMIARES.MAPA_J8_MAX) ruins.push(c)
      }
      if (trace) (trace[trace.length - 1] as any).j8 = j8
    } catch (e) { console.error('mapa j8 falha', codErro(e)); jl(log, 'mapa', 'j8_jev_falhou', tent, 'mapa_simples'); return { ia: null, j8 } }
    if (!ruins.length) return { ia, j8 }
    jl(log, 'mapa', 'reescrita', tent + 1, ruins.join(','))
    rascunho = JSON.stringify(labels).replace(/[<>]/g, '').slice(0, 500)
    motivo = motivoMapa(ruins)
  }
  return { ia: null, j8 }
}

/* ── HTTP ─────────────────────────────────────────────────────────── */
let saltP: Promise<string> | null = null
/** Sal derivado de um secret existente (nunca logado). */
function sal(): Promise<string> {
  saltP ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode((Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '') + 'puri'))
    .then((d) => Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join(''))
  return saltP
}
async function hashIp(ip: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((await sal()) + '|' + normalizarIp(ip)))
  return Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}
const ipDe = (req: Request): string => {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim()
  if (cf) return cf
  const xs = (req.headers.get('x-forwarded-for') || '').split(',')
  return (xs[xs.length - 1] || '').trim() || 'unknown'
}

/** Hash salgado do IP da maquina do Kayo, liberado em 2026-11-20 a pedido dele; se o provedor trocar o IP, atualizar. */
const IPS_LIVRES = new Set(['dad2b0e797de3c450b3d9570'])

/** Limite POR IP: pula quando o IP esta em IPS_LIVRES (globais e por token continuam valendo). */
async function limiteIpOk(sb: any, pre: string, prefixo: string, req: Request, max: number): Promise<boolean> {
  const h = await hashIp(ipDe(req))
  if (IPS_LIVRES.has(h)) return true
  return limiteOk(sb, pre, prefixo + h, max)
}

/** Falha FECHADO: só passa quando o rate_check devolve exatamente true. */
async function limiteOk(sb: any, pre: string, key: string, max: number): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('rate_check', { p_key: pre + key, p_max: lim(max), p_janela_seg: 86400 })
    return !error && data === true
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  // ambiente por requisição: slug assistente-dev = dev (prefixo dev: nas chaves de rate_check, modelo e limites do dev); o contexto vive no AsyncLocalStorage
  const amb: Amb = /^(\/functions\/v1)?\/assistente-dev\/?$/.test(new URL(req.url).pathname) ? 'dev' : 'prod'
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsDe(req) }) // preflight nunca depende de env
  let c: CtxReq
  try {
    const sbCtx = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    c = { amb, modelo: modeloDe(amb), haikuMax: false, sb: sbCtx, pend: [] }
  } catch {
    console.error('ctx falha')
    return new Response(JSON.stringify({ ok: false, motivo: 'erro' }), { status: 200, headers: { ...corsDe(req), 'Content-Type': 'application/json' } })
  }
  return await als.run(c, async () => {
    const resp = await atender(req)
    if (c.pend.length) await Promise.allSettled(c.pend) // grava o uso antes de encerrar a requisição
    return resp
  })
})

async function atender(req: Request): Promise<Response> {
  const P = rq().amb === 'dev' ? 'dev:' : ''
  const cors = corsDe(req)
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, motivo: 'erro' }, 405)

  try {
    const sb = rq().sb
    let body: any
    try { body = await req.json() } catch { body = {} }
    const acao = typeof body?.acao === 'string' ? body.acao : ''

    /* ── iniciar ── */
    if (acao === 'iniciar') {
      const pagina = ['home', 'revenda', 'delivery'].includes(body.pagina) ? body.pagina : 'home'
      const { dia } = diaCuiaba()
      if (!await limiteIpOk(sb, P, 'puri-ip:', req, LIMITE_INICIAR_IP_DIA)) return json({ ok: false, motivo: 'limite_dia' })
      if (!await limiteOk(sb, P, 'puri-new-' + dia, LIMITE_INICIAR_GLOBAL_DIA)) return json({ ok: false, motivo: 'limite_dia' })
      const token = crypto.randomUUID()
      const { error } = await sb.from('qualificacao_leads').insert({ token, origem: 'puri', pagina, status: 'em_chat', ambiente: rq().amb })
      if (error) return json({ ok: false, motivo: 'erro' })
      return json({ ok: true, token })
    }

    /* ── mensagem ── */
    if (acao === 'mensagem') {
      const token = typeof body.token === 'string' ? body.token : ''
      const etapa = body.etapa === 'abertura' || body.etapa === 'duvida' ? body.etapa : ''
      const et = etapa || 'invalida'
      const falha = (motivo: string) => { logPuri(et, 'erro', motivo); return json({ ok: false, motivo }) }
      if (!UUID_RE.test(token)) return falha('token_invalido')
      const v = validarTexto(body.texto)
      if (!etapa || !v.ok) return falha('texto_invalido')

      const { data: lead } = await sb.from('qualificacao_leads').select('id, turns, pagina, historico, anotacoes, jev_log')
        .eq('token', token).eq('origem', 'puri').maybeSingle()
      if (!lead) return falha('token_invalido')
      const texto = mascarar(v.texto)
      const t0Req = Date.now()
      // atalhos sem IA (saúde, pendente, atendente, Instagram) não gastam as cotas que limitam IA (IP e global); só valem na dúvida
      const atPre = etapa === 'duvida' ? atalhosDuvida(texto) : atalhosDuvida(texto, 'pre')
      const social = etapa === 'abertura' && !atPre ? socialAbertura(texto) : null // só cumprimento/agradecimento: sem IA, não gasta cotas de IA
      const semIA = !!atPre || !!social
      if ((lead.turns ?? 0) >= lim(LIMITE_MSG_CONVERSA)) return falha('limite_conversa')
      if (!semIA && await tetoEstourado()) return falha('limite_custo')
      const { dia } = diaCuiaba()
      if (!semIA && !await limiteIpOk(sb, P, 'puri-ipm:', req, LIMITE_MSG_IP_DIA)) return falha('limite_ip_dia')
      if (!await limiteOk(sb, P, 'puri-tok:' + token, LIMITE_TOK_BRUTO)) return falha('limite_conversa')
      const anotMsg = (lead.anotacoes && typeof lead.anotacoes === 'object' && !Array.isArray(lead.anotacoes) ? lead.anotacoes : {}) as Record<string, unknown>
      const cobrarConv = anotMsg.conv_contada !== true
      if (cobrarConv && !await limiteOk(sb, P, 'puri-conv-' + dia, LIMITE_CONVERSAS_DIA)) return falha('limite_conversas_dia')
      if (!semIA && !await limiteOk(sb, P, 'puri-global-' + dia, LIMITE_MSG_DIA)) return falha('limite_global_dia')

      // turns só soma quando a mensagem deu certo (erro técnico não conta no limite por conversa)
      // gravação: colunas simples no update; anotacoes/jev_log/turns só pelo merge atômico (RPC), com o que esta requisição mudou
      const grava = async (cols: Record<string, unknown>, log: EntradaJev[] | null, soma: boolean) => {
        await sb.from('qualificacao_leads').update(cols).eq('id', lead.id)
        await mesclarLead(sb, lead.id, null, log, soma)
      }
      await sb.from('qualificacao_leads').update({ ultimo_texto: texto.slice(0, 300) }).eq('id', lead.id)
      if (cobrarConv) await mesclarLead(sb, lead.id, { conv_contada: true })

      const logReq: EntradaJev[] = []
      try {
        if (etapa === 'abertura') {
          if (social) {
            // não grava 'social' em intencao (CHECK do banco); só histórico e turno, como os atalhos pre
            const txtSocial = social === 'cumprimento' ? TXT_SOCIAL_CUMPRIMENTO : TXT_SOCIAL_AGRADECIMENTO
            await grava({ historico: empilharHistorico(lead.historico, [{ r: 'u', t: texto.slice(0, 300) }, { r: 'a', t: txtSocial }]) }, null, true)
            logPuri('abertura', 'intencao', 'social_' + social)
            return json({ ok: true, tipo: 'intencao', intencao: 'social', texto: txtSocial })
          }
          let intencao = 'incerto'
          let ambiguoAb = false
          let motivoAb = 'ok'
          const atPre0 = atalhosDuvida(texto, 'pre')
          if (!atPre0) {
            try {
              const cls = await classificarAbertura(texto, lead.pagina || 'home', logReq)
              intencao = cls.intencao
              ambiguoAb = cls.ambiguo
            } catch (e) {
              motivoAb = 'jev_falhou'
              console.error('abertura falha')
            }
          }
          // saúde só vale na abertura se a intenção for dúvida/incerto; revenda/consumo/prova seguem o caminho da intenção
          const at0 = atPre0 ?? (intencao === 'duvida' || intencao === 'incerto' ? atalhosDuvida(texto, 'saude') : null)
          if (!at0 && ambiguoAb && motivoAb === 'ok' && intencao !== 'duvida') {
            // Jev não tem certeza entre revender e consumir: pergunta em vez de abrir um caminho
            await grava({ intencao, historico: empilharHistorico(lead.historico, [{ r: 'u', t: texto.slice(0, 300) }, { r: 'a', t: TXT_ABERTURA_AMBIGUA }]) }, logReq, true)
            logPuri('abertura', 'resposta', 'ambigua')
            return json({ ok: true, tipo: 'resposta', texto: TXT_ABERTURA_AMBIGUA, acoes: ['revender', 'consumir'] })
          }
          if (at0 || motivoAb === 'ok' && (intencao === 'duvida' || (intencao === 'incerto' && /\?|^\s*(qual|quais|quanto|quando|como|onde|tem|vende|vendem|voc[eê]s|abre|aceita|entrega|faz|fazem|posso|pode|d[aá])\b/i.test(texto)))) {
            // dúvida (ou incerto com cara de pergunta): responde na MESMA requisição
            const hist0 = empilharHistorico(lead.historico, [])
            const log0 = logReq
            let r0: Resp, mot0: string
            if (at0) { r0 = at0.r; mot0 = at0.motivo } else ({ r: r0, motivo: mot0 } = await responderDuvida(texto, hist0, log0, 'abertura', t0Req))
            await grava({ intencao: 'duvida', fluxo: 'duvida', historico: empilharHistorico(hist0, [{ r: 'u', t: texto.slice(0, 300) }, { r: 'a', t: r0.texto.slice(0, 300) }]) }, log0, true)
            logPuri('abertura', r0.tipo, (at0 ? '' : intencao + '_') + mot0)
            return json({ ok: true, ...r0 })
          }
          const upd: Record<string, unknown> = { intencao, historico: empilharHistorico(lead.historico, [{ r: 'u', t: texto.slice(0, 300) }]) }
          if (['consumir', 'provar', 'revender', 'duvida'].includes(intencao)) upd.fluxo = intencao
          await grava(upd, logReq, motivoAb === 'ok')
          logPuri('abertura', 'intencao', motivoAb, { intencao })
          return json({ ok: true, tipo: 'intencao', intencao })
        }
        // dúvida
        const hist = empilharHistorico(lead.historico, [])
        const turnoU: Turno = { r: 'u', t: texto.slice(0, 300) }
        const gravaHist = (extra: Turno[] = []) => grava({ historico: empilharHistorico(hist, [turnoU, ...extra]) }, null, true)
        const at = atalhosDuvida(texto)
        if (at) { await gravaHist([{ r: 'a', t: at.r.texto.slice(0, 300) }]); logPuri('duvida', at.logTipo, at.motivo); return json({ ok: true, ...at.r }) }
        const logD = logReq
        const { r, motivo } = await responderDuvida(texto, hist, logD, 'duvida', Date.now())
        await grava({ historico: empilharHistorico(hist, [turnoU, { r: 'a', t: r.texto.slice(0, 300) }]) }, logD, true)
        logPuri('duvida', r.tipo, motivo)
        return json({ ok: true, ...r })
      } catch (e) {
        const m = (e as Error)?.message || ''
        logPuri(etapa, 'humano', /Anthropic|anthropic/.test(m) ? 'haiku_falhou' : 'jev_falhou')
        console.error('assistente falha')
        try {
          await grava({ historico: empilharHistorico(lead.historico, [{ r: 'u', t: texto.slice(0, 300) }]) }, logReq, false)
        } catch { /* melhor esforço */ }
        return json({ ok: true, tipo: 'humano', texto: TXT_RESERVA })
      }
    }

    /* ── catalogo (público, sem token) ── */
    if (acao === 'catalogo') {
      if (!await limiteIpOk(sb, P, 'puri-cat:', req, LIMITE_CATALOGO_IP_DIA)) return json({ ok: false, motivo: 'limite_dia' })
      const { data: cfg, error: e1 } = await sb.from('delivery_config').select('config').eq('id', 1).maybeSingle()
      if (e1 || !cfg) return json({ ok: false, motivo: 'erro' })
      const ids: number[] = Array.isArray(cfg.config?.produtos) ? cfg.config.produtos.map(Number).filter(Number.isFinite) : []
      const { data: dels, error: e2 } = await sb.from('products').select('id, preco, litros').in('id', ids.length ? ids : [-1])
      const { data: atas, error: e3 } = await sb.from('products').select('id, nome, preco, litros').eq('tipo', 'atacado').in('litros', [5, 10])
      if (e2 || e3) return json({ ok: false, motivo: 'erro' })
      const comLitros = (dels ?? []).filter((p: any) => Number(p.litros) > 0).sort((a: any, b: any) => Number(a.preco) - Number(b.preco))
      if (!comLitros.length) return json({ ok: false, motivo: 'erro' })
      const acai = (litros: number) => (atas ?? [])
        .filter((p: any) => Number(p.litros) === litros && normalizarCidade(p.nome).includes('acai'))
        .sort((a: any, b: any) => a.id - b.id)[0]
      const c10 = acai(10)
      const c5 = acai(5)
      if (!c10) return json({ ok: false, motivo: 'erro' })
      const minRaw = Number(cfg.config?.pedido_minimo_delivery)
      return json({
        ok: true,
        minimo: Number.isFinite(minRaw) && minRaw > 0 ? minRaw : null,
        delivery: { a_partir_de: Number(comLitros[0].preco), produto_id: comLitros[0].id },
        atacado: { caixa10: { preco: Number(c10.preco), litros: 10 }, caixa5: c5 ? { preco: Number(c5.preco), litros: 5 } : null },
      })
    }

    /* ── visita (F3): pedido de visita do vendedor; dados estruturados nunca vão a Jev/Haiku/log ── */
    if (acao === 'visita') {
      const token = typeof body.token === 'string' ? body.token : ''
      if (!UUID_RE.test(token)) return json({ ok: false, motivo: 'token_invalido' })
      const val = validarVisita(body)
      if (!val.ok) return json({ ok: false, motivo: val.motivo })
      const { data: lead, error: e1 } = await sb.from('qualificacao_leads').select('id, visita_status')
        .eq('token', token).eq('origem', 'puri').maybeSingle()
      if (e1) return json({ ok: false, motivo: 'erro' })
      if (!lead) return json({ ok: false, motivo: 'token_invalido' })
      if (lead.visita_status) return json({ ok: false, motivo: 'ja_pedida' })
      const v = val.v
      // cota por IP só é gasta aqui: dados válidos, token existente e visita ainda não pedida
      if (!await limiteIpOk(sb, P, 'puri-vis:', req, LIMITE_VISITA_IP_DIA)) return json({ ok: false, motivo: 'limite_dia' })
      const { data: up, error: e2 } = await sb.from('qualificacao_leads').update({
        nome: v.nome, telefone: v.telefone, cidade: v.cidade, bairro: v.bairro,
        visita_dia: v.dia, visita_periodo: v.periodo, visita_status: 'pedida', visita_em: new Date().toISOString(),
        fluxo: 'provar', quer_amostra: true,
      }).eq('id', lead.id).is('visita_status', null).select('id')
      if (e2) return json({ ok: false, motivo: 'erro' })
      if (!up?.length) return json({ ok: false, motivo: 'ja_pedida' })
      logPuri('visita', 'visita', 'ok')
      return json({ ok: true })
    }

    /* ── converter: liga o lead ao cadastro recém-criado de revendedor (profiles); nada pessoal vai ao Jev ── */
    if (acao === 'converter') {
      const token = typeof body.token === 'string' ? body.token : ''
      const at = typeof body.access_token === 'string' ? body.access_token : ''
      const falha = (motivo: string) => { logPuri('converter', 'erro', motivo); return json({ ok: false, motivo }) }
      if (!UUID_RE.test(token)) return falha('token_invalido')
      if (at.length < 3 || at.length > 4000) return falha('sessao_invalida')
      const { data: lead, error: e1 } = await sb.from('qualificacao_leads').select('id, lead_profile, segmento, movimento, anotacoes, coerente, prioridade, esforco')
        .eq('token', token).eq('origem', 'puri').maybeSingle()
      if (e1) return falha('erro')
      if (!lead) return falha('token_invalido')
      if (lead.lead_profile) return falha('ja_convertido')
      if (!await limiteOk(sb, P, 'puri-conv2:' + token, LIMITE_CONVERTER_TOKEN)) return falha('erro')
      let uid = ''
      try { const { data: u, error: eu } = await sb.auth.getUser(at); if (!eu && u?.user?.id) uid = u.user.id } catch { /* sessão inválida */ }
      if (!uid) return falha('sessao_invalida')
      const { data: pf, error: e2 } = await sb.from('profiles').select('id, role, created_at, nome, telefone').eq('id', uid).maybeSingle()
      if (e2) return falha('erro')
      if (!pf || pf.role !== 'revendedor' || !(Date.now() - new Date(pf.created_at).getTime() <= 30 * 60 * 1000)) return falha('sessao_invalida')
      const { data: ja, error: eja } = await sb.from('qualificacao_leads').select('id').eq('lead_profile', uid).limit(1)
      if (eja) return falha('erro')
      if (ja?.length) return falha('ja_convertido')
      const jaTemPrioridade = lead.prioridade != null // o destino já gravou: não recalcula
      const prioridade = jaTemPrioridade ? lead.prioridade : (await tetoEstourado() ? null : await prioridadeLead({ ...lead, esforco: lead.esforco })) // teto de custo: converte sem prioridade (não trava o cadastro)
      const { data: up, error: e3 } = await sb.from('qualificacao_leads').update({ lead_profile: uid, status: 'convertido', ...(jaTemPrioridade ? {} : { prioridade }), ...(typeof pf.nome === 'string' && pf.nome.trim() ? { nome: pf.nome.trim().slice(0, 80) } : {}), ...(normalizarTelefone(pf.telefone) ? { telefone: normalizarTelefone(pf.telefone) } : {}) })
        .eq('id', lead.id).is('lead_profile', null).select('id')
      if (e3) return falha('erro')
      if (!up?.length) return falha('ja_convertido')
      logPuri('converter', 'convertido', 'ok', { prioridade: String(prioridade) })
      return json({ ok: true })
    }

    /* ── revenda (4B-1): segmento / perfil / escutar / simulacao; token de lead 'puri' obrigatório ── */
    if (acao === 'revenda') {
      const token = typeof body.token === 'string' ? body.token : ''
      const passo = typeof body.passo === 'string' ? body.passo : ''
      const PASSOS = ['segmento', 'interpretar', 'qualif', 'lista_espera', 'confirma_acai', 'opcoes_compra', 'esclarecer_resp', 'perfil', 'escutar', 'simulacao', 'aprofundar', 'aprofundar_resp', 'palpite', 'palpite_resp', 'palpite_escolha', 'resumo', 'resumo_resp', 'mapa', 'mapa_ajuste', 'mapa_ok', 'destino', 'contato', 'conversao_falhou']
      const falha = (motivo: string) => { logPuri('revenda', 'erro', motivo, { passo: PASSOS.includes(passo) ? passo : '?' }); return json({ ok: false, motivo }) }
      if (!UUID_RE.test(token)) return falha('token_invalido')
      if (!PASSOS.includes(passo)) return falha('dados_invalidos')
      const { data: lead } = await sb.from('qualificacao_leads').select('id, turns, historico, segmento, movimento, cidade, bairro, resumo, anotacoes, telefone, jev_log, criado_em, coerente, destino, lead_profile')
        .eq('token', token).eq('origem', 'puri').maybeSingle()
      if (!lead) return falha('token_invalido')
      // normaliza para objeto (mutado no lugar pelo portão, para o marcador conv_contada não se perder nas gravações seguintes)
      if (!lead.anotacoes || typeof lead.anotacoes !== 'object' || Array.isArray(lead.anotacoes)) lead.anotacoes = {}
      if (passoBloqueadoPorConsumo(lead.anotacoes, passo)) return falha('fora_de_ordem') // quem respondeu 'consumo' não volta à revenda (nem regrava fluxo/destino)
      /** Mesmos limites da `mensagem` (falha fechada). */
      const portao = async (): Promise<string | null> => {
        if ((lead.turns ?? 0) >= lim(LIMITE_MSG_CONVERSA)) return 'limite_conversa'
        const { dia } = diaCuiaba()
        if (!await limiteIpOk(sb, P, 'puri-ipm:', req, LIMITE_MSG_IP_DIA)) return 'limite_ip_dia'
        if (!await limiteOk(sb, P, 'puri-tok:' + token, LIMITE_TOK_BRUTO)) return 'limite_conversa'
        const anotR = lead.anotacoes as Record<string, unknown>
        if (anotR.conv_contada !== true) {
          if (!await limiteOk(sb, P, 'puri-conv-' + dia, LIMITE_CONVERSAS_DIA)) return 'limite_conversas_dia'
          anotR.conv_contada = true
          await mesclarLead(sb, lead.id, { conv_contada: true })
        }
        if (!await limiteOk(sb, P, 'puri-global-' + dia, LIMITE_MSG_DIA)) return 'limite_global_dia'
        return null
      }
      /** Portão das ações que chamam IA: trava de custo + limites. */
      const portaoIA = async (): Promise<string | null> => (await tetoEstourado()) ? 'limite_custo' : await portao()
      /** soma=false: grava o que houver mas NÃO consome turno (falha técnica da IA). */
      /** `extra`: colunas simples (nunca anotacoes/jev_log/turns). `patch`: chaves de anotacoes que ESTA requisição mudou (mescla atômica no banco; `qualif` é mesclado campo a campo). `logNovo`: só as entradas novas do jev_log. */
      const conta = async (extra: Record<string, unknown> = {}, soma = true, patch?: Record<string, unknown>, logNovo?: EntradaJev[]): Promise<{ error: unknown }> => {
        const r1 = await sb.from('qualificacao_leads').update({ fluxo: 'revender', intencao: 'revender', ...extra }).eq('id', lead.id)
        if (r1.error) return r1
        return await mesclarLead(sb, lead.id, patch, logNovo, soma)
      }

      if (passo === 'segmento') {
        const v = validarTexto(body.texto)
        if (!v.ok) return falha('texto_invalido')
        const g = await portaoIA(); if (g) return falha(g)
        const texto = mascarar(v.texto)
        let segmento = 'outro'
        let confianca = 0
        let sugestoes: string[] = topSegmentos(null, 'outro')
        let segOk = true
        const logSeg: EntradaJev[] = []
        try {
          const cs = await classificarSegmento(texto)
          segmento = cs.segmento; confianca = cs.confianca; sugestoes = cs.sugestoes
          jl(logSeg, 'segmento', 'segmento', confianca, confianca >= LIMIARES.SEGMENTO_P_MIN ? 'aceita' : 'sugere_tres')
        } catch (e) { segOk = false; console.error('segmento falha', codErro(e)) }
        await conta({ segmento, negocio: texto.slice(0, 120) }, segOk, undefined, logSeg)
        logPuri('revenda', 'segmento', 'ok', { segmento })
        return json({ ok: true, segmento, confianca, sugestoes })
      }

      if (passo === 'perfil') {
        const val = validarPerfil(body)
        if (!val.ok) return falha('dados_invalidos')
        const g = await portaoIA(); if (g) return falha(g)
        const v = val.v
        const logPf: EntradaJev[] = []
        const co = await coerencia(v.segmento, v.movimento, v.foraArea, logPf, lead.anotacoes)
        const coerente = co.coerente
        let esclarecer: { pergunta: string } | null = null
        if (coerente === false && co.desencontro) {
          try {
            const q = await escreverEsclarecer(co.desencontro, logPf)
            if (q) esclarecer = { pergunta: q }
          } catch (e) { console.error('esclarecer falha', codErro(e)) }
        }
        const { error } = await conta({ segmento: v.segmento, cidade: v.cidade, bairro: v.bairro, movimento: v.movimento, coerente }, true, body.retira === undefined ? undefined : { retira: v.retira }, logPf)
        if (error) return falha('erro')
        logPuri('revenda', 'perfil', 'ok', { fora: v.foraArea ? 's' : 'n', esclarece: esclarecer ? 's' : 'n' })
        return json({ ok: true, fora_area: v.foraArea, coerente, ...(esclarecer ? { esclarecer } : {}) })
      }

      if (passo === 'escutar') {
        const v = validarTexto(body.texto)
        if (!v.ok) return falha('texto_invalido')
        const final = body.final === true
        const texto = mascarar(v.texto)
        if (!final) {
          // rascunho: cotas próprias (não gasta turns nem os limites da mensagem); falha fechada
          if (texto.length < 25) return json({ ok: true, anotacoes: null })
          if (await tetoEstourado()) return json({ ok: true, anotacoes: null })
          const { dia } = diaCuiaba()
          if (!await limiteOk(sb, P, 'puri-esc:' + token, LIMITE_ESCUTAR_TOKEN) ||
              !await limiteIpOk(sb, P, 'puri-escip:', req, LIMITE_ESCUTAR_IP_DIA) ||
              !await limiteOk(sb, P, 'puri-escg-' + dia, LIMITE_ESCUTAR_GLOBAL_DIA)) return json({ ok: true, anotacoes: null })
        } else { const g = await portaoIA(); if (g) return falha(g) }
        const iniEscuta = Date.now()
        let anotacoes: string[] | null = null
        // resultados da leitura do Jev (só no final); declarados aqui para rodar em paralelo com os tópicos do Haiku
        const logEsc: EntradaJev[] = []
        let naoAcai = false
        let cena: { chave: string; cartoes: { cenario: string; trava: string; chegar: string } } | null = null
        let leituraGrava: Record<string, unknown> | null = null
        let ini: number | null = null
        const topicos = async () => {
          try {
            let rodar = final && texto.length >= 15
            if (!final) rodar = noul(await jev(
              { shop: SHOP, customer_message: semMarcadores(texto) },
              JEV_ESCUTA,
            'jev_escuta'), 'suficiente') >= LIMIARES.SUFICIENTE_MIN
            if (rodar) anotacoes = await haikuTopicos(texto)
          } catch (e) { console.error('escutar falha', codErro(e)) }
        }
        // grande leitura (uma chamada ao Jev) + cartões da cena; qualquer falha segue sem nao_acai e sem cena
        const leitura = async () => {
          if (texto.length >= 3 && LIMIARES.ESCUTAR_FINAL_PRAZO_MS - (Date.now() - iniEscuta) >= 4000) {
            try {
              const a = await jev({ shop: SHOP, customer_message: semMarcadores(texto) },
                { e_sobre_vender_acai: JEV_LEITURA.e_sobre_vender_acai, cenario_suficiente: JEV_LEITURA.cenario_suficiente, iniciante: JEV_LEITURA.iniciante, ...JEV_LEITURA_CENA },
              'jev_leitura')
              const eAcai = noul(a, 'e_sobre_vender_acai'), cenario = noul(a, 'cenario_suficiente'), inic = noul(a, 'iniciante')
              const cch = a?.cena?.choice
              const cp = a?.cena?.probabilities?.[cch] ?? a?.cena?.confidence ?? 1
              const chave = typeof cch === 'string' && SEGMENTOS.includes(cch) && (typeof cp !== 'number' || cp >= LIMIARES.SEGMENTO_P_MIN) ? cch : 'outro'
              ini = inic
              leituraGrava = { e_acai: Number(eAcai.toFixed(2)), cenario: Number(cenario.toFixed(2)), iniciante: Number(inic.toFixed(2)), cena: chave }
              naoAcai = eAcai < LIMIARES.E_ACAI_MIN
              jl(logEsc, 'escutar', 'e_sobre_vender_acai', eAcai, naoAcai ? 'nao_acai' : 'ok')
              jl(logEsc, 'escutar', 'cenario_suficiente', cenario, cenario >= LIMIARES.CENARIO_MIN && !naoAcai ? 'escreve_cartoes' : 'sem_cena')
              jl(logEsc, 'escutar', 'iniciante', inic, inic >= LIMIARES.INICIANTE_MIN ? 'vai_comecar' : 'nada')
              jl(logEsc, 'escutar', 'cena', typeof cp === 'number' ? cp : 1, chave)
              if (!naoAcai && cenario >= LIMIARES.CENARIO_MIN) {
                const cartoes = await escreverCartoes(texto, logEsc, iniEscuta + LIMIARES.ESCUTAR_FINAL_PRAZO_MS)
                if (cartoes) cena = { chave, cartoes }
              }
            } catch (e) { console.error('leitura falha', codErro(e)); naoAcai = false; cena = null }
          } else jl(logEsc, 'escutar', 'prazo', 0, 'sem_leitura')
        }
        if (final) await Promise.all([topicos(), leitura()]); else await topicos()
        if (final) {
          // o texto da escuta fica em `anotacoes` (patch mesclado no banco); NÃO entra no `historico` (que alimenta a dúvida)
          await conta({}, anotacoes !== null, montarPatch({ quer: texto.slice(0, 500), topicos: anotacoes ?? [], leitura: leituraGrava ?? undefined, iniciante: ini != null ? Number((ini as number).toFixed(2)) : undefined }), logEsc)
          logPuri('revenda', 'escutar', anotacoes ? 'ok' : 'sem_anotacao', { final: 's', nao_acai: naoAcai ? 's' : 'n', cena: cena ? 's' : 'n' })
          return json({ ok: true, anotacoes, ...(naoAcai ? { nao_acai: true } : {}), ...(cena ? { cena } : {}) })
        }
        logPuri('revenda', 'escutar', anotacoes ? 'ok' : 'sem_anotacao', { final: final ? 's' : 'n' })
        return json({ ok: true, anotacoes })
      }

      /* ── 4B-2: aprofundar / palpite / resumo (anotacoes mescladas; nenhum dado pessoal vai à IA) ── */
      const anot = (lead.anotacoes && typeof lead.anotacoes === 'object' && !Array.isArray(lead.anotacoes)) ? lead.anotacoes as Record<string, unknown> : {}

      /** Passos de código puro (sem IA, sem turno): só o teto bruto de requisições por conversa. */
      const leve = async (): Promise<string | null> => await limiteOk(sb, P, 'puri-tok:' + token, LIMITE_TOK_BRUTO) ? null : 'limite_conversa'
      const qualifAtual = (anot.qualif && typeof anot.qualif === 'object' && !Array.isArray(anot.qualif)) ? anot.qualif as Record<string, unknown> : {}

      if (passo === 'interpretar') {
        const val = validarInterpretar(body)
        if (!val.ok) return falha('dados_invalidos')
        const v = val.v
        if (await tetoEstourado()) return falha('limite_custo')
        const { dia } = diaCuiaba()
        // cota leve própria: não gasta turno nem os limites da mensagem; falha fechada
        if (!await limiteOk(sb, P, 'puri-int:' + token, LIMITE_INTERPRETAR_TOKEN) ||
            !await limiteIpOk(sb, P, 'puri-intip:', req, LIMITE_INTERPRETAR_IP_DIA) ||
            !await limiteOk(sb, P, 'puri-intg-' + dia, LIMITE_INTERPRETAR_GLOBAL_DIA)) return falha('limite_conversa')
        const logI: EntradaJev[] = []
        let escolha: string | null = null
        let confianca = 0
        try {
          const a = await jev(
            { shop: SHOP, screen_step: v.etapa, customer_text: semMarcadores(v.texto) },
            jevInterpretar(v.opcoes),
          'jev_interpretar')
          const ch = a?.escolha?.choice
          const p = a?.escolha?.probabilities?.[ch] ?? a?.escolha?.confidence
          escolha = decidirInterpretar(ch, p, v.opcoes.map((o) => o.id))
          confianca = typeof p === 'number' ? Number(p.toFixed(2)) : 0
          jl(logI, 'interpretar:' + v.etapa, 'escolha', confianca, escolha ?? 'nenhuma')
        } catch (e) { console.error('interpretar falha', codErro(e)) }
        if (logI.length) await conta({}, false, undefined, logI)
        logPuri('revenda', 'interpretar', escolha ? 'ok' : 'sem_escolha')
        return json({ ok: true, escolha, confianca })
      }

      if (passo === 'qualif') {
        const val = validarQualif(body)
        if (!val.ok) return falha('dados_invalidos')
        const g = await leve(); if (g) return falha(g)
        const { campo, valor, texto } = val.v
        const q = { [campo]: valor, ...(texto ? { [campo + '_texto']: texto } : {}) } // só os campos mudados: o banco mescla com o qualif já gravado
        const { error } = await conta({}, false, { qualif: q })
        if (error) return falha('erro')
        logPuri('revenda', 'qualif', 'ok', { campo })
        return json({ ok: true })
      }

      /* ── Etapa 3: destino (esforço por código, prioridade J10, regras a–e); idempotente; só depois do mapa ── */
      if (passo === 'destino') {
        const visitaDe = (): { cidade: string; bairro: string | null } | null => {
          const chave = normalizarCidade(lead.cidade)
          return Object.hasOwn(CIDADES_VISITA, chave) ? { cidade: CIDADES_VISITA[chave], bairro: typeof lead.bairro === 'string' && lead.bairro.trim() ? lead.bairro.trim().slice(0, 60) : null } : null
        }
        const resposta = (destino: string) => { const v = visitaDe(); return json({ ok: true, destino, ...(v ? { visita: v } : {}) }) }
        if (anot.mapa_ok !== true && anot.mapa_pulou !== true) return falha('fora_de_ordem')
        if (typeof lead.destino === 'string' && lead.destino) return resposta(lead.destino)
        const g = await portao() // barrado (limite/IP/teto): decide só por código, sem IA
        const esforco = calcularEsforco(lead, Date.now())
        const semIA = g !== null || await tetoEstourado()
        const logD: EntradaJev[] = []
        // só rótulos e texto já mascarado: nunca nome, telefone, cidade ou bairro
        const R_JV: Record<string, string> = { ja_vendo: 'already sells açaí', quero_comecar: 'wants to start', outras_coisas: 'sells other things' }
        const R_COM: Record<string, string> = { esta_semana: 'this week', este_mes: 'this month', pesquisando: 'just researching' }
        const R_PAP: Record<string, string> = { dono: 'owner', socio: 'partner', trabalho: 'works at the business', vou_abrir: 'about to open the business' }
        const R_COMPRA: Record<string, string> = { testar_1cx: 'test with 1 box', '30l_mais': '30 L or more per order' }
        const estado = {
          shop: SHOP,
          business_type: ROT_SEG[lead.segmento as string] ? lead.segmento : 'unknown',
          expected_cups_per_day: LABEL_MOV[lead.movimento as string] ?? 'unknown',
          goal: limparIA(anot.quer, 500) || 'unknown',
          topics: Array.isArray(anot.topicos) ? anot.topicos.filter((x: unknown) => typeof x === 'string').slice(0, 4).map((x: string) => limparIA(x, 80)) : [],
          answers: {
            already_sells: R_JV[qualifAtual.ja_vende as string] ?? 'unknown',
            when_to_start: R_COM[qualifAtual.comeco as string] ?? 'unknown',
            role: R_PAP[qualifAtual.papel as string] ?? 'unknown',
            purchase_plan: R_COMPRA[qualifAtual.compra as string] ?? 'unknown',
          },
          effort_score_0_to_3: esforco,
        }
        let consumidor: number | null = null, pontoDefinido: number | null = null, provar: number | null = null
        let prioridade: number | null = null
        const pulou = semIA || anot.lista_espera === true
        if (!semIA && anot.lista_espera !== true) {
          const [rj, rp] = await Promise.all([
            jev(estado, { ...JEV_CONSUMIDOR, ...JEV_PONTO_DEFINIDO, ...JEV_PROVAR }, 'jev_destino').catch((e) => { console.error('destino falha', codErro(e)); return null }),
            prioridadeLead({ ...lead, esforco }),
          ])
          prioridade = rp
          const n = (k: string): number | null => { const v = rj?.[k]?.noul; return typeof v === 'number' ? v : null } // falha = "não"
          consumidor = n('compra_para_consumo'); pontoDefinido = n('ponto_definido'); provar = n('ganha_provando')
        }
        const entrada: EntradaDestino = {
          listaEspera: anot.lista_espera === true,
          jaVende: qualifAtual.ja_vende, movimento: lead.movimento, coerente: (lead as any).coerente,
          comeco: qualifAtual.comeco, cidade: lead.cidade, consumidor, pontoDefinido, provar,
        }
        const { destino, regra } = escolherDestino(entrada)
        jl(logD, 'destino', 'consumidor', consumidor ?? 0, consumidor == null ? (pulou ? 'pulado' : 'jev_falhou') : consumidor >= LIMIARES.CONSUMIDOR_MIN ? 'delivery' : 'nada')
        jl(logD, 'destino', 'ponto_definido', pontoDefinido ?? 0, pontoDefinido == null ? (pulou ? 'pulado' : 'jev_falhou') : pontoDefinido >= LIMIARES.PONTO_DEFINIDO_MIN ? 'ponto_definido' : 'nada')
        jl(logD, 'destino', 'ganha_provando', provar ?? 0, provar == null ? (pulou ? 'pulado' : 'jev_falhou') : provar >= LIMIARES.PROVAR_MIN ? 'visita_se_cuiaba_vg' : 'nada')
        jl(logD, 'destino', 'escolha', esforco, destino + ':' + regra)
        const agora = new Date().toISOString()
        const { data: up, error: eu } = await sb.from('qualificacao_leads').update({ destino, destino_em: agora, esforco, prioridade, fluxo: 'revender', intencao: 'revender' })
          .eq('id', lead.id).is('destino', null).select('id')
        if (eu) return falha('erro')
        if (!up?.length) { // outra requisição decidiu primeiro: devolve o mesmo destino
          const { data: l2 } = await sb.from('qualificacao_leads').select('destino').eq('id', lead.id).maybeSingle()
          if (l2?.destino) return resposta(l2.destino)
          return falha('erro')
        }
        await mesclarLead(sb, lead.id, undefined, logD, false)
        logPuri('revenda', 'destino', 'ok', { destino, regra, esforco: String(esforco), prioridade: String(prioridade) })
        return resposta(destino)
      }

      /* ── Etapa 3: contato rápido ("Só quero que me chamem"): nome e telefone só nas colunas do lead ── */
      if (passo === 'contato') {
        if (lead.destino !== 'contato_rapido') return falha('fora_de_ordem')
        const val = validarListaEspera(body, false)
        if (!val.ok) return json({ ok: false, motivo: 'dados_invalidos' })
        const g = await leve(); if (g) return falha(g)
        if (lead.telefone) return json({ ok: false, motivo: 'ja_registrado' })
        const v = val.v
        const { error } = await conta({ nome: v.nome, telefone: v.telefone }, false, { so_contato: true })
        if (error) return falha('erro')
        if (!await limiteIpOk(sb, P, 'puri-contato:', req, LIMITE_CONTATO_IP_DIA)) {
          await sb.from('qualificacao_leads').update({ nome: null, telefone: null }).eq('id', lead.id)
          await mesclarLead(sb, lead.id, { so_contato: false })
          return json({ ok: false, motivo: 'limite_dia' })
        }
        logPuri('revenda', 'contato', 'ok')
        return json({ ok: true })
      }

      /* ── Etapa 3: o navegador avisa que o converter falhou mesmo depois das tentativas ── */
      if (passo === 'conversao_falhou') {
        if (!(typeof lead.destino === 'string' && lead.destino)) return falha('fora_de_ordem')
        if (lead.lead_profile) return json({ ok: true }) // já convertido: ignora
        const g = await leve(); if (g) return falha(g)
        const { error } = await conta({}, false, { conversao_falhou: true })
        if (error) return falha('erro')
        logPuri('revenda', 'conversao_falhou', 'ok')
        return json({ ok: true })
      }

      if (passo === 'lista_espera') {
        const val = validarListaEspera(body)
        if (!val.ok) return json({ ok: false, motivo: 'dados_invalidos' })
        const g = await leve(); if (g) return falha(g)
        if (anot.lista_espera === true || lead.telefone) return json({ ok: false, motivo: 'ja_registrado' })
        const v = val.v
        // dados pessoais só nas colunas do lead: nada vai à IA nem ao jev_log
        const { error } = await conta({ nome: v.nome, telefone: v.telefone, cidade: v.cidade }, false, { lista_espera: true })
        if (error) return falha('erro')
        // cota por IP só é cobrada com dados válidos e depois de a gravação dar certo; se estourou, desfaz o registro
        if (!await limiteIpOk(sb, P, 'puri-lista:', req, LIMITE_LISTA_ESPERA_IP_DIA)) {
          await sb.from('qualificacao_leads').update({ nome: null, telefone: null, cidade: lead.cidade ?? null }).eq('id', lead.id)
          await mesclarLead(sb, lead.id, { lista_espera: false })
          return json({ ok: false, motivo: 'limite_dia' })
        }
        logPuri('revenda', 'lista_espera', 'ok')
        return json({ ok: true })
      }

      if (passo === 'confirma_acai') {
        if (!ehConfirmaAcai(body.valor)) return falha('dados_invalidos')
        const g = await leve(); if (g) return falha(g)
        // 'consumo': a pessoa quer comprar pra si; o navegador a leva ao delivery, o servidor só registra
        const { error } = await conta(body.valor === 'consumo' ? { fluxo: 'consumir', intencao: 'consumir' } : {}, false, { confirma_acai: body.valor, nao_acai: { sim: false, nao: true, consumo: true }[body.valor as string] ?? true })
        if (error) return falha('erro')
        logPuri('revenda', 'confirma_acai', 'ok', { valor: String(body.valor) })
        return json({ ok: true })
      }

      if (passo === 'opcoes_compra') {
        const g = await leve(); if (g) return falha(g)
        const ini = typeof anot.iniciante === 'number' ? anot.iniciante : null
        const o = ordenarOpcoesCompra(qualifAtual.ja_vende, lead.movimento, ini)
        const logC: EntradaJev[] = []
        jl(logC, 'compra', 'ordem_opcoes', o.opcoes[0].id, o.motivo)
        await conta({}, false, undefined, logC)
        logPuri('revenda', 'opcoes_compra', o.motivo)
        return json({ ok: true, opcoes: o.opcoes, explicacao: TXT_EXPLICA_COMPRA })
      }

      if (passo === 'esclarecer_resp') {
        const v = validarTexto(body.texto)
        if (!v.ok || v.texto.length > 300) return falha('texto_invalido')
        const g = await leve(); if (g) return falha(g)
        const { error } = await conta({}, false, { esclarecimento: mascarar(v.texto).slice(0, 300) })
        if (error) return falha('erro')
        logPuri('revenda', 'esclarecer_resp', 'ok')
        return json({ ok: true })
      }

      if (passo === 'aprofundar') {
        // idempotente: já perguntou (com ou sem resposta) -> devolve a mesma pergunta, sem IA e sem turno
        if (typeof anot.aprof_pergunta === 'string' && anot.aprof_pergunta) {
          const rs = Array.isArray(anot.aprof_respostas) ? anot.aprof_respostas.filter((x: unknown) => typeof x === 'string') as string[] : []
          return json({ ok: true, pergunta: anot.aprof_pergunta, respostas: rs })
        }
        const g = await portaoIA(); if (g) return falha(g)
        const ctx = contextoRevenda(lead)
        const logA: EntradaJev[] = []
        let r: { pergunta: string; respostas: string[] } | null = null
        if (ctx) { try { r = await aprofundar(ctx, logA, Date.now() + LIMIARES.APROFUNDAR_PRAZO_MS) } catch (e) { console.error('aprofundar falha', codErro(e)) } }
        await conta({}, !!r, r ? { aprof_pergunta: r.pergunta, aprof_respostas: r.respostas } : undefined, logA)
        logPuri('revenda', 'aprofundar', r ? 'ok' : (ctx ? 'sem_pergunta' : 'sem_contexto'))
        return json(r ? { ok: true, pergunta: r.pergunta, respostas: r.respostas } : { ok: true, pergunta: null })
      }

      if (passo === 'aprofundar_resp') {
        const v = validarTexto(body.texto)
        if (!v.ok || v.texto.length > 300) return falha('texto_invalido')
        const g = await portao(); if (g) return falha(g)
        const texto = mascarar(v.texto).slice(0, 300)
        await conta({}, true, { aprof_resposta: texto })
        logPuri('revenda', 'aprofundar_resp', 'ok')
        return json({ ok: true })
      }

      if (passo === 'palpite') {
        // idempotente: o front tem timeout menor que a Edge; "tentar de novo" não gera outro palpite
        if (typeof anot.palpite === 'string' && anot.palpite) return json({ ok: true, palpite: anot.palpite })
        const g = await portaoIA(); if (g) return falha(g)
        const ctx = contextoRevenda(lead)
        const logP: EntradaJev[] = []
        let p: string | null = null
        const foraAcai = semPalpitePorAcai(anot)
        if (foraAcai) jl(logP, 'palpite', 'nao_acai', 0, 'sem_palpite')
        else if (ctx) { try { p = await palpiteRevenda(ctx, logP, Date.now() + LIMIARES.PALPITE_PRAZO_MS) } catch (e) { console.error('palpite falha', codErro(e)) } }
        await conta({}, !!p, p ? { palpite: p } : undefined, logP)
        logPuri('revenda', 'palpite', p ? 'ok' : (foraAcai || ctx ? 'sem_palpite' : 'sem_contexto'))
        return json({ ok: true, palpite: p })
      }

      if (passo === 'palpite_resp') {
        if (typeof body.texto === 'string' && body.texto.length > 300) return falha('texto_invalido')
        const pr = validarPalpiteResp(body.valor, body.texto)
        if (!pr) return falha('dados_invalidos')
        const gerar = pr.valor !== 'mosca' && !!pr.correcao
        const g = gerar ? await portaoIA() : await portao(); if (g) return falha(g)
        const logR: EntradaJev[] = []
        let alternativas: string[] = []
        if (gerar) {
          const ctx = contextoRevenda({ ...lead, anotacoes: { ...anot, palpite_valor: pr.valor, palpite_correcao: pr.correcao } }, { palpite: true })
          if (ctx) { try { alternativas = await alternativasPalpite(ctx, pr.correcao as string, logR, Date.now() + LIMIARES.ALT_PRAZO_MS) } catch (e) { console.error('palpite_alt falha', codErro(e)) } }
        }
        await conta({}, true, { palpite_valor: pr.valor, palpite_correcao: pr.correcao, ...(gerar ? { palpite_alternativas: alternativas } : {}) }, logR)
        logPuri('revenda', 'palpite_resp', 'ok', { valor: pr.valor, alts: String(alternativas.length) })
        return json({ ok: true, alternativas })
      }

      if (passo === 'palpite_escolha') {
        const alts = Array.isArray(anot.palpite_alternativas) ? anot.palpite_alternativas.filter((x: unknown) => typeof x === 'string') as string[] : []
        const i = body.indice
        if (i !== null && !(Number.isInteger(i) && i >= 0 && i < alts.length)) return falha('dados_invalidos')
        const g = await leve(); if (g) return falha(g)
        const final = i === null ? (typeof anot.palpite_correcao === 'string' ? anot.palpite_correcao : null) : alts[i as number]
        const { error } = await conta({}, false, { palpite_final: final })
        if (error) return falha('erro')
        logPuri('revenda', 'palpite_escolha', 'ok', { origem: i === null ? 'correcao' : 'alternativa' })
        return json({ ok: true })
      }

      if (passo === 'resumo' || passo === 'resumo_resp') {
        const dev = (r: ResumoR) => ({ ok: true, resumo: r.resumo, problema: r.problema, termo: r.termo })
        const logR: EntradaJev[] = []
        if (passo === 'resumo') {
          if (typeof lead.resumo === 'string' && lead.resumo && typeof anot.problema === 'string') return json({ ok: true, resumo: lead.resumo, problema: anot.problema, termo: typeof anot.termo === 'string' ? anot.termo : null })
          const g = await portaoIA(); if (g) return falha(g)
          let ctx = contextoRevenda(lead, { palpite: true })
          let r: ResumoR | null = null
          if (ctx) {
            const fim = Date.now() + LIMIARES.RESUMO_PRAZO_MS
            try {
              const mudou = await objetivoMudou(ctx, limparIA(anot.quer, 500), logR)
              r = await resumoRevenda(ctx, logR, fim, mudou ? `\n<nota>${NOTA_OBJETIVO_MUDOU}</nota>` : '')
            } catch (e) { console.error('resumo falha', codErro(e)) }
          }
          await conta(r ? { resumo: r.resumo.slice(0, 300) } : {}, !!r, r ? { problema: r.problema, ...(r.termo ? { termo: r.termo } : {}) } : undefined, logR)
          logPuri('revenda', 'resumo', r ? 'ok' : (ctx ? 'sem_resumo' : 'sem_contexto'))
          return json(r ? dev(r) : { ok: true, resumo: null })
        }
        // resumo_resp
        if (body.valor !== 'ok' && body.valor !== 'corrigir') return falha('dados_invalidos')
        if (body.valor === 'ok') {
          const g = await portao(); if (g) return falha(g)
          await conta({}, false, { resumo_ok: true })
          logPuri('revenda', 'resumo_resp', 'ok')
          return json({ ok: true })
        }
        const v = validarTexto(body.texto)
        if (!v.ok || v.texto.length > 300) return falha('texto_invalido')
        const correcao = mascarar(v.texto).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
        if (correcao.length < 2) return falha('texto_invalido')
        if (anot.resumo_corrigido === true) { logPuri('revenda', 'resumo_resp', 'ja_corrigido'); return json({ ok: true }) } // só 1 vez por lead
        const g = await portaoIA(); if (g) return falha(g)
        const base = contextoRevenda(lead, { palpite: true })
        let r: ResumoR | null = null
        if (base && typeof lead.resumo === 'string' && lead.resumo) {
          // a correção entra no contexto do Haiku e do Jev: é o que a pessoa disse, então não é invenção
          const ctx = inserirNoContexto(base, '\nResumo mostrado: ' + limparIA(lead.resumo, 300) + '\nCorreção da pessoa sobre o resumo: ' + correcao)
          try { r = await resumoRevenda(ctx, logR, Date.now() + LIMIARES.RESUMO_PRAZO_MS, `\n<correcao_da_pessoa>${correcao}</correcao_da_pessoa>`) } catch (e) { console.error('resumo_resp falha', codErro(e)) }
        }
        await conta(r ? { resumo: r.resumo.slice(0, 300) } : {}, !!r, { resumo_corrigido: true, ...(r ? { problema: r.problema, termo: r.termo ?? null } : {}) }, logR)
        logPuri('revenda', 'resumo_resp', r ? 'corrigido' : 'sem_resumo')
        return json(r ? dev(r) : { ok: true })
      }

      /* ── 5B: mapa do caso ── */
      if (passo === 'mapa' || passo === 'mapa_ajuste' || passo === 'mapa_ok') {
        const t0 = Date.now()
        const atual: MapaCaso | null = anot.mapa && typeof anot.mapa === 'object' && Array.isArray((anot.mapa as any).nos) ? anot.mapa as MapaCaso : null
        const ajustesAtuais = typeof anot.mapa_ajustes === 'number' ? anot.mapa_ajustes : 0

        if (passo === 'mapa_ok') {
          const pulou = body.pulou === true
          if (!atual && !pulou) return falha('dados_invalidos')
          if (!await limiteOk(sb, P, 'puri-tok:' + token, LIMITE_TOK_BRUTO)) return falha('limite_conversa')
          await conta({}, true, pulou ? { mapa_pulou: true } : { mapa_ok: true })
          logPuri('revenda', 'mapa_ok', 'ok')
          return json({ ok: true })
        }

        const a = lead.anotacoes && typeof lead.anotacoes === 'object' ? lead.anotacoes as any : {}
        const base = () => {
          const ctx = contextoRevenda(lead, { palpite: 'confirmado' })
          if (!ctx) return null
          const resumo = typeof lead.resumo === 'string' && lead.resumo ? '\nResumo: ' + limparIA(lead.resumo, 300) : ''
          const prob = typeof a.problema === 'string' && a.problema ? '\nProblema: ' + limparIA(a.problema, 80) : ''
          return ctx + resumo + prob
        }

        if (passo === 'mapa') {
          if (atual) return json(atual.simples ? { ok: true, mapa: atual, simples: true } : { ok: true, mapa: atual }) // idempotente: sem IA, sem turno
          if (!a.problema && !a.quer) { logPuri('revenda', 'mapa', 'sem_contexto'); return json({ ok: true, mapa: null }) }
          const g = await portaoIA(); if (g) return falha(g)
          const user = base()
          let r: { ia: MapaIA | null; j8: number | null } = { ia: null, j8: null }
          // DIAGNOSTICO: so existe quando o pathname contem /assistente-dev (nunca na producao /assistente) E body.debug === true
          const trace: unknown[] | undefined = body.debug === true && /^(\/functions\/v1)?\/assistente-dev\/?$/.test(new URL(req.url).pathname) ? [] : undefined // regex ancorada: /assistente/assistente-dev (subcaminho na producao) NAO passa
          const logM: EntradaJev[] = []
          if (user) { try { r = await gerarMapaIA(SYS_H6, user, logM, t0 + LIMIARES.MAPA_PRAZO_MS, trace) } catch (e) { console.error('mapa falha', codErro(e)) } }
          const mapa = montarMapa(lead, r.ia, null, 0)
          await conta({}, !!r.ia, { mapa, mapa_ajustes: 0 }, logM)
          logPuri('revenda', 'mapa', r.ia ? 'ok' : 'simples', { j8: r.j8 == null ? 'na' : r.j8.toFixed(2) })
          return json({ ok: true, mapa, ...(mapa.simples ? { simples: true } : {}), ...(trace ? { dbg: trace } : {}) })
        }

        // mapa_ajuste
        const v = validarTexto(body.texto)
        if (!v.ok || v.texto.length > 200) return falha('texto_invalido')
        const pedido = mascarar(v.texto).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
        if (pedido.length < 4) return falha('texto_invalido')
        if (!atual) return falha('dados_invalidos')
        if (ajustesAtuais >= 2) return falha('limite_ajuste')
        const g = await portaoIA(); if (g) return falha(g)
        const ctx = base()
        const tx = (tipo: string) => atual.nos.find((n) => n.tipo === tipo)?.texto ?? ''
        const risco = tx('risco')
        const anteriores: string[] = (Array.isArray(a.mapa_pedidos) ? a.mapa_pedidos.filter((x: unknown) => typeof x === 'string') : []).slice(-2)
        // os pedidos de ajuste entram no contexto (H7 e J8): é o que a pessoa disse, então não é invenção
        const user = ctx ? '<contexto>\n' + ctx.replace(/<\/?contexto>/g, '').trim() + '\nAjustes pedidos pela pessoa: ' + anteriores.concat(pedido).join('; ') + '\nMapa atual: problema: ' + tx('problema') + '; causa: ' + tx('causa') + '; risco: ' + (risco || 'nenhum') + '; destino: ' + tx('destino') + '\nPedido de ajuste: ' + pedido + '\n</contexto>' : null
        let r: { ia: MapaIA | null; j8: number | null } = { ia: null, j8: null }
        const traceA: unknown[] | undefined = body.debug === true && /^(\/functions\/v1)?\/assistente-dev\/?$/.test(new URL(req.url).pathname) ? [] : undefined
        const logM: EntradaJev[] = []
        if (user) { try { r = await gerarMapaIA(SYS_H7, user, logM, t0 + LIMIARES.MAPA_PRAZO_MS, traceA) } catch (e) { console.error('mapa_ajuste falha', codErro(e)) } }
        const novo = r.ia ? montarMapa(lead, r.ia, atual, ajustesAtuais + 1) : null
        const mudou = !!novo && novo.nos.some((n) => (atual.nos.find((x) => x.tipo === n.tipo)?.texto ?? null) !== n.texto) || (!!novo && novo.nos.length !== atual.nos.length)
        const pedidos = (Array.isArray(a.mapa_pedidos) ? a.mapa_pedidos.filter((x: unknown) => typeof x === 'string') : []).concat(pedido).slice(-2)
        if (!novo || !mudou) {
          await conta({}, false, undefined, logM) // sem mudança não consome turno
          logPuri('revenda', 'mapa_ajuste', 'sem_mudanca', { j8: r.j8 == null ? 'na' : r.j8.toFixed(2) })
          return json(traceA ? { ok: true, mapa: atual, sem_mudanca: true, dbg: traceA } : { ok: true, mapa: atual, sem_mudanca: true })
        }
        await conta({}, true, { mapa: novo, mapa_ajustes: ajustesAtuais + 1, mapa_pedidos: pedidos }, logM)
        logPuri('revenda', 'mapa_ajuste', 'ok', { j8: r.j8 == null ? 'na' : r.j8.toFixed(2) })
        return json(traceA ? { ok: true, mapa: novo, dbg: traceA } : { ok: true, mapa: novo })
      }

      // simulacao: só números calculados aqui (sem Jev/Haiku); preço da caixa lido do banco
      if (!await limiteOk(sb, P, 'puri-tok:' + token, LIMITE_TOK_BRUTO)) return falha('limite_conversa')
      if (!['ate20', '20a50', '50a100', '100mais'].includes(lead.movimento)) return falha('dados_invalidos')
      const { data: atas, error: e3 } = await sb.from('products').select('id, nome, preco, litros').eq('tipo', 'atacado').eq('litros', 10)
      if (e3) return falha('erro')
      const c10 = (atas ?? []).filter((p: any) => normalizarCidade(p.nome).includes('acai')).sort((a: any, b: any) => a.id - b.id)[0]
      const sim = c10 ? calcularSimulacao(body.preco_copo, Number(c10.preco), lead.movimento) : null
      if (!sim) return falha(c10 ? 'dados_invalidos' : 'erro')
      const { error: e4 } = await sb.from('qualificacao_leads').update({ fluxo: 'revender', intencao: 'revender', simulacao: sim }).eq('id', lead.id)
      if (e4) return falha('erro')
      logPuri('revenda', 'simulacao', 'ok')
      return json({ ok: true, simulacao: sim })
    }

    return json({ ok: false, motivo: 'erro' }, 400)
  } catch (e) {
    console.error('assistente erro', codErro(e))
    return json({ ok: false, motivo: 'erro' })
  }
}
