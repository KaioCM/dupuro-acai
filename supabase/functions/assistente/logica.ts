// Dupuro Açaí — assistente Puri: funções PURAS (sem rede, sem Deno.*), testáveis em Node/Deno.
import { WAS_LIVRES, INTENCAO_DA_CATEGORIA, ACOES_AMBIGUO, CHIPS_FORA } from './prompts.ts'

/** Troca telefone, e-mail, CPF/CNPJ e nome por marcadores antes de qualquer chamada/gravação. */
export function mascarar(entrada: string): string {
  let t = String(entrada ?? '')
  // e-mail
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[contato]')
  // CNPJ e CPF (com ou sem pontuação)
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[contato]')
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[contato]')
  // CEP (antes do telefone, que também pegaria 8 dígitos com hífen)
  t = t.replace(/\b\d{5}-?\d{3}\b/g, '[cep]')
  // endereço de rua: palavra de logradouro + nome (até 3 palavras) + número opcional ("nº 16", ", 16"). Cidade e bairro soltos NÃO são mascarados.
  // Exemplos: "moro na Rua das Flores, 120" -> "moro na [endereço]"; "Av. das Torres nº 16" -> "[endereço]";
  // "rua 13 de junho 45" -> "[endereço]"; "Quadra 12 casa 3" -> "[endereço] casa 3"; "sou de Várzea Grande" e "moro no Jardim Imperial" ficam iguais.
  const stopEnd = String.raw`(?!(?:e|que|mas|com|para|pra|onde|perto|fica|é|la|lá|aqui|na|no|em|tem|vocês|voces|quero|queria|gostaria|preciso|moro|entrega|entregam)(?![\p{L}\d]))`
  const palEnd = String.raw`${stopEnd}(?:(?:da|de|do|das|dos)\s+)?[\p{L}\d'’-]+`
  t = t.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(?:rua|r\.|avenida|av\.|av|travessa|tv\.|alameda|rodovia|estrada|quadra|qd\.?)\s+${palEnd}(?:\s+${palEnd}){0,2}(?:\s*,?\s*(?:n[º°o]\.?\s*)?\d{1,5}\b)?`, 'giu'),
    '[endereço]',
  )
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
  return /(beb[eê]s?(?!\p{L})|crian[cç]as?(?!\p{L})|filh[oa]s?\s+(?:pode|pequen)|gr[aá]vid|gestan|gesta[cç][aã]o|amament|diab[eé]t|alerg|intoler|lactente|cel[ií]aco|vegan|rem[eé]dio|idos[oa]s?\b|saud[aá]vel|sa[uú]de|faz\s+bem|faz\s+mal|engorda|emagre[cç]|calori|dieta|\bpress[aã]o|colesterol|doen[cç]a)/iu
    .test(t)
}

/** Pergunta de saúde que cita glúten (ex.: celíaco) → resposta fixa que traz o fato (açaí sem glúten, cremes com glúten). */
export function ehSaudeGluten(t: string): boolean {
  return /gl[uú]ten/i.test(t)
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
export const ASSUNTOS_PENDENTES = 'conservantes, se derrete na entrega, nota fiscal'
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

/** Limiares de decisão do Jev (bloco único; valores de produção inalterados). Os limites de volume (LIMITE_*) ficam no topo de index.ts. */
export const LIMIARES = {
  ABERTURA_P_MIN: 0.6, // J1: probabilidade mínima da intenção
  HUMANO_ALTO: 0.9, // J11: pede humano sem dúvida
  HUMANO_MEDIO: 0.8, // J11: pede humano (só se nenhuma intenção firmou)
  // Motor da dúvida (Etapa 1) — a calibrar na bateria
  CATEGORIA_P_MIN: 0.5, // Jev antes: abaixo disso a categoria vira pergunta_dupuro (o caso mais comum)
  ENCAMINHA_P_MIN: 0.65, // Jev antes: reclamação, negociação e pede_pessoa só encaminham a partir daqui
  FORA_P_MIN: 0.6, // Jev antes: fora_do_assunto
  IRRITADO_NOTA_MIN: 0.6, // Jev antes: entra a nota de empatia
  IRRITADO_FORTE_MIN: 0.85, // Jev antes: irritado forte vira encaminhamento (tipo humano)
  RESPONDIVEL_MIN: 0.6, // Jev antes: os fatos cobrem a pergunta
  AMBIGUO_MIN: 0.6, // Jev antes: revenda ou consumo não está claro
  INVENTOU_MAX: 0.5, // Jev depois: inventou fato da Dupuro
  RESPONDEU_MIN: 0.5, // Jev depois: respondeu o que foi perguntado
  SEGUIU_NOTAS_MIN: 0.5, // Jev depois: seguiu as notas
  FRASES_MAX: 3, // checagem por código
  RESPOSTA_MAX_CHARS: 400, // checagem por código: acima disso reprova como 'longo' (nunca corta no meio)
  REESCRITAS_MAX: 2, // depois disso, resposta segura
  SEGMENTO_P_MIN: 0.5, // J5 segmento
  TIPO_OBJETIVO_MIN: 0.8, // coerência: Jev acha que o objetivo descreve outro tipo de negócio (incoerente só a partir daqui)
  SUFICIENTE_MIN: 0.7, // escuta: texto com informação suficiente
  PALPITE_INVENTA_MAX: 0.5, // J7 palpite inventa
  MAPA_J8_MAX: 0.62, // J8 rótulo ruim
  MAPA_TIPO_MIN: 0.5, // mapa: o Jev inclui o tipo de nó (causa, risco, destino, passo) a partir daqui
  MAPA_REESCRITAS_MAX: 2, // mapa: reescritas após reprovação do J8 (depois, mapa simples por código)
  MAPA_PRAZO_MS: 15000, // mapa: teto de tempo da requisição
  OBJETIVO_VALE_MIN: 0.5, // resumo: abaixo disso o objetivo mudou ao longo da conversa
  RESUMO_INVENTA_MAX: 0.5, // resumo: Jev inventou
  RESUMO_REESCRITAS_MAX: 2, // resumo: reescritas após reprovação
  RESUMO_PRAZO_MS: 15000, // resumo: teto de tempo da requisição
  // Etapa 2 (reforma da Puri)
  ABERTURA_REVENDER_MIN: 0.75, // abertura: abaixo disso (com consumir relevante) pergunta "revender ou comprar pra você?"
  ABERTURA_CONSUMIR_RELEVANTE: 0.2, // abertura: probabilidade de consumir que torna o caso ambíguo
  EMPRESA_AMBIGUA_MIN: 0.6, // abertura: fala de empresa/trabalho sem dizer o que quer
  SEGMENTO_CONFIANCA_FRONT: 0.7, // contrato: o front aceita o segmento a partir daqui (o servidor só devolve a confiança)
  INTERPRETAR_P_MIN: 0.5, // interpretar: abaixo disso a escolha vira null
  E_ACAI_MIN: 0.35, // grande leitura: abaixo disso o objetivo não é sobre vender açaí (nao_acai)
  CENARIO_MIN: 0.55, // grande leitura: cenário suficiente para os 3 cartões (era 0,7; a cena não aparecia num objetivo bem descrito)
  CARTOES_REESCRITAS_MAX: 2, // cartões: reescritas após reprovação
  ESCLARECER_REESCRITAS_MAX: 1, // pergunta de esclarecimento: reescritas
  ESCUTAR_FINAL_PRAZO_MS: 15000, // escutar final: teto de tempo (tópicos + leitura + cartões)
  CARTOES_INVENTOU_MAX: 0.5, // cartões: Jev acha que inventou
  PERGUNTA_ESCLARECER_MIN: 0.5, // pergunta de esclarecimento: adequada
  PRECISA_APROFUNDAR_MIN: 0.55, // aprofundar: abaixo disso o Jev acha que não vale perguntar (sem gastar Haiku)
  PALPITE_REESCRITAS_MAX: 2, // palpite: reescritas com motivo após reprovação do J7
  PALPITE_PRAZO_MS: 15000, // palpite: teto de tempo da requisição
  APROFUNDAR_PRAZO_MS: 15000, // aprofundar: teto de tempo da requisição
  ALT_PRAZO_MS: 15000, // palpite_resp (alternativas): teto de tempo da requisição
  PALPITE_ALT_MAX: 3, // palpite_resp: alternativas devolvidas
  PALPITE_ALT_INVENTA_MAX: 0.5, // palpite_resp: J7 reprova a alternativa a partir daqui
  INICIANTE_MIN: 0.6, // leitura: pessoa ainda vai abrir/começar (ordem das opções de compra)
  // Etapa 3 (destinos)
  CONSUMIDOR_MIN: 0.8, // destino: compra para consumo próprio, não para revender (vai para delivery)
  PONTO_DEFINIDO_MIN: 0.8, // destino: monta loja/ponto de açaí com local definido (contato rápido, com começo esta semana/este mês)
  PROVAR_MIN: 0.6, // destino: ganha em provar antes (visita), só em Cuiabá/Várzea Grande
  ESFORCO_MIN_MS: 180000, // esforço: 3 minutos de conversa
  ESFORCO_DETALHE_CHARS: 60, // esforço: objetivo/escuta detalhado
} as const

/** Regra fixa (sem IA): quem vai começar/abrir (ja_vende 'quero_comecar', papel 'vou_abrir' ou leitura.iniciante >= INICIANTE_MIN) não declara mais de 100 copos por dia ('100mais'). O papel só entra se já foi respondido (qualquer outro valor, inclusive vazio, não conta). 'outras_coisas' NÃO é iniciante. */
export function regraInicioMovimento(jaVende: unknown, papel: unknown, iniciante: number | null, movimento: string): boolean {
  const ini = jaVende === 'quero_comecar' || papel === 'vou_abrir' || (typeof iniciante === 'number' && iniciante >= LIMIARES.INICIANTE_MIN)
  return ini && movimento === '100mais'
}

/** Abertura ambígua (revender x consumir): empresa/trabalho sem intenção, ou revender < 0,75 com consumir relevante. Humano e provar nunca caem aqui. */
export function aberturaAmbigua(decidida: string, pRevender: number, pConsumir: number, empresa: number): boolean {
  if (decidida === 'humano' || decidida === 'provar') return false
  if (empresa >= LIMIARES.EMPRESA_AMBIGUA_MIN) return true
  return pRevender < LIMIARES.ABERTURA_REVENDER_MIN && pConsumir >= LIMIARES.ABERTURA_CONSUMIR_RELEVANTE
}

/** Abertura só social: a mensagem INTEIRA é cumprimento ou agradecimento (sem acento, minúsculas, pontuação/emoji ignorados, letras repetidas viram uma). "ok"/"puri"/"dupuro" só acompanham. Qualquer outra palavra → null. */
export function socialAbertura(texto: string): 'cumprimento' | 'agradecimento' | null {
  let t = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  t = t.replace(/[^a-z0-9]+/g, ' ').replace(/([a-z])\1+/g, '$1').trim()
  if (!t) return null
  // (letras repetidas já viraram uma: "pessoal" vira "pesoal")
  const CUMP = /^(?:(?:bom dia|boa tarde|boa noite) (?:pesoal|gente|galera)|fala(?: ai| puri)?|oi|oie|ola|opa|eae|eai|e ai|hey|hi|helo|salve|bom dia|boa tarde|boa noite|tudo bem|tudo bom|tudo certo|td bem|td bom|beleza)(?= |$)/
  const AGR = /^(?:muito obrigado|muito obrigada|obrigado|obrigada|obg|brigado|brigada|valeu|vlw|tmj)(?= |$)/
  const NEUTRO = /^(?:ok|puri|dupuro)(?= |$)/
  let cump = false, agr = false
  while (t) {
    let m: RegExpExecArray | null
    if ((m = CUMP.exec(t))) cump = true
    else if ((m = AGR.exec(t))) agr = true
    else if (!(m = NEUTRO.exec(t))) return null
    t = t.slice(m[0].length).trim()
  }
  return cump ? 'cumprimento' : agr ? 'agradecimento' : null
}

/** Decisão da abertura. j1 = escolha e probabilidade do J1; j11 = noul "humano". */
export function decidirAbertura(j1: string | undefined, p1: number, j11: number): string {
  if (j1 === 'humano' && p1 >= LIMIARES.ABERTURA_P_MIN) return 'humano'
  if (j11 >= LIMIARES.HUMANO_ALTO) return 'humano'
  if (j1 && ['revender', 'consumir', 'provar', 'duvida'].includes(j1) && p1 >= LIMIARES.ABERTURA_P_MIN) return j1
  if (j11 >= LIMIARES.HUMANO_MEDIO) return 'humano'
  return 'incerto'
}

/** Resposta do Haiku com link, e-mail ou número de telefone que não seja o WhatsApp dos fatos → suspeita. */
export function respostaSuspeita(r: string, waDigitos: string | string[]): boolean {
  const was = Array.isArray(waDigitos) ? waDigitos : [waDigitos]
  const semInsta = r.replace(/(?<![\w.])@dupuroacai(?![\w.])/gi, '')
  if (/https?:\/\/|www\.|@/i.test(semInsta)) return true
  const seqs = r.match(/\d[\d\s().-]*\d/g) || []
  for (const q of seqs) {
    const d = q.replace(/\D/g, '')
    if (d.length >= 8 && !(was.some((w) => d === w || d === '55' + w) || d === '78076001')) return true
  }
  return false
}

/** Dia de America/Cuiaba (YYYY-MM-DD) e o instante de início desse dia (UTC-4 fixo, sem horário de verão). */
export function diaCuiaba(agora: Date = new Date()): { dia: string; inicioISO: string } {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(agora)
  return { dia, inicioISO: `${dia}T00:00:00-04:00` }
}

/** Limpa a saída do Haiku: tira marcação e achata espaços. NÃO corta: o tamanho (>400) é reprovado por checarResposta ('longo') ANTES, sobre o texto bruto. */
export function limparResposta(s: string): string {
  return String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

/* ── Etapa 4: visita do vendedor + histórico ─────────────────────────── */

/** Cidade sem acento/caixa/espaços extras. */
export function normalizarCidade(c: unknown): string {
  return String(c ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
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

export type Visita = { nome: string; telefone: string; cidade: string; bairro: string | null; dia: string; periodo: string }
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
  if ((bairro && (bairro.length < 2 || bairro.length > 60)) || nome.length < 2 || nome.length > 80 || !telefone ||
      !DIAS_VISITA.includes(dia) || !PERIODOS_VISITA.includes(periodo)) return { ok: false, motivo: 'dados_invalidos' }
  return { ok: true, v: { nome, telefone, cidade, bairro: bairro || null, dia, periodo } }
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

export type Perfil = { segmento: string; cidade: string; bairro: string | null; movimento: string; foraArea: boolean; retira: boolean }
/** Valida o perfil (segmento só aceita id da lista; cidade 2–60; bairro opcional 2–60; movimento da lista). */
export function validarPerfil(b: any): { ok: true; v: Perfil } | { ok: false } {
  const segmento = typeof b?.segmento === 'string' ? b.segmento : ''
  const cidade = limpaTxt(b?.cidade)
  const bairroRaw = limpaTxt(b?.bairro)
  const movimento = typeof b?.movimento === 'string' ? b.movimento : ''
  if (!SEGMENTOS.includes(segmento) || !MOVIMENTOS.includes(movimento)) return { ok: false }
  if (cidade.length < 2 || cidade.length > 60) return { ok: false }
  if (bairroRaw && (bairroRaw.length < 2 || bairroRaw.length > 60)) return { ok: false }
  return { ok: true, v: { segmento, cidade, bairro: bairroRaw || null, movimento, foraArea: !Object.hasOwn(CIDADES_VISITA, normalizarCidade(cidade)), retira: b?.retira === true } }
}

export const COPOS_DIA: Record<string, number> = { ate20: 10, '20a50': 35, '50a100': 75, '100mais': 120 }

export const PRECO_COPO_MIN = 17
export const PRECO_COPO_MAX = 22
export type Simulacao = { preco_copo: number; custo_caixa: number; copos_caixa: number; venda_caixa: number; sobra_caixa: number; copos_dia: number; caixas_semana: number; sobra_semana: number }
/** Simulação de revenda (servidor): preço do copo 17–22 (arredonda), caixa de 10 L = 20 copos de 500 ml, 6 dias/semana. */
export function calcularSimulacao(precoCopo: unknown, custoCaixa: number, movimento: string): Simulacao | null {
  const n = Number(precoCopo)
  const copos_dia = COPOS_DIA[movimento]
  if (!Number.isFinite(n) || !copos_dia || !Number.isFinite(custoCaixa) || custoCaixa <= 0) return null
  const preco_copo = Math.round(n)
  if (preco_copo < PRECO_COPO_MIN || preco_copo > PRECO_COPO_MAX) return null
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
    if (pergunta.length < 8 || suspeitoIA(pergunta) || perguntaProibida(pergunta)) continue
    const respostas = it.respostas.filter((x: unknown) => typeof x === 'string')
      .map((x: string) => limparIA(x, 200).split(' ').slice(0, 6).join(' ').slice(0, 60).trim())
      .filter((x: string) => x.length >= 2 && !suspeitoIA(x) && !perguntaProibida(x)).slice(0, 4)
    if (respostas.length < 3) continue
    out.push({ pergunta, respostas })
    if (out.length === 3) break
  }
  return out.length ? out : null
}

/** Pergunta/resposta do aprofundar que o código nunca deixa passar: preço, dados pessoais ou promessa. */
export function perguntaProibida(x: string): boolean {
  const t = String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /r\$|\b(preco|precos|valor|valores|custa|custo|quanto (e|sai|fica|cobra)|desconto|barato|caro|promocao|frete|pagamento|pix|cartao)\b/.test(t) ||
    /\b(telefone|celular|whatsapp|zap|e-?mail|cpf|cnpj|rg|endereco|cep|senha|sobrenome|nome completo|qual (e )?(o )?seu nome|como (voce )?se chama)\b/.test(t) ||
    /\b(garanto|garantimos|garantia|prometo|prometemos|promessa|com certeza vai|sem risco|lucro garantido)\b/.test(t)
}

/** H4 (alternativas): JSON {"alternativas":[...]} ou lista; cada frase passa pelo parse do palpite; sem repetidas; até 3. */
export function parseAlternativasPalpite(s: string): string[] | null {
  const j = extrairJson(s)
  const arr = Array.isArray(j) ? j : j?.alternativas
  if (!Array.isArray(arr)) return null
  const out: string[] = []
  for (const it of arr) {
    const f = typeof it === 'string' ? parsePalpite(it) : null
    if (f && !out.includes(f)) out.push(f)
    if (out.length === LIMIARES.PALPITE_ALT_MAX) break
  }
  return out.length ? out : null
}

/** Descarta as alternativas que o Jev acha que inventam (ou que ele não conferiu) e ordena da menos para a mais inventiva. */
export function ordenarAlternativas(itens: { frase: string; inventa: number | null }[]): string[] {
  return itens.filter((i) => i.inventa !== null && i.inventa < LIMIARES.PALPITE_ALT_INVENTA_MAX)
    .sort((a, b) => (a.inventa as number) - (b.inventa as number)).map((i) => i.frase).slice(0, LIMIARES.PALPITE_ALT_MAX)
}

/** H4: uma frase de palpite; 10–220 chars; sem link/e-mail/telefone; lixo → null. */
export function parsePalpite(s: string): string | null {
  const t = limparIA(String(s ?? '').replace(/^["“”']+|["“”']+$/g, ''), 220)
  if (t.length < 10 || suspeitoIA(t)) return null
  return t
}

/** Termo do problema ("A gente chama isso de …"): ≤ 5 palavras e ≤ 40 caracteres, sem pontuação final, sem link/telefone. Inválido → null (sem termo). */
export function validarTermo(x: unknown): string | null {
  if (typeof x !== 'string') return null
  const t = limparIA(x.replace(/^["“”'‘’\s]+|["“”'‘’.!?,;:\s]+$/g, ''), 200)
  if (t.length < 3 || t.length > 40 || t.split(' ').length > 5 || suspeitoIA(t)) return null
  return t
}

const PALAVRAS_SOLTAS = new Set(['o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'e', 'ou', 'sobre', 'para', 'pra', 'com', 'que', 'um', 'uma'])
/** Pílula do resumo: corta no último espaço antes de `max` (nunca no meio da palavra) e tira do fim palavras soltas (o, de, sobre…). Espelho em assets/js/puri.js (cortarPilula). */
export function cortarProblema(t: string, max = 40): string {
  let s = String(t ?? '').replace(/\s+/g, ' ').trim()
  const cortou = s.length > max // mínimo de 8 só vale quando houve corte (palavra curta tipo "Medo" passa)
  if (cortou) {
    const corte = s.slice(0, max + 1).lastIndexOf(' ')
    s = corte > 0 ? s.slice(0, corte) : s.slice(0, max)
  }
  const p = s.split(' ')
  while (p.length > 1 && PALAVRAS_SOLTAS.has(p[p.length - 1].toLowerCase())) p.pop()
  s = p.join(' ').trim()
  return s.length < (cortou ? 8 : 3) ? '' : s
}

/** H5 (JSON estrito {"resumo","problema","termo"}): resumo 10–300, problema 3–40 (≤ 5 palavras); termo validado por código (inválido → null); suspeito → null.
 *  `estrito` (padrão): problema > 40 caracteres = falha de formato (null → reescrita com motivo). Não estrito (última tentativa): corta com cortarProblema; sobrou < 8 → problema '' (sem pílula). */
export function parseResumo(s: string, estrito = true): { resumo: string; problema: string; termo: string | null } | null {
  const j = extrairJson(s)
  if (typeof j?.resumo !== 'string' || typeof j?.problema !== 'string') return null
  const resumo = limparIA(j.resumo, 300)
  const bruto = limparIA(j.problema, 200).split(' ').slice(0, 5).join(' ').trim()
  if (estrito && bruto.length > 40) return null
  let problema = cortarProblema(bruto, 40)
  if (!estrito && problema.length < 3) problema = ''
  if (resumo.length < 10 || (estrito && problema.length < 3) || suspeitoIA(resumo) || suspeitoIA(bruto)) return null
  return { resumo, problema, termo: validarTermo(j.termo) }
}

export const TIPOS_MAPA = ['negocio', 'problema', 'causa', 'risco', 'destino', 'passo']
export type MapaIA = { problema: string; causa: string | null; risco: string | null; destino: string | null; passo: boolean; setas: (string | null)[]; setasPar: Record<string, string | null> }
/** H6/H7 (JSON estrito {"problema","causa","risco"|null,"destino","setas":[...]}): textos ≤ 70 (acima disso corta no último espaço antes de 69 + «…»; ≥ 4),
 *  setas ≤ 22 (inválida/longa vira null; sempre devolve 4); link/e-mail/telefone → null (risco/seta viram null, os obrigatórios rejeitam tudo).
 *  `tipos` (escolhidos pelo Jev): problema sempre; causa/destino só se escolhidos (e então obrigatórios); risco só se escolhido (opcional); passo = flag. Sem `tipos` = todos. */
export function parseMapa(s: string, tipos: string[] = TIPOS_MAPA): MapaIA | null {
  const j = extrairJson(s)
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null
  const corta = (x: string, max: number): string | null => {
    if (x.length <= max) return x
    const c = x.slice(0, max - 1), i = c.lastIndexOf(' ')
    return i > 0 ? c.slice(0, i).trim() + '…' : null
  }
  const t = (x: unknown) => { if (typeof x !== 'string') return ''; const l = limparIA(x, 200); return corta(l, 70) ?? l.slice(0, 69) + '…' }
  const tem = (k: string) => tipos.includes(k)
  const problema = t(j.problema)
  const causa = tem('causa') ? t(j.causa) : null, destino = tem('destino') ? t(j.destino) : null
  if ([problema, causa, destino].some((x) => x !== null && (x.length < 4 || suspeitoIA(x)))) return null
  const r = tem('risco') ? t(j.risco) : ''
  const risco = r.length >= 4 && !suspeitoIA(r) ? r : null
  const setas: (string | null)[] = []
  for (let i = 0; i < 4; i++) {
    const x = Array.isArray(j.setas) && typeof j.setas[i] === 'string' ? limparIA(j.setas[i], 200) : ''
    const xs = corta(x, 22)
    setas.push(xs && xs.length >= 2 && !suspeitoIA(xs) ? xs : null)
  }
  // o Haiku devolve as setas na ordem dos nós ESCOLHIDOS (negocio, problema, causa, risco, destino); guardamos por par de tipos (de>para)
  const seq = ['negocio', 'problema', ...['causa', 'risco', 'destino'].filter(tem)]
  const setasPar: Record<string, string | null> = {}
  for (let i = 0; i + 1 < seq.length; i++) setasPar[seq[i] + '>' + seq[i + 1]] = setas[i] ?? null
  return { problema, causa, risco, destino, passo: tem('passo'), setas, setasPar }
}

/** Seta entre os nós de fato presentes (tipos na ordem do mapa, sem `passo`): pelo par de tipos; par que não existiu na pergunta ao Haiku → null. */
export function setasDosNos(tipos: string[], setasPar: Record<string, string | null>): (string | null)[] {
  const out: (string | null)[] = []
  for (let i = 1; i < tipos.length; i++) out.push(setasPar[tipos[i - 1] + '>' + tipos[i]] ?? null)
  return out
}

/** Insere linhas antes do fechamento </contexto> (último); sem fechamento, só acrescenta ao fim. */
export function inserirNoContexto(ctx: string, extra: string): string {
  const i = ctx.lastIndexOf('</contexto>')
  if (i < 0) return ctx.replace(/\s+$/, '') + extra
  return ctx.slice(0, i).replace(/\s+$/, '') + extra + '\n' + ctx.slice(i)
}

/** Patch de anotações a mesclar no banco (RPC puri_merge_lead): só chaves definidas. */
export function montarPatch(chaves: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const k of Object.keys(chaves)) if (chaves[k] !== undefined) o[k] = chaves[k]
  return o
}

/** Resposta ao palpite: valor da lista; correção opcional (mascarada, ≤ 300). Inválido → null. */
export function validarPalpiteResp(valor: unknown, texto: unknown): { valor: string; correcao: string | null } | null {
  if (typeof valor !== 'string' || !['mosca', 'parte', 'nao'].includes(valor)) return null
  const c = typeof texto === 'string' ? mascarar(texto.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 300) : ''
  return { valor, correcao: c || null }
}

/* ── Motor da dúvida (Etapa 1) ───────────────────────────────────────── */

export type LeituraJev = { cat: string; p: number; irritado: number; respondivel: number; ambiguo: number }
export type Caminho = {
  cat: string // categoria efetiva
  fixo?: 'instagram' | 'pede_pessoa' // resposta sem IA
  tipo: 'resposta' | 'humano'
  notas: string[] // códigos das notas (texto em prompts.ts NOTAS)
  fora?: boolean
  humano?: boolean
  chips?: string[]
  acoes?: ('revender' | 'consumir' | 'provar')[] // o front trata como caminho (ação), não como pergunta
  intencao?: string
  segura: string // chave de SEGURA
}

/** Transforma a leitura do Jev em caminho + códigos de nota. Só código: sem texto do cliente. */
export function decidirCaminho(l: LeituraJev): Caminho {
  let cat = l.p >= LIMIARES.CATEGORIA_P_MIN ? l.cat : 'pergunta_dupuro'
  if (['reclamacao_ou_problema_pedido', 'negociacao', 'pede_pessoa'].includes(cat) && l.p < LIMIARES.ENCAMINHA_P_MIN) cat = 'pergunta_dupuro'
  if (cat === 'fora_do_assunto' && l.p < LIMIARES.FORA_P_MIN) cat = 'pergunta_dupuro'
  const c: Caminho = { cat, tipo: 'resposta', notas: [], segura: cat in INTENCAO_DA_CATEGORIA ? 'quer' : cat }
  if (cat === 'instagram') return { ...c, fixo: 'instagram' }
  if (cat === 'pede_pessoa') return { ...c, fixo: 'pede_pessoa', tipo: 'humano' }
  if (cat === 'reclamacao_ou_problema_pedido') { c.tipo = 'humano'; c.notas.push('reclamacao') }
  else if (cat === 'negociacao') { c.tipo = 'humano'; c.notas.push('negociacao') }
  else if (cat === 'fora_do_assunto') { c.fora = true; c.notas.push('fora'); c.chips = [...CHIPS_FORA] }
  else if (cat === 'conversa_social') c.notas.push('social')
  else if (cat in INTENCAO_DA_CATEGORIA) { c.intencao = INTENCAO_DA_CATEGORIA[cat]; c.notas.push(cat) }
  else if (l.ambiguo >= LIMIARES.AMBIGUO_MIN) { c.notas.push('ambiguo'); c.acoes = [...ACOES_AMBIGUO]; c.segura = 'ambiguo' }
  else if (l.respondivel < LIMIARES.RESPONDIVEL_MIN) c.notas.push('nao_cobre') // só nota: humano é decidido no fim, pelo texto final
  if (l.irritado >= LIMIARES.IRRITADO_NOTA_MIN) {
    c.notas.push('irritado')
    if (l.irritado >= LIMIARES.IRRITADO_FORTE_MIN && !c.fora && cat !== 'conversa_social') c.tipo = 'humano'
  }
  return c
}

const EMOJI_RE = /\p{Extended_Pictographic}/u
// markdown = linha começando com #, *, - ou • (lista/título), **negrito**, crase ou link; "#1"/"nº 1" no meio do texto não contam
const MD_RE = /^\s*(?:#{1,6}\s|[*•-]\s?)|\*\*[^*\n]+\*\*|`|\[[^\]]+\]\([^)]+\)/m
const CUPOM_RE = /\bcupo(?:m|ns)\b|\bcup[õo]es\b|\b(?:frete|entrega)\s+gr[aá]tis\b|\bdesconto\s+na\s+entrega\b/i
const CUPOM_AFIRMA_RE = /\b(?:temos|tem|damos|d[aá]|oferecemos|ganha|aplicamos|use|usa)\b.{0,30}(?:\bcupo(?:m|ns)\b|\b(?:frete|entrega)\s+gr[aá]tis\b|desconto\s+na\s+entrega)/i
const VAGAS_RE = /\bvagas?\b|\bpor\s+turno\b|\blimite\s+de\s+\w+\s+por\b/i
const VAGAS_AFIRMA_RE = /\b(?:temos|tem|h[aá]|restam?|sobram?|sobrou|limite\s+de)\b.{0,30}(?:\bvagas?\b|\blimite\b)/i
const NOTA_FISCAL_RE = /\b(?:emitimos|emitiremos|enviamos|fornecemos|damos)\b.{0,25}\bnota\b|\b(?:vai|sai|vem|saem|v[aã]o)\s+com\s+nota\b|\bcom\s+nota\s+fiscal\b/i
// Assuntos que o dono proibiu: detectados na PERGUNTA (mascarada); viram nota específica para o Haiku
const Q_CUPOM_FRETE_RE = /\bcupo(?:m|ns)\b|\bcup[õo]es\b|\b(?:frete|entrega)\s+gr[aá]tis\b|\bdesconto\s+(?:na|no)\s+(?:entrega|frete)\b/i
const Q_VAGAS_RE = /\bvagas?\b|\blota[cç][aã]o\b|\blotad[oa]\b|\blimite\b.{0,30}\b(?:pedidos?|entregas?)\b.{0,20}\bturnos?\b|\blimite\b.{0,20}\bno\s+turno\b|\bquant(?:os|as)\s+(?:pedidos|entregas)\b.{0,30}\b(?:por|no|em)\s+(?:cada\s+)?turno\b/i
const Q_EMPREGO_RE = /\bempregos?\b|\bvagas?\s+de\s+emprego\b|\btrabalhar\s+(?:a[ií](?=[\s?.!,]|$)|com\s+voc[eê]s\b)|\bcurr[ií]culo\b/i
const Q_NOTA_FISCAL_RE = /\bnota\s+fiscal\b|\bnfc-?e\b|\bnf-?e\b/i
/** Notas extras por assunto da pergunta. semPessoa: não oferecer atendente; emprego: tratar como fora do assunto. */
export function notasDaPergunta(p: string): { notas: string[]; semPessoa: boolean; emprego: boolean } {
  const q = String(p ?? '')
  if (Q_EMPREGO_RE.test(q)) return { notas: [], semPessoa: true, emprego: true }
  const notas: string[] = []
  let semPessoa = false
  if (Q_CUPOM_FRETE_RE.test(q)) { notas.push('cupom_frete'); semPessoa = true }
  if (Q_VAGAS_RE.test(q)) { notas.push('vagas_turno'); semPessoa = true }
  if (Q_NOTA_FISCAL_RE.test(q)) notas.push('nota_fiscal')
  return { notas, semPessoa, emprego: false }
}
/** O texto final admite que não tem/não sabe a informação → humano:true (decidido por código). */
const SEM_INFO_RE = /n[ãa]o\s+tenho\s+(?:essa|esta|a)\s+informa|n[ãa]o\s+sei\s+(?:te\s+)?(?:dizer|informar|responder|confirmar)\b|n[ãa]o\s+sei\s*[.!]|n[ãa]o\s+sei\s*$|n[ãa]o\s+consigo\s+confirmar|n[ãa]o\s+tenho\s+como\s+confirmar|n[ãa]o\s+tenho\s+confirma|uma\s+pessoa\s+(?:da\s+equipe|de\s+verdade)|a\s+equipe\s+te\s+ajuda|(?:falar|fale)\s+com\s+(?:uma\s+)?(?:pessoa|atendente)|n[ãa]o\s+tenho\s+isso\s+(?:por\s+)?aqui\b|isso\s+eu\s+n[ãa]o\s+tenho\b|eu\s+n[ãa]o\s+tenho\s+aqui\b|uma\s+pessoa\s+d[ae]\s+(?:nossa\s+)?equipe\s+(?:consegue|pode|vai|te)|(?:nossa\s+equipe|o\s+time|uma\s+pessoa\s+d[ae]\s+(?:nossa\s+)?equipe)\s+(?:consegue|pode)\s+confirmar\s+(?:isso|essa\s+informa)|(?:a\s+)?equipe\s+(?:pode|consegue)\s+confirmar\s+(?:isso|essa)|(?:falar|fale)\s+com\s+a\s+equipe/i
export function respostaSemInfo(t: string): boolean { return SEM_INFO_RE.test(String(t ?? '')) }
/** Sem palpite porque o objetivo não é açaí; quem confirmou 'sim' mantém o palpite mesmo com e_acai baixo. */
export function semPalpitePorAcai(anot: { nao_acai?: unknown; confirma_acai?: unknown; leitura?: unknown }): boolean {
  if (anot.confirma_acai === 'sim') return false
  if (anot.confirma_acai === 'nao' || anot.confirma_acai === 'consumo' || anot.nao_acai === true) return true
  const e = (anot.leitura as { e_acai?: unknown } | undefined | null)?.e_acai
  return anot.confirma_acai !== 'sim' && typeof e === 'number' && e < LIMIARES.E_ACAI_MIN
}
const TEL_RE = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}|\bwhats\s?app\b|\bzap\b/i
const PEDIU_CONTATO_RE = /contato|telefone|whats|zap|n[uú]mero|celular|ligar|falar\s+com\s+(?:algu[eé]m|uma\s+pessoa|atendente|a\s+equipe|voc[eê]s)|atend(?:e|em|imento|er)|fora\s+do\s+hor[aá]rio|hor[aá]rio\s+de\s+atendimento|entrar\s+em\s+contato|suporte|como\s+(?:eu\s+)?(?:fa[cç]o\s+)?(?:(?:pra|para)\s+)?(?:pedir|falar|falo|chamo|chamar|entro|entrar)|\bcopos?\b|marmitas?|quilo|\bkg\b|loja\s+f[ií]sica|balc[aã]o/i
const TEL_G_RE = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g
/** Telefone citado só reprova se NÃO for número liberado (fábrica/loja) ou se a pergunta não justifica contato. */
function telefoneSemPedido(t: string, pergunta: string): boolean {
  if (!TEL_RE.test(t)) return false
  const nums = (t.match(TEL_G_RE) ?? []).map((n) => n.replace(/\D/g, ''))
  if (nums.some((d) => !WAS_LIVRES.some((w) => d.endsWith(w) || w.endsWith(d)))) return true
  return !PEDIU_CONTATO_RE.test(pergunta)
}
/** Casa re em t ignorando ocorrências negadas: "não"/"nem"/"sem" colado ao termo (no máx. 1 palavra entre, sem pontuação). "sem dúvida" e "não se preocupe" não são negação. */
const NEGADOR_COLADO_RE = /(?:^|\s)(?:não|nao|nem|sem)\s+(?:(\p{L}+)\s+)?$/iu
function afirma(re: RegExp, t: string): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  for (const m of t.matchAll(g)) {
    const nm = NEGADOR_COLADO_RE.exec(t.slice(0, m.index))
    const entre = nm?.[1]?.toLowerCase()
    const negada = !!nm && !(entre === 'dúvida' || entre === 'duvida' || entre === 'se')
    if (!negada) return true
  }
  return false
}

