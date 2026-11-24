// Teste local (deno test supabase/functions/assistente/logica_test.ts). NÃO entra no deploy da Edge Function.
import { PERGUNTAS_ESCLARECER_FIXAS, NOTAS_DESENCONTRO, TXT_SAUDE, TXT_SAUDE_LEITE, TXT_SAUDE_GLUTEN, SEGURA } from './prompts.ts'
import { orientaSaude, checarResposta, notasDaPergunta, respostaSemInfo, semPalpitePorAcai, validarInterpretar, validarQualif, validarListaEspera, ordenarOpcoesCompra, decidirInterpretar, parseCartoes, parsePerguntaEsclarecer, validarPerfil, perguntaProibida, parsePerguntasAprof, parseAlternativasPalpite, ordenarAlternativas, validarTermo, parseResumo, cortarProblema, parseMapa, setasDosNos, inserirNoContexto, montarPatch, regraInicioMovimento } from './logica.ts'
import { socialAbertura } from './logica.ts'
import { calcularEsforco, escolherDestino, normalizarTelefone, validarListaEspera as vle2 } from './logica.ts'
import { passoBloqueadoPorConsumo, calcularSimulacao } from './logica.ts'
import { FATOS_LISTA, FATOS } from './fatos.ts'

function eq(a: unknown, b: unknown, msg = '') {
  if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)} ${msg}`)
}
const passa = (r: string, p: string) => eq(checarResposta(r, p), null, `[${p} | ${r}]`)
const reprova = (r: string, p: string, motivo?: string) => {
  const m = checarResposta(r, p)
  if (m === null || (motivo && m !== motivo)) throw new Error(`deveria reprovar${motivo ? ' (' + motivo + ')' : ''}, veio ${m} [${p} | ${r}]`)
}

Deno.test('telefone liberado + contexto passa', () => {
  passa('Pode chamar no WhatsApp da fábrica: (65) 99288-8228.', 'qual o WhatsApp de vocês?')
  passa('Copo de açaí é na loja: WhatsApp (65) 9694-9542.', 'vocês vendem copo de açaí?')
  passa('Chama no (65) 9694-9542 que a loja te atende.', 'como faço pra pedir?')
  passa('Chama no (65) 9694-9542 que a loja te atende.', 'como falo com vocês?')
  passa('Marmita é na loja, (65) 9694-9542.', 'tem marmita?')
  passa('Açaí por quilo é na loja, (65) 9694-9542.', 'vende açaí por kg?')
  passa('Fora do horário, o WhatsApp da fábrica (65) 99288-8228 atende com chatbot de autoatendimento.', 'quem atende fora do horário?')
})

Deno.test('telefone inventado ou sem contexto reprova', () => {
  reprova('Chama no (65) 91234-5678.', 'qual o telefone de vocês?')
  reprova('Chama no (65) 9694-9542.', 'qual o preço do açaí de 5 litros?', 'telefone_sem_pedido')
})

Deno.test('cupom: negação passa, afirmação reprova', () => {
  passa('Não temos cupom; a taxa aparece antes de pagar.', 'tem cupom?')
  passa('Não há cupom nem frete grátis.', 'tem cupom?')
  reprova('Temos cupom de frete grátis!', 'tem cupom?', 'cupom')
})

Deno.test('vagas: negação passa, afirmação reprova', () => {
  passa('Não há vagas limitadas por turno.', 'tem vagas?')
  reprova('Ainda temos vagas no turno da manhã.', 'tem vagas?', 'vagas')
})

Deno.test('nota fiscal: negação passa, afirmação reprova', () => {
  passa('Não emitimos nota fiscal aqui.', 'dá nota?')
  passa('Não vai com nota.', 'dá nota?')
  reprova('Emitimos nota fiscal em todo pedido.', 'dá nota?', 'nota_fiscal')
  reprova('Sai com nota fiscal sim.', 'dá nota?', 'nota_fiscal')
})

Deno.test('Q_VAGAS (notasDaPergunta)', () => {
  const v = (p: string) => notasDaPergunta(p).notas.includes('vagas_turno')
  eq(v('tem vaga no turno da manhã?'), true)
  eq(v('qual o limite de pedidos por turno?'), true)
  eq(v('quantos pedidos por turno vocês fazem?'), true)
  eq(v('quantas entregas no turno da tarde?'), true)
  eq(v('qual o limite de km da entrega?'), false)
  eq(v('qual o limite mínimo do pedido?'), false)
  eq(v('qual o limite de crédito a prazo?'), false)
})

Deno.test('Q_EMPREGO', () => {
  const e = (p: string) => notasDaPergunta(p).emprego
  eq(e('tem emprego aí?'), true)
  eq(e('tem vaga de emprego?'), true)
  eq(e('quero trabalhar com vocês'), true)
  eq(e('posso trabalhar aí?'), true)
  eq(e('mando meu currículo?'), true)
  eq(e('vocês empregam conservante?'), false)
  eq(e('o empregado entrega?'), false)
})

Deno.test('SEM_INFO: "não sei" só nas formas de admissão', () => {
  eq(respostaSemInfo('Não sei te dizer isso.'), true)
  eq(respostaSemInfo('Não sei informar.'), true)
  eq(respostaSemInfo('Isso eu não sei.'), true)
  eq(respostaSemInfo('Não sei se você prefere o de 5 L ou o de 10 L.'), false)
})

Deno.test('negação só colada ao termo (afirma)', () => {
  reprova('Não se preocupe, temos cupom.', 'tem cupom?', 'cupom')
  reprova('Sem dúvida, emitimos nota fiscal.', 'vocês emitem nota fiscal?', 'nota_fiscal')
  passa('Não temos cupom, a taxa aparece antes de pagar.', 'tem cupom?')
  reprova('Temos cupom, e não precisa de cadastro.', 'tem cupom?', 'cupom')
  reprova('Chama no (65) 9694-9542.', 'qual o preço do açaí de 5 litros?', 'telefone_sem_pedido')
})

Deno.test('normalizarCidade sem escape unicode continua reconhecendo', async () => {
  const { normalizarCidade } = await import('./logica.ts')
  eq(normalizarCidade('Várzea Grande'), 'varzea grande')
  eq(normalizarCidade('Cuiabá'), 'cuiaba')
})

Deno.test('validarInterpretar: válido e inválidos', () => {
  const ok = validarInterpretar({ etapa: 'ja_vende', texto: 'já vendo sorvete', opcoes: [{ id: 'ja_vendo', rotulo: 'Já vendo' }, { id: 'quero_comecar', rotulo: 'Quero começar' }] })
  eq(ok.ok, true)
  eq(validarInterpretar({ etapa: 'Etapa X', texto: 'oi', opcoes: [{ id: 'a', rotulo: 'A' }] }).ok, false, 'etapa')
  eq(validarInterpretar({ etapa: 'x', texto: '', opcoes: [{ id: 'a', rotulo: 'A' }] }).ok, false, 'texto vazio')
  eq(validarInterpretar({ etapa: 'x', texto: 'oi', opcoes: [] }).ok, false, 'sem opções')
  eq(validarInterpretar({ etapa: 'x', texto: 'oi', opcoes: [{ id: 'nao_sei', rotulo: 'A' }] }).ok, false, 'id reservado')
  eq(validarInterpretar({ etapa: 'x', texto: 'oi', opcoes: [{ id: 'a', rotulo: 'A' }, { id: 'a', rotulo: 'B' }] }).ok, false, 'id repetido')
  eq(validarInterpretar({ etapa: 'x', texto: 'oi', opcoes: [{ id: 'a b', rotulo: 'A' }] }).ok, false, 'id com espaço')
  eq(decidirInterpretar('nenhuma', 0.9, ['a']), null)
  eq(decidirInterpretar('a', 0.9, ['a']), 'a')
  eq(decidirInterpretar('zzz', 0.9, ['a']), null)
})

Deno.test('validarQualif: válido e inválidos', () => {
  eq(validarQualif({ campo: 'papel', valor: 'dono' }).ok, true)
  eq(validarQualif({ campo: 'papel', valor: 'nao_sei' }).ok, true)
  const t = validarQualif({ campo: 'conheceu', valor: 'texto', texto: 'vi num evento' })
  eq(t.ok && t.v.texto, 'vi num evento')
  eq(validarQualif({ campo: 'conheceu', valor: 'texto' }).ok, false, 'texto sem texto')
  eq(validarQualif({ campo: 'papel', valor: 'instagram' }).ok, false, 'valor de outro campo')
  eq(validarQualif({ campo: 'inexistente', valor: 'dono' }).ok, false, 'campo')
  eq(validarQualif({ campo: 'toString', valor: 'dono' }).ok, false, 'campo herdado')
})

Deno.test('validarListaEspera: válido e inválidos', () => {
  const ok = validarListaEspera({ nome: 'Maria Souza', telefone: '(65) 99288-8228', cidade: 'Sinop' })
  eq(ok.ok, true)
  eq(validarListaEspera({ nome: 'M', telefone: '(65) 99288-8228', cidade: 'Sinop' }).ok, false, 'nome curto')
  eq(validarListaEspera({ nome: 'Maria', telefone: '123', cidade: 'Sinop' }).ok, false, 'telefone')
  eq(validarListaEspera({ nome: 'Maria', telefone: '(65) 99288-8228', cidade: '' }).ok, false, 'cidade')
  eq(validarListaEspera({}).ok, false, 'vazio')
})

Deno.test('ordenarOpcoesCompra: ordem pelo perfil', () => {
  const ids = (r: { opcoes: { id: string }[] }) => r.opcoes.map((o) => o.id).join(',')
  eq(ids(ordenarOpcoesCompra('quero_comecar', '100mais', null)), 'testar_1cx,30l_mais,nao_sei')
  eq(ids(ordenarOpcoesCompra('ja_vendo', '50a100', null)), '30l_mais,testar_1cx,nao_sei')
  eq(ordenarOpcoesCompra('ja_vendo', '50a100', null).motivo, 'ja_vende_movimento_alto')
  eq(ids(ordenarOpcoesCompra(null, 'ate20', null)), 'testar_1cx,30l_mais,nao_sei')
  eq(ids(ordenarOpcoesCompra(undefined, '100mais', null)), '30l_mais,testar_1cx,nao_sei')
  eq(ids(ordenarOpcoesCompra(null, '100mais', 0.9)), 'testar_1cx,30l_mais,nao_sei')
  eq(ids(ordenarOpcoesCompra('xyz', 'lixo', null)), 'testar_1cx,30l_mais,nao_sei')
})

Deno.test('parseCartoes: válido e inválidos', () => {
  const ok = parseCartoes('{"cenario":"Você vende na feira","trava":"Medo de sobrar produto","chegar":"Ter um ponto fixo"}')
  eq(JSON.stringify(ok), JSON.stringify({ cenario: 'Você vende na feira', trava: 'Medo de sobrar produto', chegar: 'Ter um ponto fixo' }))
  eq(parseCartoes('não é json'), null)
  eq(parseCartoes('{"cenario":"Você vende na feira","trava":"Medo de sobrar produto"}'), null)
  eq(parseCartoes('{"cenario":"' + 'a'.repeat(61) + '","trava":"Medo de sobrar","chegar":"Ponto fixo"}'), null)
  eq(parseCartoes('{"cenario":"Veja www.site.com","trava":"Medo de sobrar","chegar":"Ponto fixo"}'), null)
})

Deno.test('parsePerguntaEsclarecer: válida e inválidas', () => {
  eq(parsePerguntaEsclarecer('Esse movimento é para o seu ponto atual?'), 'Esse movimento é para o seu ponto atual?')
  eq(parsePerguntaEsclarecer('Entendi o seu caso.'), null)
  eq(parsePerguntaEsclarecer('Quantos copos? E onde?'), null)
  eq(parsePerguntaEsclarecer('Vende 50 copos por dia?'), null)
  eq(parsePerguntaEsclarecer('Veja https://x.com agora?'), null)
  eq(parsePerguntaEsclarecer('Oi?'), null)
})

Deno.test('validarPerfil: retira', () => {
  const base = { segmento: 'acaiteria', cidade: 'Cuiabá', movimento: 'ate20' }
  const a = validarPerfil({ ...base, retira: true })
  eq(a.ok && a.v.retira, true)
  const b = validarPerfil(base)
  eq(b.ok && b.v.retira, false)
  const c = validarPerfil({ ...base, retira: 'sim' })
  eq(c.ok && c.v.retira, false)
})

Deno.test('perguntaProibida: preço, dado pessoal e promessa', () => {
  eq(perguntaProibida('Quanto custa o litro hoje?'), true)
  eq(perguntaProibida('Qual é o seu telefone?'), true)
  eq(perguntaProibida('Eu garanto que vende muito, certo?'), true)
  eq(perguntaProibida('Qual o seu nome completo?'), true)
  eq(perguntaProibida('O que mais dificulta a saída do açaí no seu ponto?'), false)
  eq(perguntaProibida('Quantos copos você vende por dia?'), false)
})

Deno.test('parsePerguntasAprof descarta pergunta proibida', () => {
  const r = parsePerguntasAprof(JSON.stringify({ perguntas: [
    { pergunta: 'Quanto custa o açaí que você compra?', respostas: ['a b', 'c d', 'e f'] },
    { pergunta: 'O que mais trava a saída do açaí aí?', respostas: ['Pouco movimento', 'Falta freezer', 'Não sei bem'] },
  ] }))
  eq(r?.length, 1)
  eq(r?.[0].pergunta, 'O que mais trava a saída do açaí aí?')
})

Deno.test('parseAlternativasPalpite: até 3, sem repetidas, lixo some', () => {
  const f = 'Meu palpite: falta freezer no ponto. Acertei?'
  const r = parseAlternativasPalpite(JSON.stringify({ alternativas: [f, f, 'curta', 'Meu palpite: o movimento é pouco. Acertei?', 'Meu palpite: a vizinhança não conhece. Acertei?', 'Meu palpite: quarta frase aqui. Acertei?'] }))
  eq(r?.length, 3)
  eq(r?.[0], f)
  eq(parseAlternativasPalpite('texto solto'), null)
  eq(parseAlternativasPalpite('{"alternativas":["x"]}'), null)
})

Deno.test('ordenarAlternativas: descarta reprovadas e não conferidas, ordena', () => {
  const r = ordenarAlternativas([{ frase: 'a', inventa: 0.4 }, { frase: 'b', inventa: 0.1 }, { frase: 'c', inventa: 0.8 }, { frase: 'd', inventa: null }])
  eq(r.join(','), 'b,a')
})

Deno.test('decidirInterpretar: sem probabilidade = baixa', () => {
  eq(decidirInterpretar('a', undefined, ['a']), null)
  eq(decidirInterpretar('a', 0.9, ['a']), 'a')
})

Deno.test('validarTermo: ≤ 5 palavras e ≤ 40 caracteres', () => {
  eq(validarTermo('Medo de perder estoque.'), 'Medo de perder estoque')
  eq(validarTermo('um dois três quatro cinco seis'), null)
  eq(validarTermo('a'.repeat(41)), null)
  eq(validarTermo('ab'), null)
  eq(validarTermo(undefined), null)
})

Deno.test('parseResumo: com termo válido, inválido e ausente', () => {
  const ok = parseResumo('{"resumo":"Você quer começar a vender açaí com pouco risco.","problema":"Medo de começar","termo":"Medo do primeiro passo"}')
  eq(ok?.termo, 'Medo do primeiro passo')
  eq(parseResumo('{"resumo":"Você quer começar a vender açaí com pouco risco.","problema":"Medo de começar","termo":"uma frase bem longa demais para ser termo"}')?.termo, null)
  eq(parseResumo('{"resumo":"Você quer começar a vender açaí com pouco risco.","problema":"Medo de começar"}')?.termo, null)
  eq(parseResumo('{"resumo":"curto","problema":"x"}'), null)
})

Deno.test('parseMapa: subconjunto de nós', () => {
  const j = '{"problema":"Não sabe quanto pedir","causa":"Sem histórico de vendas","risco":"Sobrar estoque","destino":"Vender com segurança","setas":["trava em","porque","pode gerar","para chegar a"]}'
  const sub = parseMapa(j, ['negocio', 'problema', 'destino'])
  eq(sub?.causa, null); eq(sub?.risco, null); eq(sub?.destino, 'Vender com segurança'); eq(sub?.passo, false)
  const todos = parseMapa(j)
  eq(todos?.causa, 'Sem histórico de vendas'); eq(todos?.risco, 'Sobrar estoque'); eq(todos?.passo, true)
  // causa escolhida mas ausente → inválido
  eq(parseMapa('{"problema":"Não sabe quanto pedir","causa":null,"destino":"x","setas":[]}', ['negocio', 'problema', 'causa']), null)
  // só negocio+problema: o resto do JSON é ignorado
  eq(parseMapa(j, ['negocio', 'problema'])?.destino, null)
})

Deno.test('setas por par de tipos: nó tirado não desloca as legendas', () => {
  const j = '{"problema":"Não sabe quanto pedir","causa":"Sem histórico de vendas","risco":"Sobrar estoque","destino":"Vender com segurança","setas":["trava em","porque","pode gerar","para chegar a"]}'
  const m = parseMapa(j)!
  eq(JSON.stringify(setasDosNos(['negocio', 'problema', 'causa', 'risco', 'destino'], m.setasPar)), JSON.stringify(['trava em', 'porque', 'pode gerar', 'para chegar a']))
  // risco não veio: a seta causa>destino não existiu na pergunta, vira null (e "para chegar a" não cai na ligação errada)
  eq(JSON.stringify(setasDosNos(['negocio', 'problema', 'causa', 'destino'], m.setasPar)), JSON.stringify(['trava em', 'porque', null]))
  // Jev tirou causa e risco: pares escolhidos são negocio>problema>destino
  const m2 = parseMapa(j, ['negocio', 'problema', 'destino'])!
  eq(JSON.stringify(setasDosNos(['negocio', 'problema', 'destino'], m2.setasPar)), JSON.stringify(['trava em', 'porque']))
})

Deno.test('inserirNoContexto: antes do ultimo fechamento, robusto a espacos e fechamento ausente', () => {
  eq(inserirNoContexto('<contexto>\na\n</contexto>', '\nX'), '<contexto>\na\nX\n</contexto>')
  eq(inserirNoContexto('<contexto>\na\n</contexto>\n', '\nX'), '<contexto>\na\nX\n</contexto>\n')
  eq(inserirNoContexto('<contexto>\na', '\nX'), '<contexto>\na\nX')
})

Deno.test('montarPatch: só chaves definidas', () => {
  eq(JSON.stringify(montarPatch({ quer: 'a', leitura: undefined, iniciante: 0.5, topicos: [] })), JSON.stringify({ quer: 'a', iniciante: 0.5, topicos: [] }))
})

Deno.test('regraInicioMovimento', () => {
  eq(regraInicioMovimento('quero_comecar', undefined, null, '100mais'), true)
  eq(regraInicioMovimento(undefined, 'vou_abrir', null, '100mais'), true)
  eq(regraInicioMovimento(undefined, undefined, 0.7, '100mais'), true)
  eq(regraInicioMovimento('outras_coisas', 'dono', 0.2, '100mais'), false)
  eq(regraInicioMovimento('ja_vendo', 'dono', null, '100mais'), false)
  eq(regraInicioMovimento('quero_comecar', undefined, null, '20a50'), false)
})

Deno.test('respostaSemInfo: remete à equipe (nota fiscal)', () => {
  eq(respostaSemInfo('Essa informação sobre nota fiscal no delivery eu não tenho aqui... uma pessoa da nossa equipe consegue confirmar isso.'), true)
  eq(respostaSemInfo('Não tenho isso por aqui.'), true)
  eq(respostaSemInfo('Fale com uma pessoa de nossa equipe.'), true)
  eq(respostaSemInfo('A nossa equipe consegue confirmar isso pra você.'), true)
  eq(respostaSemInfo('Sim, emitimos nota fiscal no delivery.'), false)
  eq(respostaSemInfo('A equipe de entrega sai às 8h.'), false)
  eq(respostaSemInfo('A pessoa da equipe de entrega liga antes de chegar.'), false)
  eq(respostaSemInfo('Uma pessoa da nossa equipe vai te chamar.'), true)
  eq(respostaSemInfo('A equipe pode confirmar isso pra você.'), true)
  eq(respostaSemInfo('Fale com a equipe pelo WhatsApp.'), true)
  eq(respostaSemInfo('Nossa equipe confirma o pedido pelo WhatsApp em seguida.'), false)
  eq(respostaSemInfo('O time de entrega consegue confirmar o horário certinho.'), false)
})

Deno.test('esclarecimento: perguntas fixas passam no parse', () => {
  for (const q of Object.values(PERGUNTAS_ESCLARECER_FIXAS)) eq(parsePerguntaEsclarecer(q), q)
  eq(Object.keys(PERGUNTAS_ESCLARECER_FIXAS).sort().join(), Object.keys(NOTAS_DESENCONTRO).sort().join())
})

Deno.test('respostaSemInfo: só remete à equipe de fato', () => {
  eq(respostaSemInfo('Essa informação sobre nota fiscal no delivery eu não tenho aqui, mas uma pessoa da nossa equipe consegue confirmar isso.'), true)
  eq(respostaSemInfo('uma pessoa da equipe consegue te ajudar'), true)
  eq(respostaSemInfo('a equipe te ajuda com isso'), true)
  eq(respostaSemInfo('Isso eu não tenho aqui.'), true)
  eq(respostaSemInfo('não tenho essa informação'), true)
  eq(respostaSemInfo('nossa equipe consegue confirmar essa informação'), true)
  eq(respostaSemInfo('o time consegue confirmar isso pra você'), true)
  eq(respostaSemInfo('não tenho isso aqui'), true)
  eq(respostaSemInfo('Nossa equipe confirma o pedido pelo WhatsApp em seguida.'), false)
  eq(respostaSemInfo('A equipe confirma o horário do turno.'), false)
  eq(respostaSemInfo('Depois que você pedir, a equipe confirma o pagamento.'), false)
  eq(respostaSemInfo('a equipe vai confirmar o seu cadastro'), false)
  eq(respostaSemInfo('O time de entrega consegue confirmar o horário certinho.'), false)
  eq(respostaSemInfo('Não tenho isso a oferecer em promoção'), false)
  eq(respostaSemInfo('Não tenho aqui como mostrar fotos'), false)
})

Deno.test('semPalpitePorAcai', () => {
  eq(semPalpitePorAcai({ confirma_acai: 'sim', leitura: { e_acai: 0.1 } }), false)
  eq(semPalpitePorAcai({ confirma_acai: 'nao', leitura: { e_acai: 0.9 } }), true)
  eq(semPalpitePorAcai({ leitura: { e_acai: 0.1 } }), true)
  eq(semPalpitePorAcai({ leitura: { e_acai: 0.9 } }), false)
  eq(semPalpitePorAcai({}), false)
  eq(semPalpitePorAcai({ confirma_acai: 'sim', nao_acai: true }), false)
  eq(semPalpitePorAcai({ nao_acai: true }), true)
  eq(semPalpitePorAcai({ confirma_acai: 'consumo', leitura: { e_acai: 0.9 } }), true)
  eq(semPalpitePorAcai({ confirma_acai: 'consumo' }), true)
})

const AGORA = Date.parse('2026-11-22T12:00:00Z')
const ha = (min: number) => new Date(AGORA - min * 60000).toISOString()
const Q5 = { ja_vende: 'ja_vendo', compra: 'testar_1cx', comeco: 'este_mes', papel: 'dono', conheceu: 'instagram' }
Deno.test('calcularEsforco: zero e máximo', () => {
  eq(calcularEsforco({ criado_em: ha(1), anotacoes: {} }, AGORA), 0)
  eq(calcularEsforco({ criado_em: ha(10), anotacoes: { quer: 'x'.repeat(60), qualif: Q5 } }, AGORA), 3)
  eq(calcularEsforco({}, AGORA), 0)
})
Deno.test('calcularEsforco: tempo (borda de 3 min)', () => {
  eq(calcularEsforco({ criado_em: ha(3), anotacoes: {} }, AGORA), 1)
  eq(calcularEsforco({ criado_em: new Date(AGORA - 179999).toISOString(), anotacoes: {} }, AGORA), 0)
  eq(calcularEsforco({ criado_em: 'lixo', anotacoes: {} }, AGORA), 0)
})
Deno.test('calcularEsforco: detalhe', () => {
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { quer: 'x'.repeat(59) } }, AGORA), 0)
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { quer: 'x'.repeat(60) } }, AGORA), 1)
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { aprof_resposta: 'Atendo mais de noite' } }, AGORA), 1)
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { aprof_resposta: 'nao_sei' } }, AGORA), 0)
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { aprof_resposta: 'Não sei' } }, AGORA), 0)
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { aprof_resposta: 'pulou' } }, AGORA), 0)
})
Deno.test('calcularEsforco: qualificação 4 de 5', () => {
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { qualif: { ...Q5, conheceu: 'pulou' } } }, AGORA), 1)
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { qualif: { ...Q5, conheceu: 'pulou', papel: 'nao_sei' } } }, AGORA), 0)
  eq(calcularEsforco({ criado_em: ha(0), anotacoes: { qualif: 'x' } }, AGORA), 0)
})

const D0 = { listaEspera: false, jaVende: 'quero_comecar', movimento: 'ate20', coerente: true, comeco: 'pesquisando', cidade: 'Sinop', consumidor: null, pontoDefinido: null, provar: null }
const dest = (o: object) => escolherDestino({ ...D0, ...o } as any).destino
Deno.test('escolherDestino: a lista_espera vence tudo', () => {
  eq(dest({ listaEspera: true, consumidor: 0.99, jaVende: 'ja_vendo', movimento: '100mais' }), 'lista_espera')
})
Deno.test('escolherDestino: b delivery (limiar 0,8)', () => {
  eq(dest({ consumidor: 0.8 }), 'delivery')
  eq(dest({ consumidor: 0.79 }), 'cadastro')
  eq(dest({ consumidor: 0.95, jaVende: 'ja_vendo', movimento: '100mais' }), 'delivery')
})
Deno.test('escolherDestino: c1 já vende com movimento alto', () => {
  eq(dest({ jaVende: 'ja_vendo', movimento: '50a100' }), 'contato_rapido')
  eq(dest({ jaVende: 'ja_vendo', movimento: '100mais', coerente: null }), 'contato_rapido')
  eq(dest({ jaVende: 'ja_vendo', movimento: '100mais', coerente: false }), 'cadastro')
  eq(dest({ jaVende: 'ja_vendo', movimento: '20a50' }), 'cadastro')
  eq(dest({ jaVende: 'quero_comecar', movimento: '100mais' }), 'cadastro')
})
Deno.test('escolherDestino: c2 ponto definido e começo próximo', () => {
  eq(dest({ pontoDefinido: 0.8, comeco: 'esta_semana' }), 'contato_rapido')
  eq(dest({ pontoDefinido: 0.8, comeco: 'este_mes' }), 'contato_rapido')
  eq(dest({ pontoDefinido: 0.8, comeco: 'pesquisando' }), 'cadastro')
  eq(dest({ pontoDefinido: 0.79, comeco: 'esta_semana' }), 'cadastro')
  eq(dest({ pontoDefinido: null, comeco: 'esta_semana' }), 'cadastro')
})
Deno.test('escolherDestino: d visita só em Cuiabá/VG', () => {
  eq(dest({ cidade: 'Cuiabá', provar: 0.6 }), 'visita')
  eq(dest({ cidade: 'varzea grande', provar: 0.9 }), 'visita')
  eq(dest({ cidade: ' CUIABA ', provar: 0.6 }), 'visita')
  eq(dest({ cidade: 'Sinop', provar: 0.99 }), 'cadastro')
  eq(dest({ cidade: 'Cuiabá', provar: 0.59 }), 'cadastro')
  eq(dest({ cidade: null, provar: 0.99 }), 'cadastro')
  eq(dest({ cidade: 'Cuiabá', provar: null }), 'cadastro')
})
Deno.test('escolherDestino: ordem c antes de d e Jev nulo conta como não', () => {
  eq(dest({ cidade: 'Cuiabá', provar: 0.9, jaVende: 'ja_vendo', movimento: '100mais' }), 'contato_rapido')
  eq(dest({ cidade: 'Cuiabá' }), 'cadastro')
  eq(escolherDestino(D0 as any).destino, 'cadastro')
})
Deno.test('validarListaEspera sem exigir cidade (contato)', () => {
  eq(vle2({ nome: 'Ana', telefone: '65992888228' }, false).ok, true)
  eq(vle2({ nome: 'Ana', telefone: '65992888228' }).ok, false)
  eq(vle2({ nome: 'A', telefone: '65992888228' }, false).ok, false)
  eq(vle2({ nome: 'Ana', telefone: '123' }, false).ok, false)
})

Deno.test('converter: telefone de profiles vira só dígitos (<= 20) ou null', () => {
  eq(normalizarTelefone('(65) 99999-8888'), '65999998888')
  eq(normalizarTelefone('+55 (65) 99999-8888'), '65999998888')
  eq(normalizarTelefone('abc'), null)
  eq(normalizarTelefone(''), null)
  eq(normalizarTelefone(null), null)
  eq(normalizarTelefone('1'.repeat(40)), null)
})
Deno.test('cortarProblema: sem corte no meio da frase', () => {
  eq(cortarProblema('Falta de definição sobre o'), 'Falta de definição')
  eq(cortarProblema('Medo de não vender o'), 'Medo de não vender')
  eq(cortarProblema('Medo de começar'), 'Medo de começar')
  eq(cortarProblema('Medo'), 'Medo')
  eq(cortarProblema('Preço'), 'Preço')
  eq(cortarProblema('Aaaaaaa de bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), '') // 51 chars: corta em "Aaaaaaa de" -> "Aaaaaaa" (7) < 8 -> ''
  eq(cortarProblema('Dificuldade em controlar o estoque do açaí congelado'), 'Dificuldade em controlar o estoque')
})
Deno.test('parseResumo: problema > 40 é falha de formato; modo não estrito corta', () => {
  const j = '{"resumo":"Você quer começar a vender açaí com pouco risco.","problema":"Dificuldade operacional administrativa financeira constante","termo":null}'
  eq(parseResumo(j), null)
  eq(parseResumo(j, false)?.problema, 'Dificuldade operacional administrativa')
  eq(parseResumo('{"resumo":"Você quer começar a vender açaí com pouco risco.","problema":"Medo de não vender o","termo":null}')?.problema, 'Medo de não vender')
  eq(parseResumo('{"resumo":"Você quer começar a vender açaí com pouco risco.","problema":"Falta do de","termo":null}', false)?.problema, 'Falta') // sem corte, palavra curta passa
  eq(parseResumo('{"resumo":"Você quer começar a vender açaí com pouco risco.","problema":"Aaaaaaa de bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","termo":null}', false)?.problema, '') // cortou e sobrou < 8
})

Deno.test('passoBloqueadoPorConsumo: consumo bloqueia revenda, libera confirma_acai', () => {
  eq(passoBloqueadoPorConsumo({ confirma_acai: 'consumo' }, 'destino'), true)
  eq(passoBloqueadoPorConsumo({ confirma_acai: 'consumo' }, 'simulacao'), true)
  eq(passoBloqueadoPorConsumo({ confirma_acai: 'consumo' }, 'confirma_acai'), false)
  eq(passoBloqueadoPorConsumo({ confirma_acai: 'sim' }, 'destino'), false)
  eq(passoBloqueadoPorConsumo({}, 'destino'), false)
  eq(passoBloqueadoPorConsumo(null, 'destino'), false)
})

Deno.test('calcularSimulacao: preço do copo aceita 17 a 22; fora disso é null', () => {
  for (const p of [17, 18, 19, 20, 21, 22]) eq(calcularSimulacao(p, 150, 'ate20')?.preco_copo, p, `[${p}]`)
  eq(calcularSimulacao(16, 150, 'ate20'), null)
  eq(calcularSimulacao(23, 150, 'ate20'), null)
})

Deno.test('FATOS_LISTA: assuntos únicos e válidos, textos de 1 a 2000 caracteres, total entre 1000 e 15000', () => {
  const vistos = new Set<string>()
  for (const f of FATOS_LISTA) {
    if (!/^[a-z_]+$/.test(f.assunto)) throw new Error('assunto inválido: ' + f.assunto)
    if (vistos.has(f.assunto)) throw new Error('assunto repetido: ' + f.assunto)
    vistos.add(f.assunto)
    if (!f.texto.trim() || f.texto.length > 2000) throw new Error('texto fora do limite: ' + f.assunto)
  }
  eq(FATOS, FATOS_LISTA.map((f) => f.texto).join('\n'))
  if (FATOS.length < 1000 || FATOS.length > 15000) throw new Error('total fora do limite: ' + FATOS.length)
})

Deno.test('FATOS_LISTA: os assuntos travados são exatamente contato_endereco e leite_gluten', () => {
  eq(FATOS_LISTA.filter((f) => f.travado).map((f) => f.assunto).sort().join(','), 'contato_endereco,leite_gluten')
})

/* ── montarFatos ── */
import { montarFatos } from './logica.ts'
const lin = (rasc?: (a: string) => string) => FATOS_LISTA.map((f, i) => ({ assunto: f.assunto, ordem: i + 1, publicado: f.texto, rascunho: rasc ? rasc(f.assunto) : f.texto }))
const textoDe = (a: string) => FATOS_LISTA.find((f) => f.assunto === a)!.texto
const livre = FATOS_LISTA.find((f) => !f.travado)!.assunto
const outro = FATOS_LISTA.filter((f) => !f.travado)[1].assunto

Deno.test('montarFatos: dev usa rascunho e prod usa publicado', () => {
  const l = lin().map((x) => x.assunto === livre ? { ...x, publicado: 'Texto publicado de teste com tamanho valido.', rascunho: 'Texto rascunho de teste com tamanho valido.' } : x)
  const d = montarFatos(l, 'dev', FATOS_LISTA), p = montarFatos(l, 'prod', FATOS_LISTA)
  eq(d.origem, 'banco'); eq(p.origem, 'banco')
  eq(d.texto.includes('Texto rascunho de teste'), true); eq(d.texto.includes('Texto publicado de teste'), false)
  eq(p.texto.includes('Texto publicado de teste'), true); eq(p.texto.includes('Texto rascunho de teste'), false)
})
Deno.test('montarFatos: assunto travado vem sempre do código', () => {
  const l = lin(() => 'Outro texto qualquer para o assunto travado aqui.').map((x) => ({ ...x, publicado: 'Outro texto qualquer para o assunto travado aqui.' }))
  const r = montarFatos(l, 'prod', FATOS_LISTA)
  for (const f of FATOS_LISTA.filter((f) => f.travado)) eq(r.texto.includes(f.texto), true)
})
Deno.test('montarFatos: assunto faltando, linhas vazias ou nulas voltam ao código', () => {
  const sem = lin().filter((x) => x.assunto !== livre)
  const a = montarFatos(sem, 'prod', FATOS_LISTA)
  eq(a.origem, 'codigo'); eq(a.texto, FATOS); eq(a.motivo, 'assunto_faltando')
  eq(montarFatos(null, 'prod', FATOS_LISTA).origem, 'codigo')
  eq(montarFatos([], 'dev', FATOS_LISTA).origem, 'codigo')
})
Deno.test('montarFatos: texto com < > e quebras é limpo', () => {
  const l = lin().map((x) => x.assunto === livre ? { ...x, publicado: 'Texto <b>com</b>\n\nmarcas   e\tquebras ok.' } : x)
  const r = montarFatos(l, 'prod', FATOS_LISTA)
  eq(r.texto.includes('Texto bcom/b marcas e quebras ok.'), true)
  eq(r.texto.includes('<b>'), false)
})
Deno.test('montarFatos: texto curto/longo ou total fora da faixa voltam ao código', () => {
  const curto = lin().map((x) => x.assunto === livre ? { ...x, publicado: 'curto' } : x)
  eq(montarFatos(curto, 'prod', FATOS_LISTA).motivo, 'tamanho_do_texto')
  const longo = lin().map((x) => x.assunto === livre ? { ...x, publicado: 'a'.repeat(2001) } : x)
  eq(montarFatos(longo, 'prod', FATOS_LISTA).motivo, 'tamanho_do_texto')
  const listaPeq = [{ assunto: 'a', texto: 'x'.repeat(100) }]
  const r = montarFatos([{ assunto: 'a', publicado: 'y'.repeat(100) }], 'prod', listaPeq)
  eq(r.origem, 'codigo'); eq(r.motivo, 'tamanho_total')
  const listaGr = Array.from({ length: 9 }, (_, i) => ({ assunto: 'a' + i, texto: 'x'.repeat(1900) }))
  eq(montarFatos(listaGr.map((f) => ({ assunto: f.assunto, publicado: 'y'.repeat(1900) })), 'prod', listaGr).motivo, 'tamanho_total')
})
Deno.test('montarFatos: telefone não liberado cai no código só naquele assunto', () => {
  const l = lin().map((x) => x.assunto === livre ? { ...x, publicado: 'Ligue para (65) 91234-5678 e fale com a gente.' } : x)
  const r = montarFatos(l, 'prod', FATOS_LISTA)
  eq(r.texto.replace(/\s+/g, ' '), FATOS.replace(/\s+/g, ' ')) // só um assunto veio do banco-candidato e voltou ao código; demais iguais ao código
  const l2 = lin().map((x) => x.assunto === livre ? { ...x, publicado: 'Ligue para (65) 91234-5678 e fale com a gente.' } : x.assunto === outro ? { ...x, publicado: 'Texto alterado de teste com tamanho valido.' } : x)
  const r2 = montarFatos(l2, 'prod', FATOS_LISTA)
  eq(r2.texto.includes('91234-5678'), false)
  eq(r2.texto.includes('Texto alterado de teste'), true)
  eq(r2.texto.replace(/\s+/g, ' ').includes(FATOS_LISTA.find((f) => f.assunto === livre)!.texto.replace(/\s+/g, ' ')), true)
  const ok = lin().map((x) => x.assunto === livre ? { ...x, publicado: 'Fale pelo (65) 9694-9542 que a loja atende.' } : x)
  eq(montarFatos(ok, 'prod', FATOS_LISTA).texto.includes('9694-9542'), true)
})
Deno.test('montarFatos: segue a ordem do código e ignora assunto fora da lista', () => {
  const l = [...lin().reverse(), { assunto: 'intruso', ordem: 0, publicado: 'Texto intruso com tamanho suficiente aqui.', rascunho: 'x' }]
  const r = montarFatos(l, 'prod', FATOS_LISTA)
  eq(r.texto.replace(/\s+/g, ' '), FATOS.replace(/\s+/g, ' ')); eq(r.texto.includes('intruso'), false)
})
Deno.test('montarFatos: texto do banco igual ao do código dá os mesmos fatos (menos quebras)', () => {
  const r = montarFatos(lin(), 'prod', FATOS_LISTA)
  eq(r.origem, 'banco')
  eq(r.texto.replace(/\s+/g, ' '), FATOS.replace(/\s+/g, ' '))
})

Deno.test('montarFatos: trocados lista só os assuntos que caíram por telefone', () => {
  const l = lin(); const alvo = FATOS_LISTA.find((f) => !f.travado)!.assunto
  const i = l.findIndex((x) => x.assunto === alvo)
  const t = 'Fale pelo 65 91234-5678 sempre que quiser, a qualquer hora do dia.'
  l[i] = { ...l[i], publicado: t, rascunho: t }
  eq(montarFatos(l, 'prod', FATOS_LISTA).trocados.join(','), alvo)
  eq(montarFatos(lin(), 'prod', FATOS_LISTA).trocados.length, 0)
  eq(montarFatos(null, 'prod', FATOS_LISTA).trocados.length, 0)
})
import { cacheAposLeitura, cacheAposFalha, FATOS_VALIDADE_BOM_MS } from './logica.ts'
Deno.test('cache fatos: leitura boa guarda última boa; anomalia apaga', () => {
  const b = cacheAposLeitura(1000, 300000, { texto: 'A', origem: 'banco' })
  eq(b.bomV, 'A'); eq(b.ttl, 300000)
  const c = cacheAposLeitura(2000, 300000, { texto: 'COD', origem: 'codigo' })
  eq(c.bomV, null); eq(c.ttl, 60000)
})
Deno.test('cache fatos: falha reusa texto bom por 60 s até 30 min da leitura boa', () => {
  const b = cacheAposLeitura(0, 300000, { texto: 'A', origem: 'banco' })
  const r = cacheAposFalha(b, 400000, 'COD')
  eq(r.usou, 'antigo'); eq(r.cache.v, 'A'); eq(r.cache.ttl, 60000); eq(r.cache.bomT, 0)
  const r2 = cacheAposFalha(r.cache, 460000, 'COD')
  eq(r2.usou, 'antigo'); eq(r2.cache.bomT, 0)
  eq(cacheAposFalha(b, FATOS_VALIDADE_BOM_MS, 'COD').usou, 'antigo')
  const vencido = cacheAposFalha(r2.cache, FATOS_VALIDADE_BOM_MS + 1, 'COD')
  eq(vencido.usou, 'codigo'); eq(vencido.cache.v, 'COD'); eq(vencido.cache.bomV, null)
})
Deno.test('cache fatos: falha sem cache bom usa o código', () => {
  eq(cacheAposFalha(undefined, 5, 'COD').usou, 'codigo')
  const cod = cacheAposLeitura(0, 60000, { texto: 'COD', origem: 'codigo' })
  eq(cacheAposFalha(cod, 10, 'COD').usou, 'codigo')
})

Deno.test('socialAbertura: cumprimento e agradecimento (mensagem inteira)', () => {
  for (const t of ['oi', 'Oi!', 'ola', 'Olá', 'oii', 'olaaa', 'opa', 'eai', 'e ai', 'e aí', 'eae', 'hey', 'hello', 'bom dia', 'Boa tarde!', 'boa noite', 'tudo bem', 'tudo bom?', 'td bem', 'beleza', 'oie', 'salve', 'fala', 'fala ai', 'fala puri', 'hi', 'tudo certo', 'bom dia pessoal', 'boa tarde gente', 'boa noite galera', 'oi bom dia', 'ola, tudo bem?', 'oi puri', '👋 oi', 'oi 😀'])
    eq(socialAbertura(t), 'cumprimento', t)
  for (const t of ['obrigado', 'obrigada!', 'obg', 'brigado', 'brigada', 'valeu', 'vlw', 'muito obrigado', 'muito obrigada', 'ok obrigado', 'valeu puri', 'valeuu', 'tmj', '🙏 obrigado'])
    eq(socialAbertura(t), 'agradecimento', t)
})

Deno.test('socialAbertura: não casa quando há mais do que social', () => {
  for (const t of ['oi, quero açaí', 'fala o preço', 'salve quero açaí', 'fala quanto custa', 'bom dia pessoal quero açaí', 'pessoal', 'gente', 'bom dia, vocês entregam?', 'obrigado, e o preço?', 'ok', 'sim', 'Maria', 'João Silva', 'puri', '', '   ', '😀', 'quero revender'])
    eq(socialAbertura(t), null, t)
})

Deno.test('saude: orientação de segurança para restrição reprova', () => {
  reprova('O açaí é sem glúten, então se for pra quem evita, o açaí é a escolha segura.', 'o açaí tem glúten?', 'saude')
  reprova('Quem tem intolerância à lactose pode ficar tranquilo com o açaí.', 'tem lactose?', 'saude')
  reprova('Pra diabético o açaí sem açúcar é a melhor opção pra quem controla.', 'tem açúcar?')
  reprova('Sem glúten, então celíaco pode consumir à vontade.', 'tem glúten?', 'saude')
  reprova('Pra quem tem alergia, o açaí é liberado.', 'tem leite?', 'saude')
  reprova('O açaí é ideal pra quem evita lactose.', 'tem lactose?', 'saude')
  reprova('Recomendo pra celíaco, é sem glúten.', 'tem glúten?', 'saude')
})

Deno.test('saude: casos novos reprovam (frases vizinhas, sinônimos) com pergunta de restrição', () => {
  for (const t of ['O açaí é a escolha segura pra quem evita glúten.', 'Pode tomar tranquilo, não tem leite.', 'Quem é celíaco pode comer.', 'É ideal pra quem é intolerante à lactose.', 'Não tem glúten. Pode ficar tranquilo.', 'Não tem leite. Pode tomar tranquilo.', 'Para intolerantes à lactose, o açaí é uma boa escolha.', 'Sem glúten, seguro pra celíaco.', 'É liberado pra diabéticos.', 'Já os cremes têm glúten, então, se for pra quem evita, o açaí é a escolha segura.', 'Para quem não pode glúten, é ideal.'])
    eq(orientaSaude(t, 'o açaí tem glúten?'), true, t)
  eq(orientaSaude('Sem açúcar, indicado pra diabéticos.', 'tem opção sem açúcar?'), true)
})

Deno.test('saude: pergunta sem restrição nunca reprova', () => {
  for (const t of ['O açaí é a escolha segura pra quem evita glúten.', 'Pode tomar tranquilo, não tem leite.', 'Quem é celíaco pode comer.', 'É ideal pra quem é intolerante à lactose.', 'Não tem glúten. Pode ficar tranquilo.', 'Para intolerantes à lactose, o açaí é uma boa escolha.', 'Sem glúten, seguro pra celíaco.', 'É liberado pra diabéticos.', 'Já os cremes têm glúten, então, se for pra quem evita, o açaí é a escolha segura.', 'Para quem não pode glúten, é ideal.', 'Sem açúcar, indicado pra diabéticos.'])
    eq(orientaSaude(t, 'quanto custa a caixa?'), false, t)
})

Deno.test('saude: afirmação fraca em outra frase e descrição do produto passam', () => {
  const c: [string, string][] = [
    ['Sem açúcar ainda não temos. A caixa de 5 L é uma boa opção pra começar.', 'tem opção sem açúcar? qual caixa vale pra começar?'],
    ['Os cremes têm glúten. A caixa de 5 L é uma boa opção pra festa.', 'tem glúten? qual caixa pra festa?'],
    ['Nosso açaí tem granola, que contém glúten. A caixa de 5 L é a melhor opção pra começar.', 'tem glúten? qual caixa pra começar?'],
    ['Não temos versão sem leite. A caixa de 5 L é uma ótima escolha pra festa.', 'tem sem leite? qual caixa pra festa?'],
    ['Não há restrição de idade para revender. O cadastro é seguro.', 'tem restrição alimentar? e pra revender?'],
    ['Não temos dieta específica. Para festa, a caixa de 5 L é a melhor opção.', 'tem opção diet? qual caixa pra festa?'],
    ['Se você evita leite ou lactose, o açaí é a opção livre de leite da Dupuro.', 'tem lactose?'],
  ]
  for (const [r, p] of c) eq(orientaSaude(r, p), false, r)
})

Deno.test('saude: casos novos passam (leite/açúcar soltos, negação, ressalva)', () => {
  for (const t of ['O creme de Ninho tem leite, recomendo provar.', 'Recomendo o creme de cupuaçu, tem leite na composição.', 'Pode comer com leite ninho por cima.', 'Pode comer com granola e leite em pó.', 'Acompanha leite condensado, recomendo.', 'Pagamento seguro pelo site.', 'Pode ficar tranquilo que o pedido chega no turno.', 'O açaí não tem glúten na composição. Já os cremes têm glúten, então vale checar o produto antes de escolher.', 'Ainda não temos opção sem açúcar. Posso te indicar um sabor?', 'Não tenho como dizer se é seguro pra celíaco; pergunte a um médico.', 'Não posso dizer que é seguro pra celíaco.'])
    passa(t, 'tem glúten?')
})

Deno.test('saude: sem tema, com negação ou ressalva passa', () => {
  passa('O açaí é sem glúten; já os cremes têm glúten.', 'o açaí tem glúten?')
  passa('O açaí é 100% livre de leite; os cremes têm leite. Sobre saúde eu não oriento, procure um médico.', 'tem leite?')
  passa('A compra é segura e o pagamento também.', 'é seguro comprar no site?')
  passa('Pode comprar sem cadastro, é rapidinho.', 'preciso de cadastro?')
  passa('Pode ficar tranquilo que o pedido chega no turno escolhido.', 'e se o pedido atrasar?')
  passa('Pode tomar com granola, que combina bem.', 'como tomar o açaí?')
  passa('Não é indicado nem recomendado pra ninguém com restrição, só a equipe confirma, procure um nutricionista.', 'tem glúten?')
})

Deno.test('saude: textos fixos e SEGURA não reprovam', () => {
  for (const t of [TXT_SAUDE, TXT_SAUDE_LEITE, TXT_SAUDE_GLUTEN, ...Object.values(SEGURA).map((s) => s.texto)]) {
    eq(checarResposta(t, 'o açaí tem glúten?', true), null, t)
  }
})

Deno.test('saude: textos de FATOS_LISTA não reprovam', () => {
  for (const x of FATOS_LISTA) eq(orientaSaude(x.texto, 'o açaí tem glúten, leite ou açúcar?'), false, x.assunto)
})
