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

/** Assunto cujo fato está marcado [CONFIRMAR]/[CONFERIR] na base → sempre humano.
 *  "Pedido mínimo" sem contexto de revenda (revend/atacado/litro/30 L/caixa) → humano (o mínimo do consumidor está pendente). */
export function ehPendente(t: string): boolean {
  if (/(lactose|sem\s+leite|validade|vencimento|vence\b|prazo\s+de\s+validade|pedido\s+m[ií]nimo\s+(?:do\s+)?(?:delivery|consumidor)|m[ií]nimo\s+(?:de\s+)?r\$\s*20)/i.test(t)) return true
  if (/m[ií]nimo/i.test(t) && !/(revend|revender|atacad|litros?\b|\b\d+\s*l\b|caixas?\b)/i.test(t)) return true
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