const PEDE_DADOS_RE = /\b(me\s+(?:passa|passe|informe|envie|manda|mande|diga|fala|fale)|pode\s+(?:me\s+)?(?:passar|informar|enviar)|qual\s+(?:[ée]\s+)?(?:o\s+)?seu|informe\s+seu)\b.{0,40}\b(nome|telefone|celular|e-?mail|cpf|cnpj|endere[cç]o|cep|whatsapp)\b/i

/** Nº de frases (separa em . ! ? seguidos de espaço; abreviações e decimais não contam). */
export function contarFrases(t: string): number {
  const x = String(t ?? '').replace(/(?<![\p{L}])(?:Av|Sr|Sra|Dr|Dra|Prof|nº|n°)\./giu, (m) => m.replace('.', '')).replace(/(\d)[.,](\d)/g, '$1$2')
  return x.split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter((f) => /[\p{L}\d]/u.test(f)).length
}

const semAcento = (s: string) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const PERG_RESTRICAO_RE = /\b(?:gluten|celiac\w*|lactose|leite|alergi\w*|intoleran\w*|diabet\w*|acucar|zero|diet\w*|vegan\w*|restricao\s+alimentar)\b/
/** A PERGUNTA atual fala de restrição alimentar (glúten, lactose, alergia, diabetes, açúcar, vegano...). Sem isso a trava de saúde nunca reprova. */
export function perguntaDeRestricao(pergunta: string): boolean {
  return PERG_RESTRICAO_RE.test(semAcento(pergunta))
}
const SAUDE_TEMA_RE = /\b(?:gluten|lactose|celiac\w*|alergi\w*|intoleran\w*|diabet\w*|vegan\w*|quem\s+evita|quem\s+nao\s+pode|sem\s+leite|nao\s+(?:tem|leva)\s+leite|livre\s+de\s+leite)\b/
const SAUDE_OPCAO_PRODUTO_RE = /(?<!\b(?:boa|melhor|otima|ideal)\s)\bopcao\s+(?:livre\s+de\s+leite|sem\s+(?:gluten|leite|lactose))/g
const SAUDE_FORTE_RE = /\b(?:segur[oa]s?|sem\s+risco|sem\s+medo|pode\s+ficar\s+tranquil\w*|tranquil[oa]s?|liberad[oa]s?|indicad[oa]s?)\b/g
const SAUDE_FORTE_EXCL_RE = /\b(?:pagamento|compra\w*|cadastro|entrega\w*|site|endereco|pedido\w*)\b/
const SAUDE_FRACA_RE = /\b(?:(?:boa|melhor|otima|ideal)\s+(?:opcao|escolha)|ideal\s+p(?:ra|ara)\s+quem|p(?:ra|ara)\s+quem\b[^.!?]*\bideal|recomend\w*\s+p(?:ra|ara)\s+(?:quem|celiac\w*|intoleran\w*|alergic\w*|diabetic\w*|vegan\w*))\b/g
const SAUDE_PODE_RE = /\bpode(?:m)?\s+(?:consumir|comer|tomar)\b/
const SAUDE_PESSOA_RE = /\b(?:quem\s+evita|quem\s+tem|quem\s+nao\s+pode|celiac\w*|alergic\w*|intoleran\w*|diabetic\w*|vegan\w*)\b/
const SAUDE_RESSALVA_RE = /\bnao\s+oriento\b|\b(?:procure|pergunte|consulte)\s+(?:a\s+|com\s+)?(?:um|uma)\b|\b(?:perguntar|consultar|falar)\s+(?:a|com)\s+(?:um|uma)\s+(?:medic|nutri|pediatra)/
const SAUDE_NEGA_RE = /(?:^|\s)(?:(?:nao|nem)\s+(?:\w+\s+)?|nao\s+(?:posso|consigo|tenho\s+como|devo|garanto|da\s+pra|ha\s+como)\s+[^.!?;]*)$/
function temAfirmacao(re: RegExp, f: string, excl?: RegExp): boolean {
  if (excl?.test(f)) return false
  const g = new RegExp(re.source, 'g')
  for (const m of f.matchAll(g)) if (!SAUDE_NEGA_RE.test(f.slice(0, m.index))) return true
  return false
}
function saudeFraca(f: string): boolean {
  if (temAfirmacao(SAUDE_FRACA_RE, f)) return true
  const pode = SAUDE_PODE_RE.exec(f)
  return !!pode && SAUDE_PESSOA_RE.test(f) && !SAUDE_NEGA_RE.test(f.slice(0, pode.index))
}
/** Orientação de saúde. Só roda se a PERGUNTA atual for de restrição. Afirmação forte vale na mesma frase do tema ou na vizinha; fraca só na mesma frase de um tema forte. Negação ou ressalva na janela libera. */
export function orientaSaude(r: string, pergunta = ''): boolean {
  if (!perguntaDeRestricao(pergunta)) return false
  const fs = semAcento(r).split(/(?<=[.!?;:])\s+/).map((f) => f.replace(SAUDE_OPCAO_PRODUTO_RE, ' '))
  for (let i = 0; i < fs.length; i++) {
    if (!SAUDE_TEMA_RE.test(fs[i])) continue
    const jan = fs.slice(Math.max(0, i - 1), i + 2)
    if (jan.some((f) => SAUDE_RESSALVA_RE.test(f))) continue
    if (jan.some((f) => temAfirmacao(SAUDE_FORTE_RE, f, SAUDE_FORTE_EXCL_RE))) return true
    if (saudeFraca(fs[i])) return true
  }
  return false
}

