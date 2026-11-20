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
  return /(beb[eê]s?(?!\p{L})|crian[cç]as?(?!\p{L})|filh[oa]s?\s+(?:pode|pequen)|gr[aá]vid|gestan|gesta[cç][aã]o|amament|diab[eé]t|alerg|intoler|lactose|lactente|cel[ií]aco|glúten|gluten|vegan|rem[eé]dio|idos[oa]s?\b|saud[aá]vel|sa[uú]de|faz\s+bem|faz\s+mal|engorda|emagre[cç]|calori|dieta|press[aã]o|colesterol|doen[cç]a)/iu
    .test(t)
}

/** Assunto cujo fato está marcado [CONFIRMAR]/[CONFERIR] na base → sempre humano (lactose, validade).
 *  Pedido mínimo NÃO é mais pendente: delivery R$ 20 e revenda 30 L estão nos fatos; sem contexto o Haiku responde os dois. */
export function ehPendente(t: string): boolean {
  if (/(lactose|sem\s+leite|validade|vencimento|vence\b|prazo\s+de\s+validade)/i.test(t)) return true
  return false
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
  return String(c ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
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
  const cidade = CIDADES_VISITA[normalizarCidade(b?.cidade)]
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

/** Histórico + pergunta atual → messages do Haiku: começa em 'user', alterna papéis (funde consecutivos iguais), termina na pergunta atual. */
export function historicoParaMessages(h: Turno[], atual: string): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const x of [...h, { r: 'u' as const, t: atual }]) {
    const role = x.r === 'u' ? 'user' : 'assistant'
    const content = x.r === 'u' ? `<pergunta>${x.t.replace(/[<>]/g, '')}</pergunta>` : x.t.replace(/[<>]/g, '')
    if (!out.length && role === 'assistant') continue
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content
    else out.push({ role, content })
  }
  return out
}
