// Dupuro Açaí — assistente Puri: funções PURAS (sem rede, sem Deno.*), testáveis em Node/Deno.

/** Troca telefone, e-mail, CPF/CNPJ e nome por marcadores antes de qualquer chamada/gravação. */
export function mascarar(entrada: string): string {
  let t = String(entrada ?? '')
  // e-mail
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[contato]')
  // CNPJ e CPF (com ou sem pontuação)
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[contato]')
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[contato]')
  // telefone: qualquer sequência com 8+ dígitos (aceita +55, parênteses, espaço, hífen, ponto)
  t = t.replace(/\+?\(?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[contato]' : m))
  // nome: gatilho forte ("meu nome é", "me chamo", "pode me chamar de", "nome:"): nome inteiro em qualquer caixa,
  // até 4 palavras; para na vírgula/ponto, em " e " ou em verbo/pronome comum.
  t = t.replace(
    /\b(meu\s+nome\s+(?:é|e|eh|seria)|me\s+chamo|chamo-me|pode\s+me\s+chamar\s+de|nome\s*:)\s+(?:(?:o|a)\s+)?[\p{L}'’-]+(?:\s+(?!(?:e|que|mas|quero|queria|gostaria|preciso|tenho|moro|trabalho|vocês|voces|voc[eê]|gostei|vim|estou)\b)[\p{L}'’-]+){0,3}/giu,
    '$1 [nome]',
  )
  // nome: gatilho fraco ("sou", "aqui é", "aqui quem fala é"): sequência de palavras Capitalizadas,
  // com conectores minúsculos (da, de, do, das, dos, e) entre elas; ignora palavras comuns (cidade, papel).
  const comuns = /^(Cuiab[aá]|V[aá]rzea|Mato|Brasil|Dono|Dona|Revendedor|Revendedora|Cliente|Novo|Nova)/
  const cap = String.raw`\p{Lu}[\p{L}'’-]*`
  const nomeCap = `${cap}(?:\\s+(?:(?:da|de|do|das|dos|e)\\s+)?${cap}){0,3}`
  t = t.replace(
    new RegExp(`\\b([Ss]ou|[Aa]qui\\s+quem\\s+fala\\s+(?:é|e|eh)|[Aa]qui\\s+(?:é|e|eh))\\s+(?:(?:o|a)\\s+)?(${nomeCap})`, 'gu'),
    (m, lead, nome) => (comuns.test(nome) ? m : `${lead} [nome]`),
  )
  return t
}

export type Validacao = { ok: true; texto: string } | { ok: false }

/** texto: string; remove < e > (o delimitador do prompt fica inviolável); 1–500 chars após trim; vazio → inválido. */
export function validarTexto(x: unknown): Validacao {
  if (typeof x !== 'string') return { ok: false }
  const t = x.replace(/[<>]/g, '').trim()
  if (t.length < 1 || t.length > 500) return { ok: false }
  return { ok: true, texto: t }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pergunta de saúde → resposta fixa (não orientamos). Exige contexto de saúde/pessoa (nada de "pode dar desconto?"). */
export function ehSaude(t: string): boolean {
  return /(beb[eê]s?(?!\p{L})|crian[cç]as?(?!\p{L})|filh[oa]s?\s+(?:pode|pequen)|gr[aá]vid|gestan|gesta[cç][aã]o|amament|diab[eé]t|alerg|intoler|lactente|cel[ií]aco|glúten|gluten|vegan|rem[eé]dio|idos[oa]s?\b|saud[aá]vel|sa[uú]de|faz\s+bem|faz\s+mal|engorda|emagre[cç]|calori|dieta|\bpress[aã]o|colesterol|doen[cç]a)/iu
    .test(t)
}

/** Pergunta de saúde que cita leite/lactose/intolerância → resposta fixa que traz o fato (açaí sem leite, cremes com leite). */
export function ehSaudeLeite(t: string): boolean {
  return /(lactose|leite|intoler)/i.test(t)
}

/** Assunto sem fato na base → sempre humano (conservantes, derretimento na entrega).
 *  Lactose e validade agora têm fato (2026-11-20); pedido mínimo também. */
export function ehPendente(t: string): boolean {
  return /(conservante|derret)/i.test(t)
}

/** Assuntos PENDENTES na base (sem fato): conservantes, derretimento na entrega. */
export const ASSUNTOS_PENDENTES = 'conservantes, se derrete na entrega'
/** Assuntos sensíveis: a resposta só pode tocar em validade/lactose se a PERGUNTA for sobre isso (evita vazar do histórico). */
const RE_RESP_PENDENTE = /(validade|vencim|lactose|sem\s+leite|estrag)/i
const RE_PERG_PENDENTE = /(freezer|congel|validade|vencim|vence\b|lactose|leite|estrag|conserv|armazen|guard|derret|dura)/i
/** Checagem determinística: a resposta fala de assunto pendente e a pergunta atual NÃO era sobre isso → vazou do histórico/inventou. */
export function respostaForaDoAssunto(resposta: string, pergunta: string): boolean {
  return RE_RESP_PENDENTE.test(String(resposta ?? '')) && !RE_PERG_PENDENTE.test(String(pergunta ?? ''))
}

/** Remove os marcadores de máscara (para o texto que vai ao Jev na abertura). */
export function semMarcadores(t: string): string {
  return String(t ?? '').replace(/\[(?:contato|nome)\]/g, '').replace(/\s+/g, ' ').trim()
}

/** IP → chave de limite: IPv4 inteiro; IPv6 só o prefixo /64 (4 primeiros grupos, expandido). */
export function normalizarIp(ip: string): string {
  let x = String(ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!x) return 'unknown'
  const m4 = x.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (m4) x = m4[1]
  if (!x.includes(':')) return x
  let g: string[]
  if (x.includes('::')) {
    const [h, tl] = x.split('::')
    const hs = h ? h.split(':') : []
    const ts = tl ? tl.split(':') : []
    g = [...hs, ...Array(Math.max(0, 8 - hs.length - ts.length)).fill('0'), ...ts]
  } else g = x.split(':')
  return 'v6:' + g.slice(0, 4).map((p) => (p || '0').replace(/^0+(?=.)/, '')).join(':')
}

/** Decisão da abertura. j1 = escolha e probabilidade do J1; j11 = noul "humano". */
export function decidirAbertura(j1: string | undefined, p1: number, j11: number): string {
  if (j1 === 'humano' && p1 >= 0.6) return 'humano'
  if (j11 >= 0.9) return 'humano'
  if (j1 && ['revender', 'consumir', 'provar', 'duvida'].includes(j1) && p1 >= 0.6) return j1
  if (j11 >= 0.8) return 'humano'
  return 'incerto'
}

/** Resposta do Haiku com link, e-mail ou número de telefone que não seja o WhatsApp dos fatos → suspeita. */
export function respostaSuspeita(r: string, waDigitos: string): boolean {
  if (/https?:\/\/|www\.|@/i.test(r)) return true
  const seqs = r.match(/\d[\d\s().-]*\d/g) || []
  for (const q of seqs) {
    const d = q.replace(/\D/g, '')
    if (d.length >= 8 && !(d === waDigitos || d === '55' + waDigitos || d === '78076001')) return true
  }
  return false
}

/** Dia de America/Cuiaba (YYYY-MM-DD) e o instante de início desse dia (UTC-4 fixo, sem horário de verão). */
export function diaCuiaba(agora: Date = new Date()): { dia: string; inicioISO: string } {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(agora)
  return { dia, inicioISO: `${dia}T00:00:00-04:00` }
}

/** Limpa a saída do Haiku: tira marcação e limita tamanho. */
export function limparResposta(s: string): string {
  return String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 400)
}

/* ── Etapa 4: visita do vendedor + histórico ─────────────────────────── */

/** Cidade sem acento/caixa/espaços extras. */
export function normalizarCidade(c: unknown): string {
  return String(c ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
export const CIDADES_VISITA: Record<string, string> = { 'cuiaba': 'Cuiabá', 'varzea grande': 'Várzea Grande' }
export const DIAS_VISITA = ['seg', 'ter', 'qua', 'qui', 'sex']
export const PERIODOS_VISITA = ['manha', 'tarde']

/** Telefone com ou sem máscara → só dígitos (10–11, tolera +55 na frente); senão null. */
export function normalizarTelefone(t: unknown): string | null {
  let d = String(t ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return null
  const ddd = Number(d.slice(0, 2))
  if (d[0] === '0' || ddd < 11 || ddd > 99) return null
  if (d.length === 11 && d[2] !== '9') return null
  if (/^(\d)\1+$/.test(d)) return null
  return d
}

const limpaTxt = (x: unknown): string => String(x ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()

export type Visita = { nome: string; telefone: string; cidade: string; bairro: string; dia: string; periodo: string }
/** Valida o pedido de visita (cidade é checada primeiro). */
export function validarVisita(b: any): { ok: true; v: Visita } | { ok: false; motivo: 'cidade_fora' | 'dados_invalidos' } {
  const chaveCidade = normalizarCidade(b?.cidade)
  const cidade = Object.hasOwn(CIDADES_VISITA, chaveCidade) ? CIDADES_VISITA[chaveCidade] : undefined
  if (!cidade) return { ok: false, motivo: 'cidade_fora' }
  const bairro = limpaTxt(b?.bairro)
  const nome = limpaTxt(b?.nome)
  const telefone = normalizarTelefone(b?.telefone)
  const dia = typeof b?.dia === 'string' ? b.dia : ''
  const periodo = typeof b?.periodo === 'string' ? b.periodo : ''
  if (bairro.length < 2 || bairro.length > 60 || nome.length < 2 || nome.length > 80 || !telefone ||
      !DIAS_VISITA.includes(dia) || !PERIODOS_VISITA.includes(periodo)) return { ok: false, motivo: 'dados_invalidos' }
  return { ok: true, v: { nome, telefone, cidade, bairro, dia, periodo } }
}

export type Turno = { r: 'u' | 'a'; t: string }
/** Normaliza o histórico lido do banco (descarta lixo) e acrescenta turnos; mantém os últimos n. */
export function empilharHistorico(h: unknown, novos: Turno[], n = 6): Turno[] {
  const base: Turno[] = Array.isArray(h)
    ? h.filter((x: any) => x && (x.r === 'u' || x.r === 'a') && typeof x.t === 'string').map((x: any) => ({ r: x.r, t: x.t.slice(0, 500) }))
    : []
  return [...base, ...novos].slice(-n)
}

/** Pares COMPLETOS (pergunta do usuário seguida da resposta da Puri), na ordem; turnos de usuário sem resposta e respostas órfãs são descartados. */
export function paresCompletos(h: Turno[]): { u: string; a: string }[] {
  const pares: { u: string; a: string }[] = []
  for (let i = 0; i < h.length - 1; i++) {
    if (h[i].r === 'u' && h[i + 1].r === 'a') { pares.push({ u: h[i].t, a: h[i + 1].t }); i++ }
  }
  return pares
}

/** Histórico + pergunta atual → messages do Haiku: no máximo os 2 últimos pares completos (user/assistant) e depois a pergunta ATUAL sozinha. Nunca funde mensagens. */
export function historicoParaMessages(h: Turno[], atual: string): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const p of paresCompletos(h).slice(-2)) {
    out.push({ role: 'user', content: `<pergunta>${p.u.replace(/[<>]/g, '')}</pergunta>` })
    out.push({ role: 'assistant', content: p.a.replace(/[<>]/g, '') })
  }
  out.push({ role: 'user', content: `<pergunta>${atual.replace(/[<>]/g, '')}</pergunta>` })
  return out
}

/** Contexto do J3: só o último par completo (se houver), no formato previous_turns. */
export function turnosParaJ3(h: Turno[]): string[] {
  const p = paresCompletos(h).slice(-1)[0]
  return p ? ['customer: ' + p.u, 'assistant: ' + p.a] : []
}

/* ── Etapa 4B-1: ação `revenda` ──────────────────────────────────────── */

export const SEGMENTOS = ['delivery_acai', 'acaiteria', 'lanchonete_bar', 'sorveteria', 'feira_evento', 'mercado_varejo', 'revenda_casa', 'outro']
export const MOVIMENTOS = ['ate20', '20a50', '50a100', '100mais']

/** Id de segmento válido (devolvido pelo Jev ou vindo do navegador); qualquer outra coisa → 'outro'. */
export function normalizarSegmento(x: unknown): string {
  const s = typeof x === 'string' ? x.trim() : ''
  return SEGMENTOS.includes(s) ? s : 'outro'
}

export type Perfil = { segmento: string; cidade: string; bairro: string | null; movimento: string; foraArea: boolean }
/** Valida o perfil (segmento só aceita id da lista; cidade 2–60; bairro opcional 2–60; movimento da lista). */
export function validarPerfil(b: any): { ok: true; v: Perfil } | { ok: false } {
  const segmento = typeof b?.segmento === 'string' ? b.segmento : ''
  const cidade = limpaTxt(b?.cidade)
  const bairroRaw = limpaTxt(b?.bairro)
  const movimento = typeof b?.movimento === 'string' ? b.movimento : ''
  if (!SEGMENTOS.includes(segmento) || !MOVIMENTOS.includes(movimento)) return { ok: false }
  if (cidade.length < 2 || cidade.length > 60) return { ok: false }
  if (bairroRaw && (bairroRaw.length < 2 || bairroRaw.length > 60)) return { ok: false }
  return { ok: true, v: { segmento, cidade, bairro: bairroRaw || null, movimento, foraArea: !Object.hasOwn(CIDADES_VISITA, normalizarCidade(cidade)) } }
}

export const COPOS_DIA: Record<string, number> = { ate20: 10, '20a50': 35, '50a100': 75, '100mais': 120 }

export type Simulacao = { preco_copo: number; custo_caixa: number; copos_caixa: number; venda_caixa: number; sobra_caixa: number; copos_dia: number; caixas_semana: number; sobra_semana: number }
/** Simulação de revenda (servidor): preço do copo 18–20 (arredonda), caixa de 10 L = 20 copos de 500 ml, 6 dias/semana. */
export function calcularSimulacao(precoCopo: unknown, custoCaixa: number, movimento: string): Simulacao | null {
  const n = Number(precoCopo)
  const copos_dia = COPOS_DIA[movimento]
  if (!Number.isFinite(n) || !copos_dia || !Number.isFinite(custoCaixa) || custoCaixa <= 0) return null
  const preco_copo = Math.round(n)
  if (preco_copo < 18 || preco_copo > 20) return null
  const copos_caixa = 20
  const venda_caixa = copos_caixa * preco_copo
  const sobra_caixa = Math.round((venda_caixa - custoCaixa) * 100) / 100
  const caixas_semana = Math.floor((copos_dia * 6) / copos_caixa)
  const sobra_semana = Math.round(sobra_caixa * caixas_semana * 100) / 100
  return { preco_copo, custo_caixa: custoCaixa, copos_caixa, venda_caixa, sobra_caixa, copos_dia, caixas_semana, sobra_semana }
}

/** Tópicos do Haiku (JSON estrito): 2–4 itens, ≤ 8 palavras, sem link/e-mail/telefone; lixo → null. */
export function parseTopicos(s: string): string[] | null {
  let j: any
  try { j = JSON.parse(String(s ?? '').replace(/^\s*```(?:json)?|```\s*$/g, '').trim()) } catch { return null }
  const arr = Array.isArray(j) ? j : j?.topicos
  if (!Array.isArray(arr)) return null
  const out = arr.filter((x: unknown) => typeof x === 'string')
    .map((x: string) => x.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' '))
    .filter((x: string) => x.length >= 3 && !respostaSuspeita(x, '') && !/https?:\/\/|www\.|@|\d{8}/i.test(x)).map((x: string) => mascarar(x)).slice(0, 4)
  return out.length >= 2 ? out : null
}

/* ── Etapa 4B-2: aprofundar / palpite / resumo (revenda) ─────────────── */

/** Texto de IA → uma linha, sem <>, sem marcadores de formatação nas pontas, mascarado, cortado em `max`. */
export function limparIA(x: unknown, max: number): string {
  return mascarar(String(x ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).trim().slice(0, max).trim()
}

/** Pega o JSON da saída do Haiku (tolera cerca ``` e texto antes/depois); lixo → null. */
export function extrairJson(s: string): any {
  const t = String(s ?? '').replace(/```(?:json)?/g, '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}

const suspeitoIA = (x: string) => respostaSuspeita(x, '') || /https?:\/\/|www\.|@|\d{6,}|\[contato\]/i.test(x)

export type PerguntaAprof = { pergunta: string; respostas: string[] }
/** H3 (JSON estrito {"perguntas":[{"pergunta","respostas":[...]}]}): até 3 candidatas válidas.
 *  pergunta 8–200 chars; 3–4 respostas de ≤ 6 palavras (≤ 60 chars); link/e-mail/telefone descarta a candidata. */
export function parsePerguntasAprof(s: string): PerguntaAprof[] | null {
  const j = extrairJson(s)
  const arr = Array.isArray(j) ? j : j?.perguntas
  if (!Array.isArray(arr)) return null
  const out: PerguntaAprof[] = []
  for (const it of arr) {
    if (typeof it?.pergunta !== 'string' || !Array.isArray(it?.respostas)) continue
    const pergunta = limparIA(it.pergunta, 200)
    if (pergunta.length < 8 || suspeitoIA(pergunta)) continue
    const respostas = it.respostas.filter((x: unknown) => typeof x === 'string')
      .map((x: string) => limparIA(x, 200).split(' ').slice(0, 6).join(' ').slice(0, 60).trim())
      .filter((x: string) => x.length >= 2 && !suspeitoIA(x)).slice(0, 4)
    if (respostas.length < 3) continue
    out.push({ pergunta, respostas })
    if (out.length === 3) break
  }
  return out.length ? out : null
}

/** H4: uma frase de palpite; 10–220 chars; sem link/e-mail/telefone; lixo → null. */
export function parsePalpite(s: string): string | null {
  const t = limparIA(String(s ?? '').replace(/^["“”']+|["“”']+$/g, ''), 220)
  if (t.length < 10 || suspeitoIA(t)) return null
  return t
}

/** H5 (JSON estrito {"resumo","problema"}): resumo 10–300, problema 3–40 (≤ 5 palavras); suspeito → null. */
export function parseResumo(s: string): { resumo: string; problema: string } | null {
  const j = extrairJson(s)
  if (typeof j?.resumo !== 'string' || typeof j?.problema !== 'string') return null
  const resumo = limparIA(j.resumo, 300)
  const problema = limparIA(j.problema, 200).split(' ').slice(0, 5).join(' ').slice(0, 40).trim()
  if (resumo.length < 10 || problema.length < 3 || suspeitoIA(resumo) || suspeitoIA(problema)) return null
  return { resumo, problema }
}

/** Resposta ao palpite: valor da lista; correção opcional (mascarada, ≤ 300). Inválido → null. */
export function validarPalpiteResp(valor: unknown, texto: unknown): { valor: string; correcao: string | null } | null {
  if (typeof valor !== 'string' || !['mosca', 'parte', 'nao'].includes(valor)) return null
  const c = typeof texto === 'string' ? mascarar(texto.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 300) : ''
  return { valor, correcao: c || null }
}