/** Checagens por código do rascunho do Haiku. Devolve o código do MOTIVO (chave de MOTIVOS) ou null se passou. */
export function checarResposta(r: string, pergunta: string, isentoContato = false): string | null {
  const t = String(r ?? '').replace(/[<>]/g, '').trim() // texto BRUTO do Haiku (quebras de linha preservadas): markdown e frases são checados antes de achatar/cortar
  if (!t || /^(SEM_FATO|FORA_ESCOPO)$/i.test(t)) return 'vazio'
  if (t.replace(/\s+/g, ' ').length > LIMIARES.RESPOSTA_MAX_CHARS || contarFrases(t) > LIMIARES.FRASES_MAX) return 'longo'
  if (EMOJI_RE.test(t)) return 'emoji'
  if (MD_RE.test(t)) return 'markdown'
  if (respostaSuspeita(t, WAS_LIVRES)) return 'suspeita'
  if (PEDE_DADOS_RE.test(t)) return 'pede_dados'
  if (respostaForaDoAssunto(t, pergunta)) return 'vazamento'
  if (CUPOM_RE.test(t) && (!CUPOM_RE.test(pergunta) || afirma(CUPOM_AFIRMA_RE, t))) return 'cupom'
  if (VAGAS_RE.test(t) && (!VAGAS_RE.test(pergunta) || afirma(VAGAS_AFIRMA_RE, t))) return 'vagas'
  if (afirma(NOTA_FISCAL_RE, t)) return 'nota_fiscal'
  if (orientaSaude(t, pergunta)) return 'saude'
  if (!isentoContato && telefoneSemPedido(t, pergunta)) return 'telefone_sem_pedido'
  return null
}

/** Entrada do registro do Jev (jev_log): só rótulo, valor e efeito; NUNCA texto do cliente. Mantém as últimas 60. */
export type EntradaJev = { t: number; e: string; r: string; v: string | number; x: string }
export function juntarLog(atual: unknown, novas: EntradaJev[]): EntradaJev[] {
  const base = Array.isArray(atual) ? atual.filter((x: any) => x && typeof x.r === 'string') : []
  return [...base, ...novas].slice(-60)
}

/* ── Etapa 2 (reforma da Puri): interpretar, qualif, lista de espera, leitura, cartões ── */

export const QUALIF_CAMPOS: Record<string, string[]> = {
  ja_vende: ['ja_vendo', 'quero_comecar', 'outras_coisas'],
  compra: ['testar_1cx', '30l_mais'],
  comeco: ['esta_semana', 'este_mes', 'pesquisando'],
  papel: ['dono', 'socio', 'trabalho', 'vou_abrir'],
  conheceu: ['instagram', 'indicacao', 'google', 'compro_loja', 'outro'],
}
export const QUALIF_ESPECIAIS = ['nao_sei', 'pulou', 'texto']
export const INTERPRETAR_RESERVADOS = ['nao_sei', 'pulou', 'nenhuma']

export type Interpretar = { etapa: string; texto: string; opcoes: { id: string; rotulo: string }[] }
/** interpretar: etapa [a-z0-9_] ≤30; opções 1–10 (id ≤30 chars [A-Za-z0-9_], único e fora dos reservados; rótulo 1–60); texto mascarado 1–200. */
export function validarInterpretar(b: any): { ok: true; v: Interpretar } | { ok: false } {
  const etapa = typeof b?.etapa === 'string' ? b.etapa : ''
  if (!/^[a-z0-9_]{1,30}$/.test(etapa)) return { ok: false }
  const t = validarTexto(b?.texto)
  if (!t.ok) return { ok: false }
  const texto = mascarar(t.texto).trim()
  if (texto.length < 1 || texto.length > 200) return { ok: false }
  if (!Array.isArray(b?.opcoes) || b.opcoes.length < 1 || b.opcoes.length > 10) return { ok: false }
  const vistos = new Set<string>()
  const opcoes: { id: string; rotulo: string }[] = []
  for (const o of b.opcoes) {
    const id = typeof o?.id === 'string' ? o.id : ''
    const rotulo = limpaTxt(o?.rotulo)
    if (!/^[A-Za-z0-9_]{1,30}$/.test(id) || INTERPRETAR_RESERVADOS.includes(id) || vistos.has(id)) return { ok: false }
    if (rotulo.length < 1 || rotulo.length > 60) return { ok: false }
    vistos.add(id)
    opcoes.push({ id, rotulo })
  }
  return { ok: true, v: { etapa, texto, opcoes } }
}

/** Decisão do interpretar: 'nenhuma', probabilidade baixa ou id desconhecido → null. */
export function decidirInterpretar(escolha: unknown, p: unknown, ids: string[]): string | null {
  if (typeof escolha !== 'string' || escolha === 'nenhuma') return null
  if (typeof p !== 'number' || p < LIMIARES.INTERPRETAR_P_MIN) return null // sem probabilidade = baixa
  return ids.includes(escolha) || escolha === 'nao_sei' || escolha === 'pulou' ? escolha : null
}

export type Qualif = { campo: string; valor: string; texto: string | null }
/** qualif: campo e valor só das listas do contrato (+ nao_sei, pulou, texto); texto mascarado e cortado em 200. */
export function validarQualif(b: any): { ok: true; v: Qualif } | { ok: false } {
  const campo = typeof b?.campo === 'string' ? b.campo : ''
  const valor = typeof b?.valor === 'string' ? b.valor : ''
  if (!Object.hasOwn(QUALIF_CAMPOS, campo)) return { ok: false }
  if (!QUALIF_CAMPOS[campo].includes(valor) && !QUALIF_ESPECIAIS.includes(valor)) return { ok: false }
  let texto: string | null = null
  if (b?.texto !== undefined && b?.texto !== null) {
    const t = validarTexto(b.texto)
    if (!t.ok) return { ok: false }
    texto = mascarar(t.texto).trim().slice(0, 200).trim() || null
  }
  if (valor === 'texto' && !texto) return { ok: false }
  return { ok: true, v: { campo, valor, texto: valor === 'texto' ? texto : null } }
}

export type ListaEspera = { nome: string; telefone: string; cidade: string }
/** lista_espera: nome 2–80, telefone (mesma normalização da visita), cidade 2–60 texto livre. */
export function validarListaEspera(b: any, exigeCidade = true): { ok: true; v: ListaEspera } | { ok: false } {
  const nome = limpaTxt(b?.nome)
  const cidade = limpaTxt(b?.cidade)
  const telefone = normalizarTelefone(b?.telefone)
  const cidadeOk = exigeCidade ? cidade.length >= 2 && cidade.length <= 60 : cidade.length <= 60 // contato: a cidade é a do lead, então é dispensada
  if (nome.length < 2 || nome.length > 80 || !cidadeOk || !telefone) return { ok: false }
  return { ok: true, v: { nome, telefone, cidade } }
}

/** Valor do confirma_acai. */
export const ehConfirmaAcai = (x: unknown): x is 'sim' | 'nao' | 'consumo' => x === 'sim' || x === 'nao' || x === 'consumo'

/** Cartões da cena: JSON {cenario, trava, chegar}, cada um 4–60 chars; senão null. */
export function parseCartoes(s: string): { cenario: string; trava: string; chegar: string } | null {
  const j = extrairJson(s)
  if (!j || typeof j !== 'object') return null
  const f = (x: unknown) => { const t = limparIA(x, 200); return t.length >= 4 && t.length <= 60 && !/https?:|www\.|@/i.test(t) ? t : '' }
  const cenario = f(j.cenario), trava = f(j.trava), chegar = f(j.chegar)
  return cenario && trava && chegar ? { cenario, trava, chegar } : null
}

/** Pergunta de esclarecimento: 1 frase terminada em "?", 8–140 chars, sem link/número/emoji/formatação. */
export function parsePerguntaEsclarecer(s: string): string | null {
  const t = limparResposta(s).replace(/^["“]|["”]$/g, '').trim()
  if (t.length < 8 || t.length > 140 || !t.endsWith('?') || t.slice(0, -1).includes('?')) return null
  if (/https?:|www\.|@|\d|[*_`#]|\p{Extended_Pictographic}/u.test(t)) return null
  return t
}

export const ROTULOS_COMPRA: Record<string, string> = { testar_1cx: 'Começar com 1 caixa pra testar', '30l_mais': '30 L ou mais por pedido', nao_sei: 'Ainda não sei' }
/** Ordem das opções de compra (regra de código a partir do perfil; devolve também o motivo para o jev_log). */
export function ordenarOpcoesCompra(jaVende: unknown, movimento: unknown, iniciante: number | null): { opcoes: { id: string; rotulo: string }[]; motivo: string } {
  const grande = movimento === '50a100' || movimento === '100mais'
  const comeca = jaVende === 'quero_comecar' || (jaVende == null && iniciante != null && iniciante >= LIMIARES.INICIANTE_MIN)
  let motivo = 'padrao'
  let primeiro = 'testar_1cx'
  if (jaVende === 'ja_vendo' && grande) { primeiro = '30l_mais'; motivo = 'ja_vende_movimento_alto' }
  else if (comeca) { motivo = 'vai_comecar' }
  else if (grande) { primeiro = '30l_mais'; motivo = 'movimento_alto' }
  const ids = primeiro === '30l_mais' ? ['30l_mais', 'testar_1cx', 'nao_sei'] : ['testar_1cx', '30l_mais', 'nao_sei']
  return { opcoes: ids.map((id) => ({ id, rotulo: ROTULOS_COMPRA[id] })), motivo }
}

/** Três segmentos mais prováveis (ids da lista; completa com os demais se faltar probabilidade). */
export function topSegmentos(probs: unknown, escolhido: string): string[] {
  const pr = probs && typeof probs === 'object' ? probs as Record<string, unknown> : {}
  const ord = SEGMENTOS.filter((s) => typeof pr[s] === 'number').sort((a, b) => (pr[b] as number) - (pr[a] as number))
  const out: string[] = []
  for (const s of [...ord, escolhido, ...SEGMENTOS]) if (SEGMENTOS.includes(s) && !out.includes(s)) out.push(s)
  return out.slice(0, 3)
}

/* ── Etapa 3: esforço e destino ──────────────────────────────────────── */

/** Esforço 0–3 (só código): +1 se 3 min ou mais desde a criação; +1 se detalhou (objetivo/escuta >= 60 chars ou resposta do aprofundar útil); +1 se respondeu >= 4 das 5 perguntas de qualificação sem 'pulou'/'nao_sei'. */
export function calcularEsforco(lead: { criado_em?: unknown; anotacoes?: unknown }, agora: number = Date.now()): number {
  const a = lead?.anotacoes && typeof lead.anotacoes === 'object' && !Array.isArray(lead.anotacoes) ? lead.anotacoes as Record<string, unknown> : {}
  let n = 0
  const t0 = typeof lead?.criado_em === 'string' || typeof lead?.criado_em === 'number' ? new Date(lead.criado_em as string | number).getTime() : NaN
  if (Number.isFinite(t0) && agora - t0 >= LIMIARES.ESFORCO_MIN_MS) n++
  const quer = typeof a.quer === 'string' ? a.quer.replace(/\s+/g, ' ').trim() : ''
  const apr = typeof a.aprof_resposta === 'string' ? a.aprof_resposta.trim() : ''
  const aprUtil = apr.length > 0 && !['nao_sei', 'pulou', 'nao sei', 'pular'].includes(normalizarCidade(apr))
  if (quer.length >= LIMIARES.ESFORCO_DETALHE_CHARS || aprUtil) n++
  const q = a.qualif && typeof a.qualif === 'object' && !Array.isArray(a.qualif) ? a.qualif as Record<string, unknown> : {}
  const resp = ['ja_vende', 'compra', 'comeco', 'papel', 'conheceu'].filter((c) => typeof q[c] === 'string' && q[c] !== '' && q[c] !== 'pulou' && q[c] !== 'nao_sei').length
  if (resp >= 4) n++
  return n
}

export type Destino = 'contato_rapido' | 'visita' | 'cadastro' | 'delivery' | 'lista_espera'
export type EntradaDestino = {
  listaEspera: boolean
  jaVende: unknown
  movimento: unknown
  coerente: boolean | null | undefined
  comeco: unknown
  cidade: unknown
  consumidor: number | null // Jev (JEV_CONSUMIDOR); null = falhou = "não"
  pontoDefinido: number | null
  provar: number | null
}
/** Destino da conversa, regras a–e na ordem. Jev null conta como "não"; cidade fora de Cuiabá/Várzea Grande nunca vai para visita. */
export function escolherDestino(e: EntradaDestino): { destino: Destino; regra: string } {
  const ok = (v: number | null, min: number) => typeof v === 'number' && v >= min
  if (e.listaEspera === true) return { destino: 'lista_espera', regra: 'a' }
  if (ok(e.consumidor, LIMIARES.CONSUMIDOR_MIN)) return { destino: 'delivery', regra: 'b' }
  const grande = e.movimento === '50a100' || e.movimento === '100mais'
  if (e.jaVende === 'ja_vendo' && grande && e.coerente !== false) return { destino: 'contato_rapido', regra: 'c1' }
  if (ok(e.pontoDefinido, LIMIARES.PONTO_DEFINIDO_MIN) && (e.comeco === 'esta_semana' || e.comeco === 'este_mes')) return { destino: 'contato_rapido', regra: 'c2' }
  if (Object.hasOwn(CIDADES_VISITA, normalizarCidade(e.cidade)) && ok(e.provar, LIMIARES.PROVAR_MIN)) return { destino: 'visita', regra: 'd' }
  return { destino: 'cadastro', regra: 'e' }
}

/** Lead que respondeu 'consumo' no confirma_acai não volta ao fluxo de revenda: só o próprio confirma_acai segue aceito (a pessoa pode mudar de ideia). */
export function passoBloqueadoPorConsumo(anot: unknown, passo: string): boolean {
  if (passo === 'confirma_acai') return false
  return !!anot && typeof anot === 'object' && (anot as Record<string, unknown>).confirma_acai === 'consumo'
}

/* ── Fatos da Puri: monta o texto a partir das linhas do banco (puri_fatos) ou do código ── */
export type FatoCodigo = { assunto: string; titulo?: string; texto: string; travado?: boolean }
export type LinhaFato = { assunto: string; ordem?: number | null; publicado?: string | null; rascunho?: string | null }
const temTelefoneNaoLiberado = (t: string): boolean =>
  (t.match(TEL_G_RE) ?? []).map((n) => n.replace(/\D/g, '')).some((d) => !WAS_LIVRES.some((w) => d.endsWith(w) || w.endsWith(d)))
/** dev lê rascunho; qualquer outro ambiente lê publicado. Assunto travado = sempre código. Qualquer anomalia volta tudo para o código. */
export function montarFatos(linhas: LinhaFato[] | null | undefined, amb: string, lista: FatoCodigo[]): { texto: string; origem: 'banco' | 'codigo'; motivo?: string; trocados: string[] } {
  const codigo = (motivo: string) => ({ texto: lista.map((f) => f.texto).join('\n'), origem: 'codigo' as const, motivo, trocados: [] as string[] })
  if (!Array.isArray(linhas) || !linhas.length) return codigo('sem_linhas')
  const porAssunto = new Map<string, LinhaFato>()
  for (const l of linhas) if (l && typeof l.assunto === 'string') porAssunto.set(l.assunto, l)
  const partes: string[] = []
  let doBanco = false
  const trocados: string[] = []
  for (const f of lista) {
    if (f.travado) { partes.push(f.texto); continue }
    const l = porAssunto.get(f.assunto)
    const bruto = l ? (amb === 'dev' ? l.rascunho : l.publicado) : null
    if (typeof bruto !== 'string' || !bruto.trim()) return codigo('assunto_faltando')
    const t = bruto.replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
    if (t.length < 10 || t.length > 2000) return codigo('tamanho_do_texto')
    if (temTelefoneNaoLiberado(t)) { partes.push(f.texto); trocados.push(f.assunto); continue }
    partes.push(t)
    doBanco = true
  }
  const total = partes.join('\n')
  if (total.length < 1000 || total.length > 15000) return codigo('tamanho_total')
  return { texto: total, origem: doBanco ? 'banco' : 'codigo', trocados }
}

/** Cache dos fatos: `v` é o texto servido até `t+ttl`; `bomT`/`bomV` guardam a última leitura boa do banco (origem 'banco'). */
export type CacheFatos = { t: number; ttl: number; v: string; bomT: number | null; bomV: string | null }
export const FATOS_TTL_FALHA_MS = 60000
export const FATOS_VALIDADE_BOM_MS = 30 * 60000
/** Leitura válida do banco: guarda como "última boa" só se a origem for banco; origem código (anomalia) apaga a última boa. */
export function cacheAposLeitura(agora: number, ttlOk: number, m: { texto: string; origem: 'banco' | 'codigo' }): CacheFatos {
  return m.origem === 'banco'
    ? { t: agora, ttl: ttlOk, v: m.texto, bomT: agora, bomV: m.texto }
    : { t: agora, ttl: Math.min(ttlOk, FATOS_TTL_FALHA_MS), v: m.texto, bomT: null, bomV: null }
}
/** Falha de leitura (prazo, erro, exceção): reusa o último texto bom por mais 60 s, até 30 min desde aquela leitura boa; senão, código. */
export function cacheAposFalha(anterior: CacheFatos | undefined, agora: number, textoCodigo: string): { cache: CacheFatos; usou: 'antigo' | 'codigo' } {
  if (anterior && anterior.bomV !== null && anterior.bomT !== null && agora - anterior.bomT <= FATOS_VALIDADE_BOM_MS)
    return { cache: { t: agora, ttl: FATOS_TTL_FALHA_MS, v: anterior.bomV, bomT: anterior.bomT, bomV: anterior.bomV }, usou: 'antigo' }
  return { cache: { t: agora, ttl: FATOS_TTL_FALHA_MS, v: textoCodigo, bomT: null, bomV: null }, usou: 'codigo' }
}
