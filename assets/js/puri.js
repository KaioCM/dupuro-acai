/* ==========================================================================
   Puri — assistente flutuante da Dupuro (Etapa 3: casca, F0/F1/F5/F6).
   IIFE autocontido, sem dependências. Injeta o próprio markup no <body>.

   CONFIG (opcional, antes do script):  window.PURI = { pagina: 'home'|'revenda'|'delivery', api: 'mock'|'edge', edgeLocal: true }
   MODO: padrão 'edge' (produção; em localhost usa a Puri de teste assistente-dev). 'mock' só com ?puri=mock (desatualizado). PURI.api ('mock'|'edge') sobrescreve tudo.
   TESTE LOCAL: em localhost/127.0.0.1/[::1] a query ?puri=edge|mock sobrescreve o modo (ignorada em produção).
   ENDPOINT: modo edge + host local → functions/v1/assistente-dev (ambiente de desenvolvimento); produção → functions/v1/assistente.
   Em localhost, ?puri=prod força o endpoint de produção (só pra testar contra a produção quando necessário; ignorado fora de localhost).
   PÁGINA: PURI.pagina, senão detectada pelo caminho (/delivery/, /revenda/), senão 'home'.

   CONTRATO DA API (fixo) — POST JSON em `${DUPURO_SUPABASE_URL}/functions/v1/assistente`
   headers: apikey: <anon>, Authorization: Bearer <anon>, Content-Type: application/json
   {acao:'iniciar', pagina}                           -> {ok:true, token} | {ok:false, motivo:'limite_dia'}
   {acao:'mensagem', token, etapa:'abertura'|'duvida', texto}
       -> {ok:true, tipo:'intencao', intencao:'revender'|'consumir'|'provar'|'duvida'|'humano'|'incerto'}
        | {ok:true, tipo:'resposta', texto} | {ok:true, tipo:'humano', texto}
        | {ok:false, motivo:'limite_conversa'|'limite_dia'|'token_invalido'|'texto_invalido'|'erro'}
   {acao:'catalogo'} (sem token) -> {ok:true, minimo:number|null, delivery:{a_partir_de, produto_id}, atacado:{caixa10:{preco,litros}|null, caixa5:...|null}} | {ok:false, motivo}
   {acao:'visita', token, cidade, bairro, dia:'seg'..'sex', periodo:'manha'|'tarde', nome, telefone}
       -> {ok:true} | {ok:false, motivo:'cidade_fora'|'dados_invalidos'|'token_invalido'|'ja_pedida'|'limite_dia'|'erro'}
   `iniciar` só é chamado na primeira mensagem livre (não ao abrir o painel).
   Privacidade F3: bairro/nome/telefone vão só para `visita` (nunca para `mensagem`); nome/telefone ficam só em memória
   e são apagados após o envio ou ao recomeçar; o balão guarda o telefone mascarado.
   Segurança: todo texto entra por textContent; nunca innerHTML com dado.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__puriCarregada) return;
  window.__puriCarregada = true;

  var MODO_PADRAO = 'edge';

  var cfg = window.PURI || {};
  var PAGINA = cfg.pagina || (/\/delivery(\/|$)/.test(location.pathname) ? 'delivery' : /\/revenda(\/|$)/.test(location.pathname) ? 'revenda' : 'home');
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // ?puri=mock: simulador local DESATUALIZADO (não cobre mapa nem limites); o padrão em localhost é 'edge' (assistente-dev).
  var QMODO = LOCAL ? (/[?&]puri=(edge|mock)(&|$)/.exec(location.search) || [])[1] : null;
  var QPROD = LOCAL && /[?&]puri=prod(&|$)/.test(location.search);
  var FUNC = (LOCAL && !QPROD) ? 'assistente-dev' : 'assistente';
  var MODO = QMODO || (QPROD ? 'edge' : null) || cfg.api || MODO_PADRAO;

  var WA_BASE = 'https://wa.me/5565992888228';
  // Rótulos do assunto do WhatsApp (F5). Nunca entra texto digitado pelo usuário.
  var ROTULOS = { revender: 'quero revender', consumir: 'comprar pra consumir', provar: 'quero provar antes', duvida: 'tirar uma dúvida', humano: 'falar com uma pessoa' };
  function waLink() {
    var r = ROTULOS[E.assunto] || ROTULOS.humano;
    return WA_BASE + '?text=' + encodeURIComponent('Oi! Vim pelo assistente do site. Assunto: ' + r + '.');
  }
  var MAX_CHARS = 500, MAX_MSGS = 60, MAX_BALOES = 150, TIMEOUT = 20000;
  var CHAVE = 'puri:v2';
  try { sessionStorage.removeItem('puri:v1'); } catch (e) {} // estado antigo (fluxo anterior da revenda): descartado, recomeço limpo
  var REDUZIDO = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Textos (fonte: ROTEIRO F0/F1/F2/F3/F5/F6 e base-de-fatos) ----
  var T = {
    abertura: 'Oi! Eu sou a Puri, assistente da Dupuro. Posso tirar uma dúvida ou te ajudar a começar.',
    pergunta: 'Pode perguntar.',
    humano: 'Tudo bem. Vou te passar pra uma pessoa.',
    incerto: 'Não entendi bem. Escolhe uma das opções.',
    incertoAb: 'Não peguei bem. Você quer revender, comprar pra você, provar ou tirar uma dúvida?',
    olaSocial: 'Oi, tudo bem? Eu sou a Puri. Me conta: você quer revender, comprar pra você, provar antes ou tirar uma dúvida?',
    limite: 'Agora é melhor seguir com uma pessoa.',
    limiteMsgs: 'Pra seguir, melhor com uma pessoa.',
    fimCampo: 'Pra seguir, fala com uma pessoa.',
    // TODO Etapa 4 (próximo lote): F4 real; `revender` é placeholder.
    consumir: function (m) { return 'Pra consumir em casa é pelo nosso delivery, com entrega em Cuiabá e Várzea Grande.' + (m ? ' Pedido mínimo de ' + m + ' em produtos.' : ''); },
    consumirPreco: function (p, m) { return 'Pra consumir em casa é pelo nosso delivery: caixas a partir de ' + p + ', com entrega em Cuiabá e Várzea Grande.' + (m ? ' Pedido mínimo de ' + m + ' em produtos.' : ''); },
    revender: 'Pra revender, você cria a conta, o time Dupuro aprova e o painel libera. Dá uma olhada em como funciona.',
    erroTemp: 'Não consegui responder agora. Tenta de novo ou fala com uma pessoa.',
    provar: 'Dá pra provar de dois jeitos. Qual você prefere?',
    fabrica: 'A fábrica fica na Av. das Torres, nº 16, Jardim Imperial II, Cuiabá-MT. Funciona de segunda a sábado, das 13h às 19h30. Quando quiser revender, é só chamar aqui.',
    visitaIntro: 'A visita é grátis, de segunda a sexta, das 8h às 17h, em Cuiabá e Várzea Grande.',
    pCidade: 'Em qual cidade você está?', pBairro: 'Qual o bairro?', pDia: 'Qual o melhor dia?', pPeriodo: 'Manhã ou tarde?',
    pNome: 'Seu nome?', pTel: 'Seu WhatsApp com DDD?',
    bairroRuim: 'Pode escrever o bairro de novo?',
    nomeRuim: 'Pode escrever seu nome de novo?',
    telRuim: 'Pode mandar o WhatsApp com DDD de novo? Ex.: (65) 99999-0000',
    foraCidade: 'Por enquanto a visita é só em Cuiabá e Várzea Grande. Você pode provar na fábrica ou, se for revender, retirar na fábrica.',
    visitaOk: 'Pronto! Nosso vendedor vai te chamar pra combinar.',
    visitaJa: 'Seu pedido de visita já está com a gente. O vendedor vai te chamar.',
    visitaDados: 'Alguma informação não passou. Vamos conferir de novo.',
    escolhe: 'Escolhe uma das opções.',
    diaUtil: 'A visita é só de segunda a sexta. Qual desses dias fica melhor?',
    perdi: 'Por segurança não guardo nome nem telefone quando a página recarrega. Qual é o seu nome?'
  };
  var ENDERECO_FABRICA = 'Av. das Torres, 16, Jardim Imperial II, Cuiabá-MT, 78076-001';
  var MAPA_FABRICA = 'https://www.google.com/maps?cid=17555207674774734721';
  var DIAS = { seg: 'segunda-feira', ter: 'terça-feira', qua: 'quarta-feira', qui: 'quinta-feira', sex: 'sexta-feira' };
  var DIA_CURTO = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex' };
  var CHIPS_FORA = [{ id: 'fabrica', t: 'Visitar a fábrica' }, { id: 'rev_retira', t: 'Revender retirando na fábrica' }, { id: 'humano', t: 'Falar com uma pessoa', href: WA_BASE, hum: true }];
  var CIDADES = { cid_cuiaba: 'Cuiabá', cid_vg: 'Várzea Grande' };
  var PASSOS = ['cidade', 'bairro', 'dia', 'periodo', 'nome', 'tel', 'confirma'];
  var CH = {
    abertura: [
      { id: 'revender', t: 'Quero revender' }, { id: 'consumir', t: 'Comprar pra consumir' },
      { id: 'provar', t: 'Quero provar antes' }, { id: 'duvida', t: 'Tirar uma dúvida' }
    ],
    humano: { id: 'humano', t: 'Falar com uma pessoa', href: WA_BASE, hum: true } // href real montado por waLink() ao desenhar
  };
  // Dúvida: sugestões iniciais e chips do contrato do servidor (id 'q' = envia o próprio texto como pergunta)
  var SUGESTOES = ['Preço das caixas', 'Como funciona a entrega?', 'Horário da loja', 'Como funciona a revenda?'];
  var CH_INTENCAO = { revender: { id: 'revender', t: 'Quero revender' }, consumir: { id: 'consumir', t: 'Comprar pra consumir' }, provar: { id: 'provar', t: 'Quero provar antes' } };
  var CH_OUTRA = { id: 'outra', t: 'Outra dúvida' }, CH_INICIO = { id: 'inicio', t: 'Voltar ao início' };
  function chipsQ(lista) { return lista.map(function (t) { return { id: 'q', t: t }; }); }
  // Chips de resposta rápida vindos do servidor: só strings curtas, até 4, sem repetir
  function chipsServidor(r) {
    var vistos = {}, out = [];
    (Array.isArray(r && r.chips) ? r.chips : []).forEach(function (t) {
      if (typeof t !== 'string') return;
      t = t.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 60 || vistos[t.toLowerCase()] || out.length >= 4) return;
      vistos[t.toLowerCase()] = 1; out.push({ id: 'q', t: t });
    });
    return out;
  }

  // ---- F4: revender (constantes) ----
  var SEG_ROT = { delivery_acai: 'delivery de açaí', acaiteria: 'açaiteria', lanchonete_bar: 'lanchonete ou bar', sorveteria: 'sorveteria', feira_evento: 'feira ou evento', mercado_varejo: 'mercado ou varejo', revenda_casa: 'revenda em casa', outro: 'outro tipo de negócio' };
  var SEG_CHIPS = [['acaiteria', 'Açaiteria'], ['lanchonete_bar', 'Lanchonete ou bar'], ['delivery_acai', 'Delivery de açaí'], ['sorveteria', 'Sorveteria'], ['feira_evento', 'Feira ou evento'], ['mercado_varejo', 'Mercado ou varejo'], ['revenda_casa', 'Revenda em casa'], ['outro', 'Outro']];
  var MOV_CHIPS = [['ate20', 'Até 20'], ['20a50', '20 a 50'], ['50a100', '50 a 100'], ['100mais', 'Mais de 100']];
  var RP = ['segmento', 'segmento_sug', 'ja_vende', 'cidade', 'cidade_outra', 'retira', 'espera_nome', 'espera_tel', 'bairro', 'objetivo', 'confirma_acai', 'movimento', 'esclarecer', 'compra', 'sim', 'comeco', 'papel', 'conheceu', 'aprof', 'palpite', 'palpite_txt', 'palpite_alt', 'resumo', 'resumo_txt', 'mapa', 'mapa_txt', 'regras', 'conta', 'destino', 'contato_nome', 'contato_tel'];
  var DESTINOS = ['contato_rapido', 'visita', 'cadastro', 'delivery', 'lista_espera']; // Etapa 3: os 5 destinos que o servidor pode devolver
  // Barra de progresso: número do passo (de 16) de cada etapa; passos pulados contam como feitos
  var TOTAL_PASSOS = 16;
  var PASSO_N = { segmento: 1, segmento_sug: 1, ja_vende: 2, cidade: 3, cidade_outra: 3, retira: 3, espera_nome: 3, espera_tel: 3, bairro: 4, objetivo: 5, confirma_acai: 5, movimento: 6, esclarecer: 6, compra: 7, sim: 8, comeco: 9, papel: 10, conheceu: 11, aprof: 12, palpite: 13, palpite_txt: 13, palpite_alt: 13, resumo: 14, resumo_txt: 14, mapa: 15, mapa_txt: 15, regras: 16, conta: 16, destino: 16, contato_nome: 16, contato_tel: 16 };
  // Perguntas de qualificação (cada resposta vai ao servidor no passo `qualif`; falha não trava o fluxo)
  var QUALIF = {
    ja_vende: { fala: 'Você já vende açaí hoje?', prox: 'cidade', opts: [['ja_vendo', 'Já vendo'], ['quero_comecar', 'Ainda não, quero começar'], ['outras_coisas', 'Vendo outras coisas']] },
    comeco: { fala: 'Quando você pensa em começar?', prox: 'papel', opts: [['esta_semana', 'Esta semana'], ['este_mes', 'Este mês'], ['pesquisando', 'Só pesquisando por enquanto']] },
    papel: { fala: 'Qual é o seu papel no negócio?', prox: 'conheceu', opts: [['dono', 'Sou o dono'], ['socio', 'Sou sócio'], ['trabalho', 'Trabalho no negócio'], ['vou_abrir', 'Ainda vou abrir']] },
    conheceu: { fala: 'Como você conheceu a Dupuro?', prox: 'aprof', opts: [['instagram', 'Instagram'], ['indicacao', 'Indicação'], ['google', 'Google'], ['compro_loja', 'Já compro na loja'], ['outro', 'Outro']] }
  };
  var COMPRA_PADRAO = [{ id: 'testar_1cx', rotulo: 'Quero testar com 1 caixa' }, { id: '30l_mais', rotulo: 'Já vou pedir 30 L ou mais' }, { id: 'nao_sei', rotulo: 'Ainda não sei' }];
  var TIPOS_MAPA = ['negocio', 'problema', 'causa', 'risco', 'destino', 'passo'];
  var TIT_MAPA = { negocio: 'Seu negócio', problema: 'O que trava', causa: 'Por que trava', risco: 'O risco', destino: 'Onde quer chegar', passo: 'Primeiro passo' };
  var PASSOS_IA = ['palpite', 'resumo', 'aprofundar', 'mapa', 'mapa_ajuste', 'perfil', 'interpretar', 'destino']; // passos com IA: a Edge pode levar até ~20 s
  var TIMEOUT_IA = 35000, TIMEOUT_MSG = 25000;
  var FALA_NAO = 'Me conta o que é, então.';
  var SIM_CHAVES = ['preco_copo', 'custo_caixa', 'copos_caixa', 'venda_caixa', 'sobra_caixa', 'copos_dia', 'caixas_semana', 'sobra_semana'];
  var PRECOS = [17, 18, 19, 20, 21, 22]; // copo de 500 ml; o servidor aceita os mesmos
  var SEG_LABEL = {}; SEG_CHIPS.forEach(function (c) { SEG_LABEL[c[0]] = c[1]; });
  function temSeg(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(SEG_ROT, k); }
  function sanSim(o) {
    if (!o || typeof o !== 'object') return null;
    var out = {};
    SIM_CHAVES.forEach(function (k) { var n = Number(o[k]); out[k] = (o[k] != null && o[k] !== '' && isFinite(n)) ? n : null; });
    return out.preco_copo == null ? null : out;
  }

  // ---- Ícones inline ----
  var SVGNS = 'http://www.w3.org/2000/svg';
  function icone(d) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); s.appendChild(p); return s;
  }
  var I_CHAT = 'M4 5h16v11H9l-5 4z', I_X = 'M6 6l12 12M18 6L6 18', I_ENV = 'M4 12l16-8-6 16-3-7z', I_REC = 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', I_VISTO = 'M2 13l4 4 8-10M10 16l2 1.5L22 7';

  // ---- Estado ----
  function novoEstado() { return { msgs: [], chips: [], token: null, n: 0, etapa: 'abertura', assunto: null, v: null, r: null }; }
  var cc = null; // F4 passo 11 (conta): nome/telefone/e-mail/senha SÓ em memória; a senha só vai ao /auth/v1/signup (nunca a balão, E, sessionStorage, console ou à Edge da Puri)
  var campoS; // input da senha (o textarea não tem type=password)
  var vNome = '', vTel = ''; // só em memória: nunca vão ao sessionStorage (o balão do nome guarda "(nome informado)"; o resumo guarda "você" no lugar do nome)
  var T_PERDI_ESP = 'Perdi seus dados, me diz de novo seu nome.';
  var E = novoEstado();
  var aberto = false, ocupado = false, travado = null;
  var ger = 0; // geração da conversa: respostas de geração antiga (após Recomeçar) são descartadas
  var ETAPAS = ['abertura', 'duvida', 'fim'], IDS_CHIP = ['revender', 'consumir', 'provar', 'duvida', 'outra', 'inicio', 'q', 'humano', 'retry',
    'fabrica', 'vendedor', 'rev_retira', 'v_voltar', 'v_pular', 'como_entrega', 'cid_cuiaba', 'cid_vg', 'cid_outra', 'dia_seg', 'dia_ter', 'dia_qua', 'dia_qui', 'dia_sex', 'per_manha', 'per_tarde', 'confirmar', 'corrigir'];
  var ETIQ = { aprof: 'Uma pergunta para entendermos melhor', esc: 'Só mais um detalhe', palp: 'Será que é isso?', esp: 'O especialista' }; // etiquetas dentro do balão (id guardado em E.msgs[].et)
  var QR_CAMPOS = ['compra', 'comeco', 'papel', 'conheceu']; // definido antes de normalizar() rodar (leitura do sessionStorage)
  function temEt(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(ETIQ, k); }
  var HREF_OK = /^(https:\/\/wa\.me\/|\/(?![\/\\\t\r\n])|\.\.?\/|#)/;
  // O sessionStorage é dado externo: normaliza tudo antes de usar.
  function normalizar(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.msgs)) return null;
    var r = novoEstado();
    r.n = Math.max(0, +s.n || 0);
    r.etapa = ETAPAS.indexOf(s.etapa) >= 0 ? s.etapa : 'abertura';
    r.token = typeof s.token === 'string' ? s.token : null;
    r.assunto = typeof s.assunto === 'string' && ROTULOS[s.assunto] ? s.assunto : null;
    s.msgs.forEach(function (m) {
      if (m && (m.de === 'u' || m.de === 'p') && typeof m.t === 'string') { var nm = { de: m.de, t: m.t.slice(0, 2000) }; if (m.de === 'p' && temEt(m.et)) nm.et = m.et; r.msgs.push(nm); }
    });
    r.msgs = r.msgs.slice(-MAX_BALOES);
    var semChips = false;
    if (s.v && typeof s.v === 'object' && PASSOS.indexOf(s.v.passo) >= 0) {
      var v = { passo: s.v.passo };
      v.cidade = Object.keys(CIDADES).map(function (k) { return CIDADES[k]; }).indexOf(s.v.cidade) >= 0 ? s.v.cidade : null;
      v.bairro = typeof s.v.bairro === 'string' ? s.v.bairro.slice(0, 80) : null;
      v.dia = DIAS[s.v.dia] ? s.v.dia : null;
      v.periodo = s.v.periodo === 'manha' || s.v.periodo === 'tarde' ? s.v.periodo : null;
      r.v = v;
      if (v.passo === 'tel' || v.passo === 'confirma') { // nome/telefone não sobrevivem ao recarregar
        v.passo = 'nome'; semChips = true;
        r.msgs.push({ de: 'p', t: T.perdi });
      }
    }
    (Array.isArray(s.chips) ? s.chips : []).forEach(function (c) {
      if (!c || typeof c !== 'object' || typeof c.t !== 'string' || !c.t || c.t.length > 80) return;
      if (c.href != null) {
        if (typeof c.href !== 'string' || !(HREF_OK.test(c.href) || c.href === MAPA_FABRICA)) return; // href suspeito: descarta o chip
        r.chips.push({ id: String(c.id || 'l').slice(0, 20), t: c.t, href: c.href, hum: c.hum === true });
      } else if (IDS_CHIP.indexOf(c.id) >= 0 || (typeof c.id === 'string' && /^r_[a-z0-9_]{1,30}$/.test(c.id))) {
        r.chips.push({ id: c.id, t: c.t });
      }
    });
    if (s.r && typeof s.r === 'object' && RP.indexOf(s.r.passo) >= 0) { // F4: só dados de baixa sensibilidade (nunca nome/telefone)
      var q = s.r;
      r.r = {
        passo: q.passo, segmento: temSeg(q.segmento) ? q.segmento : null,
        cidade: typeof q.cidade === 'string' ? q.cidade.slice(0, 60) : null, bairro: typeof q.bairro === 'string' ? q.bairro.slice(0, 60) : null,
        movimento: MOV_CHIPS.some(function (m) { return m[0] === q.movimento; }) ? q.movimento : null,
        preco: PRECOS.indexOf(+q.preco) >= 0 ? +q.preco : null, sim: sanSim(q.sim), escN: Math.min(4, Math.max(0, +q.escN || 0)),
        apOk: q.apOk === true, palOk: q.palOk === true, palV: q.palV === 'parte' ? 'parte' : null,
        alt: (Array.isArray(q.alt) ? q.alt : []).map(function (t) { return sanTxt(t, 160); }).filter(Boolean).slice(0, 3),
        termo: sanTxt(q.termo, 40) || null, resC: q.resC ? 1 : 0,
        resumo: sanTxt(q.resumo, 300) || null, problema: cortarPilula(q.problema, 40) || null, resI: Math.min(MAX_BALOES, Math.max(0, Math.floor(+q.resI) || 0)),
        cenaI: typeof q.cenaI === 'number' && isFinite(q.cenaI) ? Math.min(MAX_BALOES, Math.max(0, Math.floor(q.cenaI))) : null,
        pixI: typeof q.pixI === 'number' && isFinite(q.pixI) ? Math.min(MAX_BALOES, Math.max(0, Math.floor(q.pixI))) : null,
        mapas: (Array.isArray(q.mapas) ? q.mapas : []).slice(-3).map(function (x) {
          var m = x && typeof x === 'object' ? sanMapa(x.m) : null;
          return m && typeof x.i === 'number' && isFinite(x.i) ? { i: Math.min(MAX_BALOES, Math.max(0, Math.floor(x.i))), m: m } : null;
        }).filter(Boolean),
        mapaAj: Math.min(2, Math.max(0, Math.floor(+q.mapaAj) || 0)), mapaOk: q.mapaOk === true, mapaPulou: q.mapaPulou === true,
        retira: q.retira === true,
        jaVende: QUALIF.ja_vende.opts.some(function (o) { return o[0] === q.jaVende; }) ? q.jaVende : null,
        destino: DESTINOS.indexOf(q.destino) >= 0 ? q.destino : null, visitaPre: sanVisitaPre(q.visitaPre),
        cena: sanCena(q.cena), anot: sanTxt(q.anot, 300) || null,
        compraOp: sanOpcoes(q.compraOp), compraExp: sanTxt(q.compraExp, 200) || null,
        tipoPerg: q.tipoPerg === true, qr: sanQr(q.qr)
      };
      if (r.r.passo === 'espera_tel') { // nome/telefone da lista de espera não sobrevivem ao recarregar
        r.r.passo = 'espera_nome'; semChips = true;
        r.msgs.push({ de: 'p', t: T_PERDI_ESP });
      }
      if (r.r.passo === 'contato_tel') { // idem para o "Só quero que me chamem"
        r.r.passo = 'contato_nome'; semChips = true;
        r.msgs.push({ de: 'p', t: T_PERDI_ESP });
      }
      if (q.ap && typeof q.ap === 'object' && sanTxt(q.ap.p, 200)) r.r.ap = { p: sanTxt(q.ap.p, 200), rs: (Array.isArray(q.ap.rs) ? q.ap.rs : []).map(function (x) { return sanTxt(x, 60); }).filter(Boolean).slice(0, 4) };
    }
    if (semChips) r.chips = [CH.humano];
    return r;
  }
  try { var salvo = normalizar(JSON.parse(sessionStorage.getItem(CHAVE) || 'null')); if (salvo) E = salvo; } catch (e) {}
  function salvar() { try { sessionStorage.setItem(CHAVE, JSON.stringify(E)); } catch (e) {} atualizarCaso(); atualizarProgresso(); }

  // ---- Adaptador de API ----
  var api = MODO === 'edge' ? apiEdge() : apiMock();

  // Cadastro direto no Supabase Auth (confirmação de e-mail desligada: devolve a sessão na hora). A senha só trafega aqui.
  function signupReal(d) {
    var base = window.DUPURO_SUPABASE_URL, k = window.DUPURO_SUPABASE_ANON_KEY;
    if (!base || !k) return Promise.resolve({ r: 'erro' });
    var ctl = ('AbortController' in window) ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT + 5000);
    return fetch(base + '/auth/v1/signup', {
      method: 'POST', signal: ctl ? ctl.signal : undefined,
      headers: { 'apikey': k, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: d.email, password: d.senha, data: d.data })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        j = j && typeof j === 'object' ? j : {};
        if (res.status >= 200 && res.status < 300) return j.access_token ? { r: 'ok', access_token: j.access_token } : { r: 'erro' };
        if (res.status >= 500 || res.status === 429) return { r: 'erro' };
        var txt = [j.msg, j.error_description, j.message, j.error_code, j.error].join(' ').toLowerCase();
        if (/already|registered|exists/.test(txt)) return { r: 'existe' };
        if (/password|weak|senha/.test(txt)) return { r: 'senha' };
        return { r: 'erro' };
      });
    }).catch(function () { return { r: 'erro' }; }).then(function (x) { clearTimeout(t); return x; });
  }

  function apiEdge() {
    function post(corpo, tmo) {
      var lim = tmo || TIMEOUT; // tmo opcional: passos com IA esperam mais
      var base = window.DUPURO_SUPABASE_URL, k = window.DUPURO_SUPABASE_ANON_KEY;
      if (!base || !k) return Promise.resolve({ ok: false, motivo: 'erro' });
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); }, lim), t2;
      return Promise.race([
        fetch(base + '/functions/v1/' + FUNC, {
          method: 'POST', signal: ctl ? ctl.signal : undefined,
          headers: { 'apikey': k, 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo)
        }).then(function (r) { return r.json(); }),
        new Promise(function (res) { t2 = setTimeout(function () { res({ ok: false, motivo: 'erro' }); }, lim + 200); })
      ]).catch(function () { return { ok: false, motivo: 'erro' }; })
        .then(function (j) { clearTimeout(t); clearTimeout(t2); return j && typeof j === 'object' ? j : { ok: false, motivo: 'erro' }; });
    }
    return {
      iniciar: function (pagina) { return post({ acao: 'iniciar', pagina: pagina }); },
      mensagem: function (token, etapa, texto) { return post({ acao: 'mensagem', token: token, etapa: etapa, texto: texto }, TIMEOUT_MSG); }, // o servidor corta a dúvida em 15 s
      catalogo: function () { return post({ acao: 'catalogo' }); },
      visita: function (token, d) {
        return post({ acao: 'visita', token: token, cidade: d.cidade, bairro: d.bairro, dia: d.dia, periodo: d.periodo, nome: d.nome, telefone: d.telefone });
      },
      converter: function (token, at) { return post({ acao: 'converter', token: token, access_token: at }); },
      signup: signupReal,
      revenda: function (token, d) {
        var b = { acao: 'revenda', token: token };
        Object.keys(d).forEach(function (k) { b[k] = d[k]; });
        return post(b, (PASSOS_IA.indexOf(d.passo) >= 0 || (d.passo === 'escutar' && d.final)) ? TIMEOUT_IA : undefined);
      }
    };
  }

  function apiMock() {
    function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    function atraso(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, REDUZIDO ? 0 : 600); }); }
    function intencao(t) {
      if (/pessoa|alguem|atendente|humano|falar com|whatsapp|zap|vendedor/.test(t)) return 'humano';
      if (/revend|vender|atacado|parceir/.test(t)) return 'revender';
      if (/provar|amostra|testar|experimentar|conhecer/.test(t)) return 'provar';
      if (/consumir|comprar|pedir|delivery|pra mim|em casa/.test(t)) return 'consumir';
      if (/\?|horario|entrega|endereco|onde|quanto|como|qual|preco|pagamento|duvida|pergunta/.test(t)) return 'duvida';
      return 'incerto';
    }
    var visitasMock = 0, movMock = 'ate20', COPOS_MOCK = { ate20: 10, '20a50': 35, '50a100': 75, '100mais': 120 };
    return {
      iniciar: function () { return atraso({ ok: true, token: 'mock-' + Date.now().toString(36) }); },
      catalogo: function () { return atraso({ ok: true, minimo: 20, delivery: { a_partir_de: 25, produto_id: 21 }, atacado: { caixa10: { preco: 145, litros: 10 }, caixa5: null } }); },
      visita: function (token, d) {
        var tel = String(d.telefone || '').replace(/\D/g, ''), c = norm(String(d.cidade || ''));
        if (!d.nome || !DIAS[d.dia] || (d.periodo !== 'manha' && d.periodo !== 'tarde') || tel.length < 10 || tel.length > 11) return atraso({ ok: false, motivo: 'dados_invalidos' });
        if (c !== 'cuiaba' && c !== 'varzea grande') return atraso({ ok: false, motivo: 'cidade_fora' });
        if (visitasMock > 0) return atraso({ ok: false, motivo: 'ja_pedida' });
        visitasMock++;
        return atraso({ ok: true });
      },
      revenda: function (token, c) {
        if (c.passo === 'segmento') {
          var ts = norm(String(c.texto || '')), s = 'outro';
          if (/delivery|ifood|entrega/.test(ts)) s = 'delivery_acai';
          else if (/acaiteria|acai/.test(ts)) s = 'acaiteria';
          else if (/lanchonete|bar|restaurante|padaria/.test(ts)) s = 'lanchonete_bar';
          else if (/sorvet/.test(ts)) s = 'sorveteria';
          else if (/feira|evento|festa/.test(ts)) s = 'feira_evento';
          else if (/mercado|varejo|mercearia|loja/.test(ts)) s = 'mercado_varejo';
          else if (/casa|vizinh|renda/.test(ts)) s = 'revenda_casa';
          return atraso({ ok: true, segmento: s });
        }
        if (c.passo === 'perfil') {
          if (!c.cidade || !Object.prototype.hasOwnProperty.call(COPOS_MOCK, c.movimento)) return atraso({ ok: false, motivo: 'dados_invalidos' });
          movMock = c.movimento;
          var nc = norm(String(c.cidade)).trim();
          return atraso({ ok: true, fora_area: !(/cuiab|varzea/.test(nc) || nc === 'vg'), coerente: null });
        }
        if (c.passo === 'escutar') return atraso({ ok: true, anotacoes: String(c.texto || '').length >= 15 ? ['Quer revender açaí', 'Quer saber de preço no atacado'] : null });
        if (c.passo === 'simulacao') {
          var p = Number(c.preco_copo);
          if (PRECOS.indexOf(p) < 0) return atraso({ ok: false, motivo: 'dados_invalidos' });
          var cd = COPOS_MOCK[movMock], cx = Math.floor(cd * 6 / 20), venda = p * 20, sobra = venda - 145;
          return atraso({ ok: true, simulacao: { preco_copo: p, custo_caixa: 145, copos_caixa: 20, venda_caixa: venda, sobra_caixa: sobra, copos_dia: cd, caixas_semana: cx, sobra_semana: Math.round(cx * sobra * 100) / 100 } });
        }
        if (c.passo === 'aprofundar') return atraso({ ok: true, pergunta: 'Hoje, o que mais te trava pra vender açaí?', respostas: ['Não sei quanto pedir', 'Não tenho freezer', 'Não sei o preço certo'] });
        if (c.passo === 'aprofundar_resp') return atraso({ ok: true });
        if (c.passo === 'palpite') return atraso({ ok: true, palpite: 'Meu palpite: o que te segura é não saber quanto vai sair por semana. Acertei?' });
        if (c.passo === 'palpite_resp') return atraso(c.valor === 'mosca' || c.valor === 'parte' || c.valor === 'nao' ? { ok: true } : { ok: false, motivo: 'dados_invalidos' });
        if (c.passo === 'resumo') return atraso({ ok: true, resumo: 'Você quer vender açaí no copo e precisa de segurança no volume do pedido.', problema: 'Volume do pedido' });
        return atraso({ ok: false, motivo: 'dados_invalidos' });
      },
      signup: function (d) {
        if (/falha/.test(norm(String(d.email)))) return atraso({ r: 'erro' });
        if (/existe/.test(norm(String(d.email)))) return atraso({ r: 'existe' });
        if (String(d.senha).length < 6 || d.senha === '123') return atraso({ r: 'senha' });
        return atraso({ r: 'ok', access_token: 'mock-access-token' });
      },
      converter: function () { return atraso({ ok: true }); },
      mensagem: function (token, etapa, texto) {
        var t = norm(texto);
        if (/wikipedia/.test(t)) return atraso({ ok: true, tipo: 'resposta', texto: 'Isso foge do que eu sei: sou a assistente da Dupuro Açaí. Posso te ajudar com açaí, revenda ou entrega.', fora: true });
        if (etapa === 'abertura' && /^(oi+|ola+|opa|eae|eai|e ai|hey|bom dia|boa tarde|boa noite|tudo bem|tudo bom|beleza)$/.test(t.replace(/[^a-z ]/g, '').trim())) return atraso({ ok: true, tipo: 'intencao', intencao: 'social', texto: T.olaSocial });
        if (etapa === 'abertura' && /^(obrigad[oa]|obg|valeu|vlw|brigad[oa])$/.test(t.replace(/[^a-z ]/g, '').trim())) return atraso({ ok: true, tipo: 'intencao', intencao: 'social', texto: 'Por nada! Se precisar de mais alguma coisa, é só falar.' });
        if (etapa === 'abertura') return atraso({ ok: true, tipo: 'intencao', intencao: intencao(t) });
        if (/horario|hora|abre|fecha|funciona/.test(t)) return atraso({ ok: true, tipo: 'resposta', texto: 'Funcionamos de segunda a sábado, das 13h às 19h30.' });
        if (/entrega|entregam|frete|delivery/.test(t)) return atraso({ ok: true, tipo: 'resposta', texto: 'Entregamos em Cuiabá e Várzea Grande, até 30 km. A taxa aparece antes de você pagar.' });
        if (/endereco|onde fica|localiza|fabrica/.test(t)) return atraso({ ok: true, tipo: 'resposta', texto: 'Estamos na Av. das Torres, nº 16, Jardim Imperial II, Cuiabá-MT.' });
        return atraso({ ok: true, tipo: 'humano', texto: 'Essa eu prefiro passar pra uma pessoa da equipe.' });
      }
    };
  }

  // ---- DOM ----
  var btn, painel, msgs, form, campo, env, topoHum, notasBox, corpo, col, casoAside, casoAba, casoRows = {};
  var casoPronto = false, casoAberto = false, casoTimer = 0, ultimaNota = ''; // "Seu caso": ultimaNota só em memória
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  var subTit = null, T_SUB = 'Assistente da Dupuro', T_SUB_R = 'Vamos achar o melhor caminho pra você';
  function montar() {
    btn = el('button', 'puri-btn');
    btn.type = 'button'; btn.id = 'puriBtn';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'puriPainel');
    btn.setAttribute('aria-label', 'Fala com a Puri');
    btn.appendChild(icone(I_CHAT)); btn.appendChild(el('span', 'puri-rot', 'Fala com a Puri'));
    btn.lastChild.className = 'puri-rot';

    painel = el('div', 'puri-painel');
    painel.id = 'puriPainel'; painel.setAttribute('role', 'dialog'); painel.setAttribute('aria-labelledby', 'puriTit');
    painel.inert = true; painel.tabIndex = -1;

    var topo = el('div', 'puri-topo'), l1 = el('div', 'puri-topo-l1'), tit = el('div', 'puri-tit');
    var h = el('strong', null, 'Puri'); h.id = 'puriTit';
    var orb = el('i', 'puri-orb'); orb.setAttribute('aria-hidden', 'true'); h.appendChild(orb);
    subTit = el('span', null, T_SUB); tit.appendChild(h); tit.appendChild(subTit);
    var rec = el('button', 'puri-ib'); rec.type = 'button'; rec.setAttribute('aria-label', 'Recomeçar a conversa'); rec.title = 'Recomeçar'; rec.appendChild(icone(I_REC));
    var fec = el('button', 'puri-ib'); fec.type = 'button'; fec.setAttribute('aria-label', 'Fechar'); fec.appendChild(icone(I_X));
    l1.appendChild(tit); l1.appendChild(rec); l1.appendChild(fec);
    topoHum = el('a', 'puri-humano-topo', 'Falar com uma pessoa');
    topoHum.href = waLink(); topoHum.target = '_blank'; topoHum.rel = 'noopener';
    topo.appendChild(l1); topo.appendChild(topoHum);

    msgs = el('div', 'puri-msgs'); msgs.setAttribute('aria-live', 'polite'); msgs.setAttribute('role', 'log');

    form = el('form', 'puri-form'); form.setAttribute('autocomplete', 'off');
    campo = el('textarea'); campo.rows = 1; campo.maxLength = MAX_CHARS; campo.placeholder = 'Escreva aqui'; campo.setAttribute('aria-label', 'Sua mensagem');
    env = el('button', 'puri-env'); env.type = 'submit'; env.setAttribute('aria-label', 'Enviar'); env.appendChild(icone(I_ENV));
    campoS = el('input'); campoS.type = 'text'; campoS.hidden = true; campoS.maxLength = 72; campoS.setAttribute('autocomplete', 'off'); campoS.setAttribute('aria-label', 'Sua senha');
    form.appendChild(campo); form.appendChild(campoS); form.appendChild(env);

    notasBox = el('div', 'puri-notas'); notasBox.hidden = true;
    // "Seu caso" (resumo ao vivo da revenda): coluna à direita no desktop, aba recolhível no mobile
    corpo = el('div', 'puri-corpo'); col = el('div', 'puri-col');
    casoAba = el('button', 'puri-caso-aba'); casoAba.type = 'button'; casoAba.hidden = true;
    casoAba.setAttribute('aria-expanded', 'false'); casoAba.setAttribute('aria-controls', 'puriCaso');
    casoAside = el('aside', 'puri-caso'); casoAside.id = 'puriCaso'; casoAside.setAttribute('aria-label', 'Seu caso'); casoAside.hidden = true;
    casoAside.appendChild(el('h2', 'puri-caso-t', 'Seu caso'));
    var dl = el('dl', 'puri-caso-l');
    CASO_CAMPOS.forEach(function (c) {
      var box = el('div', 'puri-caso-i'), dd = el('dd', null, '—');
      box.appendChild(el('dt', null, c[1])); box.appendChild(dd); dl.appendChild(box); casoRows[c[0]] = { box: box, dd: dd };
    });
    casoAside.appendChild(dl);
    casoAba.addEventListener('click', function () { casoAberto = !casoAberto; atualizarCaso(); });
    progBox = el('div', 'puri-prog'); progBox.hidden = true; progBox.setAttribute('role', 'progressbar'); progBox.setAttribute('aria-label', 'Progresso da conversa');
    progBox.setAttribute('aria-valuemin', '1'); progBox.setAttribute('aria-valuemax', String(TOTAL_PASSOS));
    progTxt = el('span', 'puri-prog-t'); var progTri = el('div', 'puri-prog-trilho'); progFill = el('i', 'puri-prog-fill'); progTri.appendChild(progFill);
    progBox.appendChild(progTxt); progBox.appendChild(progTri);
    col.appendChild(progBox); col.appendChild(casoAba); col.appendChild(casoAside); col.appendChild(msgs); col.appendChild(notasBox); col.appendChild(form);
    corpo.appendChild(col);
    painel.appendChild(topo); painel.appendChild(corpo);
    document.body.appendChild(btn); document.body.appendChild(painel);

    btn.addEventListener('click', function () { aberto ? fechar() : abrir(); });
    fec.addEventListener('click', fechar);
    rec.addEventListener('click', recomecar);
    topoHum.addEventListener('click', function () { topoHum.href = waLink(); });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); enviar(); });
    campo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); enviar(); }
    });
    campoS.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); enviar(); }
    });
    campo.addEventListener('input', function () {
      campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight, 96) + 'px'; agendarEscuta();
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && aberto) fechar(); });
    document.addEventListener('visibilitychange', function () { painel.classList.toggle('puri-oculta', document.hidden); }); // brilho/orb param com a aba oculta
    window.addEventListener('resize', function () { if (aberto) travarScroll(); ajustarBotao(); clearTimeout(casoTimer); casoTimer = setTimeout(atualizarCaso, 150); });
  }

  // Clique/Enter com a Puri ocupada: "Um instante…" breve (uma vez por ocupação), lido pelo leitor de tela (role=status)
  var avisouOcup = false, ajVoo = false, statusEl = null, statusT = 0;
  function avisarOcupado() {
    if (avisouOcup || !painel) return;
    avisouOcup = true;
    if (!statusEl) { statusEl = el('div', 'puri-status'); statusEl.setAttribute('role', 'status'); form.parentNode.insertBefore(statusEl, form); }
    statusEl.textContent = 'Um instante…';
    clearTimeout(statusT); statusT = setTimeout(function () { statusEl.textContent = ''; }, 1600);
  }
  // Campo/enviar: desligados depois do F6 (etapa 'fim') e enquanto a Puri processa.
  function atualizarCampo() {
    var fim = E.etapa === 'fim';
    campo.disabled = fim;
    campo.maxLength = (E.r && (E.r.passo === 'aprof' || E.r.passo === 'palpite_txt' || E.r.passo === 'resumo_txt')) ? 300 : (E.r && E.r.passo === 'mapa_txt') ? 200 : MAX_CHARS; // a Edge aceita 300 nesses passos
    env.disabled = fim || ocupado;
    if (painel) painel.setAttribute('aria-busy', ocupado ? 'true' : 'false');
    if (!ocupado) avisouOcup = false;
    campo.placeholder = fim ? T.fimCampo : (E.r && E.r.passo === 'objetivo' ? 'Ex.: quantos clientes por dia, onde fica o ponto…' : 'Escreva aqui');
  }
  // ---- "Seu caso": resumo ao vivo da conversa de revenda (tudo por textContent) ----
  var CASO_CAMPOS = [['negocio', 'Negócio'], ['cidade', 'Cidade'], ['quer', 'O que quer'], ['mov', 'Movimento'], ['compra', 'Compra'], ['sim', 'Simulação'], ['comeco', 'Começo'], ['papel', 'Papel'], ['conheceu', 'Como chegou'], ['etapa', 'Etapa']];
  var MOV_ROT = { ate20: 'até 20 copos/dia', '20a50': '20 a 50 copos/dia', '50a100': '50 a 100 copos/dia', '100mais': '100 ou mais copos/dia' };
  var CASO_ETAPA = { segmento: 'Seu negócio', cidade: 'Onde fica', cidade_outra: 'Onde fica', bairro: 'Onde fica', objetivo: 'O que você quer', movimento: 'Movimento', sim: 'Simulação', aprof: 'Entender melhor', palpite: 'Entender melhor', palpite_txt: 'Entender melhor', palpite_alt: 'Entender melhor', resumo: 'Resumo', resumo_txt: 'Resumo', mapa: 'Mapa do caso', mapa_txt: 'Mapa do caso', regras: 'Regras', conta: 'Conta', destino: 'Concluído', contato_nome: 'Contato', contato_tel: 'Contato' };
  function casoAtivo() { return !!(E.r && RP.indexOf(E.r.passo) >= 0); }
  function casoLargo() { return window.innerWidth >= 900 && !(window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  function casoValores() {
    var r = E.r, v = {};
    v.negocio = (r.segmento && SEG_LABEL[r.segmento]) || '';
    v.cidade = [r.cidade, r.bairro].filter(Boolean).join(' · ');
    v.quer = r.problema || ultimaNota || '';
    v.mov = (r.movimento && MOV_ROT[r.movimento]) || '';
    v.sim = (r.sim && r.sim.sobra_semana != null && isFinite(r.sim.sobra_semana)) ? 'Sobra ≈ ' + fmtR(r.sim.sobra_semana) + ' por semana' : '';
    var qr = r.qr || {};
    v.compra = qr.compra || ''; v.comeco = qr.comeco || ''; v.papel = qr.papel || ''; v.conheceu = qr.conheceu || '';
    v.etapa = CASO_ETAPA[r.passo] || '';
    return v;
  }
  var progBox, progTxt, progFill;
  function atualizarProgresso() { // "Passo N de 16": só na revenda; tudo por textContent
    if (!progBox) return;
    var n = E.r ? PASSO_N[E.r.passo] : 0;
    if (!n) { progBox.hidden = true; return; }
    var falta = TOTAL_PASSOS - n, t = 'Passo ' + n + ' de ' + TOTAL_PASSOS + (falta > 0 ? ' · faltam ~' + falta : (emFinal() ? ' · concluído' : ' · último passo'));
    progBox.hidden = false; progTxt.textContent = t;
    progBox.setAttribute('aria-valuenow', String(n)); progBox.setAttribute('aria-valuetext', t);
    progFill.style.width = Math.round(n * 100 / TOTAL_PASSOS) + '%';
  }
  function atualizarCaso() {
    if (!painel || !casoAside) return;
    var ativo = casoAtivo(), largo = casoLargo();
    if (subTit) subTit.textContent = ativo ? T_SUB_R : T_SUB;
    if (largo ? casoAside.parentNode !== corpo : casoAside.parentNode !== col) { if (largo) corpo.appendChild(casoAside); else col.insertBefore(casoAside, msgs); }
    painel.classList.toggle('puri-largo', ativo && largo);
    var abaFocada = document.activeElement === casoAba;
    casoAba.hidden = !ativo || largo;
    if (abaFocada && casoAba.hidden) { var alvo = (campo && !campo.disabled && campo.offsetParent !== null) ? campo : painel; if (alvo === painel && !painel.hasAttribute('tabindex')) painel.setAttribute('tabindex', '-1'); alvo.focus(); }
    if (!ativo) { casoPronto = false; casoAberto = false; ultimaNota = ''; casoAside.hidden = true; casoAba.setAttribute('aria-expanded', 'false'); return; }
    casoAside.hidden = !largo && !casoAberto;
    casoAba.setAttribute('aria-expanded', casoAberto ? 'true' : 'false');
    var v = casoValores(), n = 0;
    var chaves = CASO_CAMPOS.filter(function (c) { return c[0] !== 'etapa'; });
    chaves.forEach(function (c) { if (v[c[0]]) n++; });
    casoAba.textContent = 'Seu caso · ' + n + ' de ' + chaves.length;
    CASO_CAMPOS.forEach(function (c) {
      var row = casoRows[c[0]], txt = v[c[0]] || '—';
      if (row.dd.textContent === txt) return;
      row.dd.textContent = txt;
      if (casoPronto && !REDUZIDO) {
        row.box.classList.remove('puri-mudou'); void row.box.offsetWidth; row.box.classList.add('puri-mudou');
        clearTimeout(row.t); row.t = setTimeout(function () { row.box.classList.remove('puri-mudou'); }, 650);
      }
    });
    casoPronto = true;
  }
  function movel() { return window.innerWidth < 640 || (window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  // Desktop: foca o campo. Celular: foca o painel (não abre o teclado).
  function focarEntrada() {
    if (movel() || campo.disabled) painel.focus({ preventScroll: true }); else (campoS && !campoS.hidden ? campoS : campo).focus();
  }

  // ---- Abrir / fechar ----
  function travarScroll() {
    var mobile = window.innerWidth < 640;
    if (mobile && travado === null) { travado = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    else if (!mobile && travado !== null) { document.body.style.overflow = travado; travado = null; }
  }
  function destravar() { if (travado !== null) { document.body.style.overflow = travado; travado = null; } }

  function abrir() {
    aberto = true;
    painel.inert = false; painel.classList.add('on'); btn.classList.add('puri-btn-aberto');
    btn.setAttribute('aria-expanded', 'true');
    travarScroll();
    if (!E.msgs.length) comecar();
    else rolar(true);
    setTimeout(focarEntrada, REDUZIDO ? 0 : 30);
  }
  function fechar() {
    aberto = false;
    if (cc) { limparConta(); campoS.value = ''; }
    painel.classList.remove('on'); painel.inert = true; btn.classList.remove('puri-btn-aberto');
    btn.setAttribute('aria-expanded', 'false');
    destravar();
    void btn.offsetWidth; // força o recálculo para o botão ficar focável
    btn.focus();
    ajustarBotao();
  }

  // ---- Render ----
  function rolar(seco) {
    var fim = msgs.scrollHeight; antigos();
    if (seco || REDUZIDO) msgs.scrollTop = fim; else msgs.scrollTo({ top: fim, behavior: 'smooth' });
  }
  function baloes() { return msgs.querySelectorAll('.puri-b'); }
  function addBalao(de, texto, animar, et) {
    var b = el('div', 'puri-b ' + de);
    if (de === 'p' && temEt(et)) b.appendChild(el('span', 'puri-et', ETIQ[et])); // etiqueta dentro do balão, antes do texto
    b.appendChild(document.createTextNode(texto));
    if (de === 'u') { var vt = el('span', 'puri-vt'); vt.setAttribute('aria-hidden', 'true'); vt.appendChild(icone(I_VISTO)); b.appendChild(vt); } // "enviado" até a Puri responder
    if (animar === false) b.style.animation = 'none';
    msgs.appendChild(b);
    return b;
  }
  function marcarVisto() { var l = msgs.querySelectorAll('.puri-vt:not(.visto)'); for (var i = 0; i < l.length; i++) l[i].classList.add('visto'); }
  var chipGen = 0; // invalida opções agendadas (atraso de 0,3 s) quando algo novo é dito, digitado ou clicado
  function limparChips() { chipGen++; var c = msgs.querySelector('.puri-chips'); if (c) c.remove(); }
  var INICIOS = ['Quero começar a vender açaí no ', 'Hoje meu maior problema é ', 'Queria um fornecedor que '];
  function aoInicio(t) { // só preenche o campo (não envia nem passa por aoChip)
    if (!campo || campo.disabled) return;
    campo.value = t; campo.dispatchEvent(new Event('input'));
    try { campo.focus({ preventScroll: true }); campo.setSelectionRange(t.length, t.length); } catch (e) {}
  }
  function antigos() { // cartões do mesmo tipo: só o último fica com brilho cheio
    ['.puri-cena', '.puri-sim', '.puri-resumo', '.puri-mapa'].forEach(function (q) {
      var l = msgs.querySelectorAll(q);
      for (var i = 0; i < l.length; i++) l[i].classList.toggle('puri-antigo', i < l.length - 1);
    });
  }
  function aoChipAnim(box, x, c) { // contorno dourado por ~150 ms antes de virar o balão
    if (REDUZIDO || ocupado || ajVoo) return aoChip(c);
    if (box._sel) return;
    box._sel = true; x.classList.add('puri-escolhido'); box.classList.add('puri-chips-sel');
    var g = ger;
    setTimeout(function () {
      if (g !== ger || !x.isConnected) return;
      if (ocupado || ajVoo) { box._sel = false; x.classList.remove('puri-escolhido'); box.classList.remove('puri-chips-sel'); return; } // ficou ocupada nesse meio-tempo: solta os chips
      aoChip(c);
    }, 150); // removido (digitou/recomeçou) no meio: não faz nada
  }
  function desenharChips(lista, animar) {
    limparChips();
    if (!lista || !lista.length) return;
    var box = el('div', 'puri-chips');
    if (animar === false) box.style.animation = 'none';
    if (E.r && E.r.passo === 'objetivo' && lista.some(function (c) { return c.id === 'r_pular'; })) { // inícios prontos: só preenchem o campo
      INICIOS.forEach(function (t) {
        var y = el('button', 'puri-chip puri-ini', t.replace(/ $/, '…')); y.type = 'button';
        y.addEventListener('click', function () { aoInicio(t); });
        box.appendChild(y);
      });
    }
    lista.forEach(function (c) {
      var x;
      if (c.href) {
        x = el('a', 'puri-chip' + (c.hum ? ' hum' : ''), c.t);
        x.href = c.href; x.rel = 'noopener';
        if (c.hum) x.href = waLink();
        if (/^https?:/.test(c.href)) x.target = '_blank';
        else x.addEventListener('click', function () { fechar(); }); // link interno: fecha o painel e deixa o navegador seguir/rolar
      } else {
        x = el('button', 'puri-chip', c.t); x.type = 'button';
        x.addEventListener('click', function () { aoChipAnim(box, x, c); });
      }
      box.appendChild(x);
    });
    msgs.appendChild(box);
  }
  // ---- Cena neon do ponto de venda (dados: [cor, 'd do path'], só M L H V C Q A Z, sem transform; o canvas reusa via Path2D) ----
  var COR_CENA = { g: 'var(--gold, #F5B301)', v: 'var(--verde, #8BB831)', c: 'var(--cream, #FFF7EC)' };
  function copoCena(x, b, s) { // copo de açaí com cúpula e colher; (x, b) = canto esquerdo da base; s = escala
    var y = b - 26 * s;
    function k(v) { return Math.round(v * 10) / 10; }
    return [
      ['c', 'M' + k(x) + ' ' + k(y) + ' L' + k(x + 3 * s) + ' ' + k(b) + ' H' + k(x + 19 * s) + ' L' + k(x + 22 * s) + ' ' + k(y) + ' Z'],
      ['g', 'M' + k(x - s) + ' ' + k(y) + ' C' + k(x - s) + ' ' + k(y - 14 * s) + ' ' + k(x + 23 * s) + ' ' + k(y - 14 * s) + ' ' + k(x + 23 * s) + ' ' + k(y)],
      ['v', 'M' + k(x + 14 * s) + ' ' + k(y - 9 * s) + ' L' + k(x + 19 * s) + ' ' + k(y - 21 * s) + ' Q' + k(x + 21 * s) + ' ' + k(y - 27 * s) + ' ' + k(x + 25 * s) + ' ' + k(y - 24 * s) + ' Q' + k(x + 23 * s) + ' ' + k(y - 19 * s) + ' ' + k(x + 19 * s) + ' ' + k(y - 21 * s)]
    ];
  }
  function circ(cx, cy, r) { return 'M' + (cx - r) + ' ' + cy + ' A' + r + ' ' + r + ' 0 1 0 ' + (cx + r) + ' ' + cy + ' A' + r + ' ' + r + ' 0 1 0 ' + (cx - r) + ' ' + cy; }
  var CHAO = ['c', 'M8 128 H312'];
  var CENAS = {
    acaiteria: [CHAO, ['c', 'M20 128 V50 H200 V128'], ['g', 'M14 50 H206 L196 30 H24 Z'], ['v', 'M58 30 L54 50'], ['v', 'M92 30 L90 50'], ['v', 'M128 30 L128 50'], ['v', 'M162 30 L166 50'], ['c', 'M34 128 V92 H186 V128'], ['g', 'M34 92 H186']].concat(copoCena(244, 128, 2)),
    lanchonete_bar: [CHAO, ['c', 'M12 128 V88 H200 V128'], ['g', 'M8 88 H204'], ['c', 'M38 74 H62 M50 74 V128 M42 128 H58'], ['c', 'M118 74 H142 M130 74 V128 M122 128 H138'], ['c', 'M80 22 V10 M140 22 V10'], ['g', 'M60 22 H160 V46 H60 Z'], ['v', 'M72 34 H148']].concat(copoCena(164, 88, 0.9), copoCena(240, 128, 1.6)),
    delivery_acai: [CHAO, ['c', 'M10 96 H34 M16 108 H38'], ['c', circ(70, 110, 18)], ['c', circ(190, 110, 18)], ['c', 'M70 110 L100 84 H150 L190 110'], ['c', 'M190 110 L182 76 L196 66 H204'], ['v', 'M102 78 H142 M122 78 V84'], ['c', 'M46 90 H100 M70 110 L78 90'], ['g', 'M52 62 H100 V90 H52 Z'], ['v', 'M52 72 H100']].concat(copoCena(240, 128, 1.6)),
    sorveteria: [CHAO, ['c', 'M16 128 V54 H176 V128'], ['g', 'M12 54 L24 34 H168 L180 54'], ['v', 'M12 54 Q24 68 36 54 Q48 68 60 54 Q72 68 84 54 Q96 68 108 54 Q120 68 132 54 Q144 68 156 54 Q168 68 180 54'], ['v', 'M30 128 V100 H162 V128'], ['c', 'M30 100 L40 88 H152 L162 100'], ['c', 'M200 62 L222 126 L244 62 Z'], ['c', 'M210 80 L236 80 M216 98 L230 98'], ['g', 'M198 62 C192 40 246 40 246 62'], ['v', 'M210 46 C210 30 234 30 234 46']].concat(copoCena(268, 128, 1)),
    feira_evento: [CHAO, ['c', 'M10 20 Q100 44 190 20'], ['v', 'M35 26.7 H45 L40 37 Z'], ['g', 'M65 30.7 H75 L70 41 Z'], ['v', 'M95 32 H105 L100 42 Z'], ['g', 'M125 30.7 H135 L130 41 Z'], ['v', 'M155 26.7 H165 L160 37 Z'], ['g', 'M16 62 L100 30 L184 62 Z'], ['c', 'M30 62 V128 M170 62 V128'], ['c', 'M45 100 H155 M52 100 V128 M148 100 V128']].concat(copoCena(84, 100, 0.8), copoCena(232, 128, 1.6)),
    mercado_varejo: [CHAO, ['c', 'M14 128 V40 H110 V128'], ['g', 'M14 66 H110 M14 92 H110'], ['v', 'M26 66 V54 H38 V66 M52 66 V50 H64 V66 M26 92 V80 H38 V92 M72 92 V76 H84 V92'], ['v', 'M130 128 V36 H190 V128 Z'], ['c', 'M138 128 V44 H182 V128 M138 70 H182 M138 98 H182'], ['g', 'M176 76 V92'], ['c', 'M214 56 H226 L236 100 H282 L292 66 H230'], ['c', 'M246 100 L245 114 M276 100 L275 114'], ['c', circ(245, 120, 6)], ['c', circ(275, 120, 6)]].concat(copoCena(252, 100, 0.8)),
    revenda_casa: [CHAO, ['c', 'M24 128 V74 H150 V128'], ['g', 'M14 76 L87 28 L160 76'], ['c', 'M122 50 V32 H134 V58'], ['v', 'M42 88 H74 V112 H42 Z M58 88 V112 M42 100 H74'], ['c', 'M100 128 V92 H128 V128 M122 112 H123'], ['v', 'M190 128 V100 H240 V128'], ['g', 'M186 100 V92 H244 V100'], ['g', 'M205 92 Q215 82 225 92']].concat(copoCena(266, 128, 1)),
    outro: [CHAO, ['c', 'M30 128 V56 H190 V128'], ['g', 'M22 56 L34 38 H186 L198 56 Z'], ['c', 'M50 128 V84 H82 V128'], ['v', 'M104 74 H170 V110 H104 Z'], ['g', 'M110 62 H164']].concat(copoCena(236, 128, 1.6))
  };
  var CARTOES_CENA = [['cenario', 'O cenário'], ['trava', 'O que trava'], ['chegar', 'Onde quer chegar']];
  function cenaEl(seg, cartoes) { // monta o cartão (SVG por createElementNS; legenda por textContent). Null se algo falhar. `cartoes` (do servidor): 3 textos curtos abaixo da cena.
    try {
      var chave = CENAS[seg] ? seg : 'outro', rot = SEG_LABEL[seg] || SEG_LABEL.outro, NS = 'http://www.w3.org/2000/svg';
      var c = el('div', 'puri-cena');
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 320 150'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Desenho de: ' + rot);
      svg.setAttribute('class', 'puri-cena-svg'); svg.setAttribute('focusable', 'false');
      var lista = CENAS[chave].slice().sort(function (a, b) { return parseFloat(a[1].slice(1)) - parseFloat(b[1].slice(1)); });
      lista.forEach(function (it) {
        var p = document.createElementNS(NS, 'path'); p.setAttribute('d', it[1]);
        p.style.stroke = COR_CENA[it[0]]; p.style.filter = 'drop-shadow(0 0 3px ' + COR_CENA[it[0]] + ')';
        svg.appendChild(p);
      });
      c.appendChild(svg);
      c.appendChild(el('p', 'puri-cena-leg', 'Seu ponto: ' + rot));
      if (cartoes && typeof cartoes === 'object') {
        var cs = el('div', 'puri-cena-cards');
        CARTOES_CENA.forEach(function (k) {
          var t = sanTxt(cartoes[k[0]], 80); if (!t) return;
          var cd = el('div', 'puri-cena-card'); cd.style.setProperty('--i', cs.children.length); cd.appendChild(el('span', 'puri-cena-ct', k[1])); cd.appendChild(el('p', 'puri-cena-tx', t)); cs.appendChild(cd);
        });
        if (cs.children.length) c.appendChild(cs);
      }
      return c;
    } catch (e) { return null; }
  }
  function cenaDesenha(c) { // chamar com o cartão já no DOM (getTotalLength exige isso)
    try {
      var ps = c.querySelectorAll('path'), n = ps.length;
      for (var i = 0; i < n; i++) {
        var len = ps[i].getTotalLength() + 1;
        ps[i].style.strokeDasharray = len + ' ' + len; ps[i].style.strokeDashoffset = len;
        ps[i].style.transition = 'stroke-dashoffset .7s ease-out ' + (n > 1 ? (i * 1.3 / (n - 1)).toFixed(2) : 0) + 's';
      }
      void c.getBoundingClientRect();
      requestAnimationFrame(function () { c.classList.add('desenha'); });
    } catch (e) { c.classList.add('desenha'); }
  }
  function inserirCena() {
    try {
      var cn = E.r.cena, c = cn ? cenaEl(cn.chave, cn.cartoes) : cenaEl(E.r.segmento); if (!c) return;
      msgs.appendChild(c); E.r.cenaI = E.msgs.length; salvar();
      if (!REDUZIDO) cenaDesenha(c);
      rolar();
    } catch (e) {}
  }
  // ---- Pixel art do movimento: cena pixelizada -> explode -> remonta em bonequinhos (canvas; rAF para no fim) ----
  var PIX_N = { ate20: 10, '20a50': 35, '50a100': 75, '100mais': 120 };
  var PIX_H = 150, PIX_BONECO = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [0, 3], [2, 3], [0, 4], [2, 4]];
  function pixCores() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, f) { var x = cs.getPropertyValue(n).trim(); return x || f; }
    return { g: v('--gold', '#F5B301'), v: v('--verde', '#8BB831'), c: v('--cream', '#FFF7EC'), r: v('--roxo-300', '#A94E8C'), s: v('--gold-soft', '#FFD34D') };
  }
  function pixTexto(mov, n) { return '≈ ' + (n === undefined ? (mov === '100mais' ? '120+' : PIX_N[mov]) : n) + ' clientes por dia'; }
  function pixLayout(N, W, H, cor) { // posições (canto sup. esq.) de cada pixel dos bonequinhos + tamanho da célula
    var s = 6, cols = 1, rows = N, pX, pY;
    for (; s >= 1; s -= 0.25) {
      pX = 4 * s; pY = 6.2 * s;
      cols = Math.max(1, Math.floor((W - 4 + s) / pX)); rows = Math.ceil(N / cols);
      if (rows * pY - 1.2 * s <= H - 8) break;
    }
    pX = 4 * s; pY = 6.2 * s;
    var oy = (H - (rows * pY - 1.2 * s)) / 2, paleta = [cor.g, cor.v, cor.c, cor.r], px = [];
    for (var i = 0; i < N; i++) {
      var lin = Math.floor(i / cols), n = Math.min(cols, N - lin * cols), x0 = (W - (n * pX - s)) / 2 + (i % cols) * pX, y0 = oy + lin * pY;
      for (var k = 0; k < PIX_BONECO.length; k++) px.push({ x: x0 + PIX_BONECO[k][0] * s, y: y0 + PIX_BONECO[k][1] * s, c: paleta[i % 4] });
    }
    return { s: s, px: px };
  }
  function pixQuad(ctx, dpr, x, y, t, c, a) {
    ctx.globalAlpha = a; ctx.fillStyle = c;
    ctx.fillRect(Math.round(x * dpr) / dpr, Math.round(y * dpr) / dpr, t, t);
  }
  var PIX_EST = [[.06, .14], [.15, .34], [.24, .09], [.33, .24], [.42, .06], [.5, .3], [.58, .16], [.67, .07], [.75, .28], [.83, .4], [.12, .52], [.9, .62]];
  function pixCeu(ctx, dpr, W, cor) { // céu: estrelas fixas + lua de pixels no canto superior direito
    PIX_EST.forEach(function (e, i) { pixQuad(ctx, dpr, e[0] * W, e[1] * PIX_H, i % 3 ? 2 : 3, i % 2 ? cor.c : cor.s, i % 3 ? .75 : 1); });
    var mx = W - 26, my = 20, r = 4;
    for (var gy = -r; gy <= r; gy++) for (var gx = -r; gx <= r; gx++) if (gx * gx + gy * gy <= r * r + 1) pixQuad(ctx, dpr, mx + gx * 3, my + gy * 3, 3, cor.s, 1);
    ctx.globalAlpha = 1;
  }
  function pixFinal(card) { // quadro final (só os bonequinhos) no tamanho atual do cartão
    var cv = card.querySelector('canvas'), W = Math.floor(card.querySelector('.puri-pix-cv').clientWidth);
    if (!cv || W < 20) return false;
    var dpr = Math.min(2, window.devicePixelRatio || 1), ctx = cv.getContext('2d');
    cv.width = Math.round(W * dpr); cv.height = Math.round(PIX_H * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
    var cor0 = pixCores(), L = pixLayout(PIX_N[card._mov], W, PIX_H, cor0);
    pixCeu(ctx, dpr, W, cor0);
    L.px.forEach(function (p) { pixQuad(ctx, dpr, p.x, p.y, L.s, p.c, 1); });
    ctx.globalAlpha = 1; card._w = W;
    card.querySelector('.puri-pix-leg').textContent = pixTexto(card._mov);
    return true;
  }
  function pixAnima(card) { // devolve false se não puder animar (o chamador cai no quadro final)
    var cv = card.querySelector('canvas'), W = Math.floor(card.querySelector('.puri-pix-cv').clientWidth), H = PIX_H;
    if (!cv || W < 20 || typeof Path2D !== 'function') return false;
    var cor = pixCores(), N = PIX_N[card._mov], dpr = Math.min(2, window.devicePixelRatio || 1), ctx = cv.getContext('2d');
    // 1) cena do segmento num canvas offscreen -> células de 4 px acesas
    var off = document.createElement('canvas'); off.width = W; off.height = H;
    var oc = off.getContext('2d'), sc = Math.min(W / 320, H / 150);
    oc.setTransform(sc, 0, 0, sc, (W - 320 * sc) / 2, (H - 150 * sc) / 2);
    oc.lineWidth = 2.5; oc.lineCap = 'round'; oc.lineJoin = 'round';
    var chave = CENAS[card._seg] ? card._seg : 'outro';
    CENAS[chave].forEach(function (it) { oc.strokeStyle = cor[it[0] === 'g' ? 'g' : it[0] === 'v' ? 'v' : 'c']; oc.stroke(new Path2D(it[1])); });
    var img = oc.getImageData(0, 0, W, H).data, lit = [], CEL = 4;
    for (var cy = 0; cy < H; cy += CEL) for (var cx = 0; cx < W; cx += CEL) {
      var best = -1, bi = 0;
      for (var yy = cy; yy < Math.min(H, cy + CEL); yy++) for (var xx = cx; xx < Math.min(W, cx + CEL); xx++) {
        var i = (yy * W + xx) * 4, al = img[i + 3]; if (al > best) { best = al; bi = i; }
      }
      if (best > 90) lit.push({ x: cx, y: cy, c: 'rgb(' + img[bi] + ',' + img[bi + 1] + ',' + img[bi + 2] + ')' });
    }
    if (!lit.length) return false;
    if (lit.length > 900) { var k = lit.length / 900, red = []; for (var j = 0; j < 900; j++) red.push(lit[Math.floor(j * k)]); lit = red; }
    var L = pixLayout(N, W, H, cor), D = L.px.slice(), P = lit.length;
    for (var a = D.length - 1; a > 0; a--) { var b = Math.floor(Math.random() * (a + 1)), tmp = D[a]; D[a] = D[b]; D[b] = tmp; }
    var parts = lit.map(function (p, n) {
      var ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * 110;
      return { x: p.x, y: p.y, c: p.c, ex: p.x + Math.cos(ang) * dist, ey: p.y + Math.sin(ang) * dist, d: n < D.length ? D[n] : null, dl: Math.random() * 0.25 };
    });
    var T0 = performance.now(), ultimo = -1;
    function ease(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
    function clamp(u) { return u < 0 ? 0 : u > 1 ? 1 : u; }
    function fim() {
      card._anim = false; card._raf = 0;
      try { pixFinal(card); } catch (e) {}
    }
    function quadro(now) {
      if (!card.isConnected) { card._anim = false; card._raf = 0; return; }
      try {
      var t = now - T0;
      if (t >= 2500 || document.hidden || !aberto) return fim();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.scale(dpr, dpr);
      var i, p;
      pixCeu(ctx, dpr, W, cor);
      if (t < 500) { for (i = 0; i < P; i++) { p = parts[i]; pixQuad(ctx, dpr, p.x, p.y, 3, p.c, 1); } }
      else if (t < 1100) {
        var u = (t - 500) / 600, e = 1 - (1 - u) * (1 - u);
        for (i = 0; i < P; i++) { p = parts[i]; pixQuad(ctx, dpr, p.x + (p.ex - p.x) * e, p.y + (p.ey - p.y) * e, 3, p.c, 1); }
      } else {
        var u3 = (t - 1100) / 1400;
        for (i = 0; i < P; i++) {
          p = parts[i];
          var ek = ease(clamp((u3 - p.dl) / 0.75));
          if (p.d) pixQuad(ctx, dpr, p.ex + (p.d.x - p.ex) * ek, p.ey + (p.d.y - p.ey) * ek, 3 + (L.s - 3) * ek, ek < 0.5 ? p.c : p.d.c, 1);
          else pixQuad(ctx, dpr, p.ex, p.ey, 3, p.c, 1 - clamp(u3 * 2.2));
        }
        for (i = P; i < D.length; i++) pixQuad(ctx, dpr, D[i].x, D[i].y, L.s, D[i].c, clamp((u3 - 0.55) / 0.45));
        var n = Math.round(N * ease(clamp(u3)));
        if (n !== ultimo) { ultimo = n; card.querySelector('.puri-pix-leg').textContent = pixTexto(card._mov, n); }
      }
      ctx.globalAlpha = 1;
      card._raf = requestAnimationFrame(quadro);
      } catch (e) { fim(); }
    }
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); card._w = W; card._anim = true;
    card.querySelector('.puri-pix-leg').textContent = pixTexto(card._mov, 0);
    card._raf = requestAnimationFrame(quadro);
    return true;
  }
  function pixelMonta(mov, seg, animar) {
    try {
      if (!PIX_N[mov]) return null;
      var N = PIX_N[mov], card = el('div', 'puri-pixel'), wrap = el('div', 'puri-pix-cv'), cv = document.createElement('canvas');
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Cerca de ' + N + (mov === '100mais' ? ' ou mais' : '') + ' clientes por dia');
      cv.style.height = PIX_H + 'px';
      card.appendChild(el('p', 'puri-pix-t', 'Seu movimento por dia')); wrap.appendChild(cv); card.appendChild(wrap); var leg = el('p', 'puri-pix-leg', pixTexto(mov)); leg.setAttribute('aria-hidden', 'true'); card.appendChild(leg);
      card._mov = mov; card._seg = seg;
      msgs.appendChild(card);
      var ok = false;
      if (animar && !REDUZIDO && aberto && !document.hidden) { try { ok = pixAnima(card); } catch (e) { ok = false; card._anim = false; } }
      if (!ok) pixFinal(card);
      if (typeof ResizeObserver === 'function') {
        card._ro = new ResizeObserver(function () {
          if (!card.isConnected) { card._ro.disconnect(); return; }
          if (card._anim) return;
          var w = Math.floor(wrap.clientWidth); if (w >= 20 && w !== card._w) pixFinal(card);
        });
        card._ro.observe(wrap);
      }
      return card;
    } catch (e) { return null; }
  }
  function inserirPixel() {
    try {
      var c = pixelMonta(E.r.movimento, E.r.segmento, true); if (!c) return;
      E.r.pixI = E.msgs.length; salvar(); rolar();
    } catch (e) {}
  }
  function desenharTudo() {
    msgs.textContent = '';
    var rc = E.r && E.r.resumo ? E.r : null;
    var cn = E.r && E.r.segmento && typeof E.r.cenaI === 'number' ? E.r : null;
    function cena(i) { if (cn && cn.cenaI === i) { var c = cn.cena ? cenaEl(cn.cena.chave, cn.cena.cartoes) : cenaEl(cn.segmento); if (c) msgs.appendChild(c); } }
    var px = E.r && E.r.movimento && typeof E.r.pixI === 'number' ? E.r : null;
    function pixel(i) { if (px && px.pixI === i) pixelMonta(px.movimento, px.segmento, false); }
    var mp = E.r && Array.isArray(E.r.mapas) ? E.r.mapas : [];
    function mapa(i) { mp.forEach(function (x) { if (x.i === i) { try { var c = mapaEl(x.m, false); if (c) msgs.appendChild(c); } catch (e) {} } }); }
    cena(0); pixel(0); mapa(0);
    if (rc && rc.resI === 0) msgs.appendChild(cartaoResumo(rc.resumo, rc.problema, rc.termo));
    E.msgs.forEach(function (m, i) { var bl = addBalao(m.de, m.t, false, m.et); if (m.de === 'u') { var vv = bl.querySelector('.puri-vt'); if (vv) vv.classList.add('visto'); } cena(i + 1); pixel(i + 1); mapa(i + 1); if (rc && rc.resI === i + 1) msgs.appendChild(cartaoResumo(rc.resumo, rc.problema, rc.termo)); });
    if (E.r && E.r.passo === 'sim' && E.r.sim) msgs.appendChild(cartaoSim(E.r.sim));
    desenharChips(E.chips, false);
    atualizarCampo(); atualizarCaso();
    rolar(true);
  }
  function guardar(de, t, et) {
    var nm = { de: de, t: t }; if (de === 'p' && temEt(et)) nm.et = et;
    E.msgs.push(nm);
    if (E.msgs.length > MAX_BALOES) { var corte = E.msgs.length - MAX_BALOES; E.msgs = E.msgs.slice(-MAX_BALOES); if (E.r && E.r.resumo) E.r.resI = Math.max(0, (E.r.resI || 0) - corte); if (E.r && typeof E.r.cenaI === 'number') E.r.cenaI = Math.max(0, E.r.cenaI - corte); if (E.r && typeof E.r.pixI === 'number') E.r.pixI = Math.max(0, E.r.pixI - corte); if (E.r && Array.isArray(E.r.mapas)) E.r.mapas = E.r.mapas.filter(function (x) { x.i -= corte; return x.i >= 0; }); }
    salvar();
  }
  function podarDom() { var b = baloes(); while (b.length > MAX_BALOES) { b[0].remove(); b = baloes(); } }

  function sanOpcoes(a) { // opções de botão vindas do servidor (ou do estado salvo): id curto + rótulo curto, 2 a 4, sem repetir
    var vistos = {}, out = [];
    (Array.isArray(a) ? a : []).forEach(function (o) {
      if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !/^[a-z0-9_]{1,24}$/.test(o.id) || vistos[o.id] || out.length >= 4) return;
      var t = sanTxt(o.rotulo, 60); if (!t) return;
      vistos[o.id] = 1; out.push({ id: o.id, rotulo: t });
    });
    return out.length >= 2 ? out : null;
  }
  function sanQr(o) { // rótulos das respostas de qualificação (painel "Seu caso"): só os 4 campos, texto curto
    var out = {};
    if (o && typeof o === 'object') QR_CAMPOS.forEach(function (k) { var t = sanTxt(o[k], 60); if (t) out[k] = t; });
    return out;
  }
  function sanCena(c) { // cena vinda do servidor: chave entre as 8 existentes + 3 cartões curtos (tudo por textContent depois)
    if (!c || typeof c !== 'object' || !temSeg(c.chave)) return null; // as 8 chaves de cena = as 8 chaves de segmento (CENAS ainda não existe quando o estado é lido)
    var k = c.cartoes && typeof c.cartoes === 'object' ? c.cartoes : null; if (!k) return null;
    var cen = sanTxt(k.cenario, 80), tra = sanTxt(k.trava, 80), che = sanTxt(k.chegar, 80);
    return cen && tra && che ? { chave: c.chave, cartoes: { cenario: cen, trava: tra, chegar: che } } : null;
  }
  function sanVisitaPre(v) { // cidade/bairro que o servidor devolve no `destino` para preencher a visita
    if (!v || typeof v !== 'object') return null;
    var cid = Object.keys(CIDADES).map(function (k) { return CIDADES[k]; }).indexOf(v.cidade) >= 0 ? v.cidade : null;
    var b = sanTxt(v.bairro, 60); if (b.length < 2) b = null;
    return cid || b ? { cidade: cid, bairro: b } : null;
  }
  var PALAVRAS_SOLTAS = ' o a os as de do da dos das em no na e ou sobre para pra com que um uma ';
  function cortarPilula(t, n) { // espelho de cortarProblema (logica.ts): corta no último espaço e tira palavras soltas do fim
    var s = sanTxt(t, 400), cortou = s.length > n; // mínimo de 8 só vale quando houve corte (palavra curta tipo "Medo" passa)
    if (cortou) { var i = s.slice(0, n + 1).lastIndexOf(' '); s = i > 0 ? s.slice(0, i) : s.slice(0, n); }
    var p = s.split(' ');
    while (p.length > 1 && PALAVRAS_SOLTAS.indexOf(' ' + p[p.length - 1].toLowerCase() + ' ') >= 0) p.pop();
    s = p.join(' ').trim();
    return s.length < (cortou ? 8 : 3) ? '' : s;
  }
  function sanTxt(t, n) { return typeof t === 'string' ? t.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : ''; }
  function ehLimite(m) { return typeof m === 'string' && m.indexOf('limite_') === 0 && m !== 'limite_ajuste'; } // limite_conversa/dia/custo/ip_dia/conversas_dia/global_dia (limite_ajuste tem tratamento próprio)
  function mascararObj(t) { // o que é SALVO (sessionStorage): e-mail, CEP, endereço de rua, "meu nome é X" e 8+ dígitos são trocados por marcas. Cidade/bairro soltos ficam.
    return String(t)
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
      .replace(/\b\d{5}-\d{3}\b/g, '[cep]')
      .replace(/\b(?:rua|r\.|avenida|av\.?|travessa|alameda|rodovia|estrada|quadra)\s+[^\d\n]{1,50}?[,\s]+(?:n[º°o.]*\s*)?\d+\b/gi, '[endereço]')
      .replace(/\b(meu nome (?:é|e)|me chamo)\s+[^\s,.;!?]+(?:\s+(?!(?:e|eu|sou|moro|tenho|quero|gostaria|do|da|de)\b)[^\s,.;!?]+)?/gi, '$1 [nome]')
      .replace(/\d(?:[\s().-]*\d){7,}/g, '[contato]');
  }
  function usuarioDiz(t, guardado) { limparChips(); E.chips = []; guardar('u', guardado === undefined ? mascararObj(t) : guardado); addBalao('u', t); podarDom(); rolar(); }

  // Puri fala: "•••" por 0,3–1 s (sem atraso em reduced-motion), depois balão + chips.
  function puriDiz(texto, chips, guardado, et) {
    limparChips(); E.chips = []; marcarVisto();
    var g = ger, tk = chipGen; // tk: qualquer limparChips/desenharChips depois desta fala cancela os chips agendados
    guardar('p', guardado === undefined ? texto : guardado, et); E.chips = chips || []; salvar(); // fala e chips salvos ANTES do atraso: recarregar no meio não perde a pergunta
    var dig = el('div', 'puri-b p puri-dig'); dig.setAttribute('aria-hidden', 'true');
    dig.appendChild(el('i')); dig.appendChild(el('i')); dig.appendChild(el('i'));
    if (!REDUZIDO) { msgs.appendChild(dig); rolar(); }
    var espera = REDUZIDO ? 0 : Math.min(1000, 300 + texto.length * 6);
    return new Promise(function (ok) {
      setTimeout(function () {
        dig.remove();
        if (g !== ger) return ok(); // conversa recomeçada enquanto a Puri "digitava"
        addBalao('p', texto, undefined, et); podarDom(); atualizarCampo(); topoHum.href = waLink();
        if (REDUZIDO) { if (tk === chipGen) desenharChips(E.chips); rolar(); return ok(); }
        // opções 0,3 s depois da fala; qualquer fala/clique/texto nesse meio-tempo as cancela
        setTimeout(function () { if (tk !== chipGen || g !== ger || !E.chips.length) return; desenharChips(E.chips); rolar(); }, 300);
        rolar(); ok();
      }, espera);
    });
  }

  // ---- Fluxo ----
  function comecar() { puriDiz(T.abertura, CH.abertura); }

  function recomecar() {
    ger++;
    ultimoTexto = ''; vNome = ''; vTel = ''; vEsp = null; limparConta(); rRetry = null; clearTimeout(escTimer); escVoo = false; escUltimo = ''; limparNotas();
    E = novoEstado(); bg = {};
    ocupado = false; ajVoo = false; ultimaNota = ''; salvar(); msgs.textContent = ''; atualizarCampo(); topoHum.href = waLink();
    comecar(); focarEntrada();
  }

  var ultimoTexto = '';
  function falhaTemp() { return puriDiz(T.erroTemp, [{ id: 'retry', t: 'Tentar de novo' }, CH.humano]); }
  function falhaF6(textoFala) { limparConta(); E.etapa = 'fim'; return puriDiz(textoFala || T.limite, [CH.humano]); }

  // Destino de cada opção (chip ou intenção vinda de texto livre). Sem guard de `ocupado`.
  function irPara(id) {
    switch (id) {
      case 'revender': return iniciarR();
      case 'consumir': return irConsumir();
      case 'provar':
        limparVisita(); E.etapa = 'abertura'; E.assunto = 'provar';
        return puriDiz(T.provar, [{ id: 'fabrica', t: 'Visitar a fábrica' }, { id: 'vendedor', t: 'Receber um vendedor com amostras' }, CH.humano]);
      case 'duvida': case 'outra':
        limparVisita(); E.etapa = 'duvida'; E.assunto = 'duvida';
        return puriDiz(T.pergunta, chipsQ(SUGESTOES));
    }
    return puriDiz(T.incertoAb, CH.abertura);
  }

  // ---- F2: consumir (preço ao vivo do catálogo, cache 10 min) ----
  var CAT_CHAVE = 'puri:cat', CAT_TTL = 600000, catMem = null;
  function catalogo() {
    var agora = Date.now();
    if (catMem && agora - catMem.t < CAT_TTL) return Promise.resolve(catMem.d);
    try {
      var c = JSON.parse(sessionStorage.getItem(CAT_CHAVE) || 'null');
      if (c && typeof c.t === 'number' && agora - c.t < CAT_TTL && c.d && c.d.ok) { catMem = c; return Promise.resolve(c.d); }
    } catch (e) {}
    return api.catalogo().then(function (r) {
      if (r && r.ok) { catMem = { t: Date.now(), d: r }; try { sessionStorage.setItem(CAT_CHAVE, JSON.stringify(catMem)); } catch (e) {} }
      return r;
    }).catch(function () { return { ok: false }; });
  }
  function reais(v) { return 'R$ ' + (v % 1 ? v.toFixed(2).replace('.', ',') : String(v)); }
  function hrefDelivery() { return PAGINA === 'delivery' ? './' : (PAGINA === 'revenda' ? '../delivery/' : './delivery/'); }
  function irConsumir() {
    limparVisita(); E.etapa = 'abertura'; E.assunto = 'consumir';
    var g = ger, antes = ocupado;
    ocupado = true; atualizarCampo();
    var link = { id: 'l', t: 'Abrir o delivery', href: hrefDelivery() };
    return catalogo().then(function (r) {
      if (g !== ger) return;
      var v = r && r.ok && r.delivery ? Number(r.delivery.a_partir_de) : NaN;
      var mn = r && r.ok ? Number(r.minimo) : NaN, mTxt = isFinite(mn) && mn > 0 && mn <= 1000 ? reais(mn) : '';
      var fala = isFinite(v) && v > 0 ? T.consumirPreco(reais(v), mTxt) : T.consumir(mTxt);
      return puriDiz(fala, [link, { id: 'como_entrega', t: 'Como funciona a entrega?' }, { id: 'revender', t: 'Na verdade quero revender' }]).then(function () {
        if (g === ger) { ocupado = antes; atualizarCampo(); }
      });
    });
  }

  // ---- F3: provar (fábrica ou visita do vendedor) ----
  function limparVisita() { vNome = ''; vTel = ''; vEsp = null; limparConta(); E.v = null; E.r = null; rRetry = null; clearTimeout(escTimer); limparNotas(); }
  // Etapa 3: tela final do caso (E.r.passo 'destino'; 'regras' é o nome antigo). A visita pedida a partir dela NÃO apaga E.r.
  function emFinal() { return !!(E.r && (E.r.passo === 'destino' || E.r.passo === 'regras')); }
  function soVisita() { vNome = ''; vTel = ''; E.v = null; }
  function fimVisita() { if (emFinal()) soVisita(); else limparVisita(); }
  function visitaPulado(p) { return !!(emFinal() && E.r.visitaPre && (p === 'cidade' || p === 'bairro') && E.r.visitaPre[p]); }
  var V_PROX = { cidade: 'bairro', bairro: 'dia', dia: 'periodo', periodo: 'nome' };
  function passoSeg(p, mapa) { var n = mapa[p]; while (n && visitaPulado(n)) n = mapa[n]; return n || null; }
  function primeiroPasso() { return visitaPulado('cidade') ? (visitaPulado('bairro') ? 'dia' : 'bairro') : 'cidade'; }
  function irFabrica() {
    if (emFinal()) { // visita iniciada na tela final: preserva o caso (E.r) e volta aos chips do destino
      var dest = E.r.destino; fimVisita(); salvar();
      return puriDiz(T.fabrica, [{ id: 'l', t: 'Ver no mapa', href: MAPA_FABRICA }].concat(chipsDestino(dest)));
    }
    limparVisita(); E.etapa = 'abertura'; E.assunto = 'provar';
    return puriDiz(T.fabrica, [{ id: 'l', t: 'Ver no mapa', href: MAPA_FABRICA }, { id: 'revender', t: 'Quero revender' }]);
  }
  function resumoVisita(anonimo) {
    var v = E.v;
    return 'Visita em ' + (v.bairro ? v.bairro + ', ' : '') + v.cidade + ', ' + DIAS[v.dia] + ' de ' + (v.periodo === 'manha' ? 'manhã' : 'tarde') + ', pra ' + (anonimo ? 'você' : vNome) + '.';
  }
  var CH_VOLTAR = { id: 'v_voltar', t: 'Voltar' }, V_ANTES = { bairro: 'cidade', dia: 'bairro', periodo: 'dia', nome: 'periodo' };
  function chipsPasso(p) {
    switch (p) {
      case 'cidade': return [{ id: 'cid_cuiaba', t: 'Cuiabá' }, { id: 'cid_vg', t: 'Várzea Grande' }, { id: 'cid_outra', t: 'Outra cidade' }, CH_VOLTAR, CH.humano];
      case 'dia': return ['seg', 'ter', 'qua', 'qui', 'sex'].map(function (d) { return { id: 'dia_' + d, t: DIA_CURTO[d] }; }).concat([CH_VOLTAR]);
      case 'periodo': return [{ id: 'per_manha', t: 'Manhã (8h–12h)' }, { id: 'per_tarde', t: 'Tarde (13h–17h)' }, CH_VOLTAR];
      case 'confirma': return [{ id: 'confirmar', t: 'Confirmar' }, { id: 'corrigir', t: 'Corrigir' }];
      case 'bairro': return [{ id: 'v_pular', t: 'Pular' }, CH_VOLTAR, CH.humano];
      case 'nome': return [CH_VOLTAR, CH.humano];
    }
    return [CH.humano]; // tel (texto livre)
  }
  function falaPasso(p) {
    if (p === 'confirma') return resumoVisita();
    return { cidade: T.pCidade, bairro: T.pBairro, dia: T.pDia, periodo: T.pPeriodo, nome: T.pNome, tel: T.pTel }[p] || T.incerto;
  }
  function perguntarPasso(p, prefixo) {
    E.v.passo = p; salvar();
    return puriDiz((prefixo ? prefixo + ' ' : '') + falaPasso(p), chipsPasso(p), p === 'confirma' ? (prefixo ? prefixo + ' ' : '') + resumoVisita(true) : undefined);
  }
  function iniciarVendedor(prefixo) {
    vNome = ''; vTel = '';
    if (emFinal()) { // visita a partir do destino: cidade/bairro do caso já preenchidos, pula o que foi respondido
      var pre = E.r.visitaPre || {};
      E.v = { passo: 'cidade', cidade: pre.cidade || null, bairro: pre.bairro || null, dia: null, periodo: null };
      return perguntarPasso(primeiroPasso(), prefixo || '');
    }
    E.etapa = 'abertura'; E.assunto = 'provar'; E.v = { passo: 'cidade', cidade: null, bairro: null, dia: null, periodo: null };
    return perguntarPasso('cidade', prefixo || '');
  }
  // Espelha normalizarTelefone de supabase/functions/assistente/logica.ts
  function normalizarTel(t) {
    var d = String(t == null ? '' : t).replace(/\D/g, '');
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) return null;
    var ddd = Number(d.slice(0, 2));
    if (d.charAt(0) === '0' || ddd < 11 || ddd > 99) return null;
    if (d.length === 11 && d.charAt(2) !== '9') return null;
    if (/^(\d)\1+$/.test(d)) return null;
    return d;
  }
  function mascararTel(d) { return '(' + d.slice(0, 2) + ') ' + d.charAt(2) + '•••-•' + d.slice(-3); }
  function aoChipVisita(c) {
    if (c.id === 'fabrica') return irFabrica();
    if (c.id === 'vendedor') return iniciarVendedor(T.visitaIntro);
    if (!E.v) return puriDiz(T.incertoAb, CH.abertura);
    if (c.id === 'v_voltar') {
      var vp = E.v.passo, ant = V_ANTES[vp] ? passoSeg(vp, V_ANTES) : (vp === 'cidade' ? null : primeiroPasso());
      if (ant) return perguntarPasso(ant);
      if (emFinal()) { soVisita(); return puriDiz(FALA_DEST[destinoAtual()], chipsDestino()); } // volta à tela do destino
      return irPara('provar');
    }
    if (c.id === 'v_pular' && E.v.passo === 'bairro') { E.v.bairro = E.v.bairro || ''; return perguntarPasso('dia'); }
    if (c.id === 'cid_outra') { var dentro = emFinal(); fimVisita(); if (!dentro) E.assunto = 'provar'; return puriDiz(T.foraCidade, CHIPS_FORA); }
    if (CIDADES[c.id]) { E.v.cidade = CIDADES[c.id]; return perguntarPasso(passoSeg('cidade', V_PROX)); }
    if (/^dia_/.test(c.id)) { E.v.dia = c.id.slice(4); return perguntarPasso('periodo'); }
    if (c.id === 'per_manha' || c.id === 'per_tarde') { E.v.periodo = c.id === 'per_manha' ? 'manha' : 'tarde'; return perguntarPasso('nome'); }
    if (c.id === 'corrigir') return iniciarVendedor('');
    if (c.id === 'confirmar') return (!vNome || !vTel) ? iniciarVendedor(T.perdi) : enviarVisita();
    return puriDiz(T.incertoAb, CH.abertura);
  }
  // Texto digitado durante o fluxo da visita: vai para o campo pedido, nunca para a Edge `mensagem`.
  function enviarCampo() {
    var g = ger, r = enviarCampoPasso();
    if (!r || !r.then) return;
    ocupado = true; atualizarCampo(); // segundo Enter só vale depois da fala do passo; o texto fica no campo
    var fim = function () { if (g !== ger) return; ocupado = false; atualizarCampo(); if (aberto) focarEntrada(); };
    r.then(fim, fim);
  }
  function enviarCampoPasso() {
    var p = E.v.passo, texto = limpar(campo.value);
    if (!texto) return;
    campo.value = ''; campo.style.height = 'auto';
    if (p === 'bairro') {
      if (texto.length < 2 || texto.length > 60) return puriDiz(T.bairroRuim, [CH.humano]); // mesmo limite do servidor
      E.v.bairro = mascararObj(texto); usuarioDiz(texto); return perguntarPasso('dia');
    }
    if (p === 'nome') {
      if (texto.length < 2 || texto.length > 80) return puriDiz(T.nomeRuim, [CH.humano]);
      vNome = texto; usuarioDiz(texto, '(nome informado)'); return perguntarPasso('tel');
    }
    if (p === 'tel') {
      var d = normalizarTel(texto);
      if (!d) return puriDiz(T.telRuim, [CH.humano]); // não ecoa o número inválido
      vTel = d; usuarioDiz(mascararTel(d));
      return perguntarPasso('confirma');
    }
    if (p === 'cidade') {
      var cd = cidadeLocal(texto);
      if (cd) { E.v.cidade = cd; usuarioDiz(texto); return perguntarPasso(passoSeg('cidade', V_PROX)); }
    } else if (p === 'dia') {
      var rd = lerDia(texto);
      if (rd === 'fds') { usuarioDiz(texto); return puriDiz(T.diaUtil, chipsPasso(p)); }
      if (rd) { E.v.dia = rd; usuarioDiz(texto); return perguntarPasso('periodo'); }
    } else if (p === 'periodo') {
      var np = sa(texto);
      if (/manha|cedo/.test(np) !== /tarde/.test(np)) { E.v.periodo = /tarde/.test(np) ? 'tarde' : 'manha'; usuarioDiz(texto); return perguntarPasso('nome'); }
    }
    return puriDiz(T.escolhe, chipsPasso(p)); // não entendeu: não ecoa o texto
  }
  // Dia da visita a partir do texto bruto, por lista branca. Na dúvida devolve null (chips Seg-Sex); nunca grava dia errado.
  // Devolve 'seg'|'ter'|'qua'|'qui'|'sex' (só se TODAS as palavras são dia útil ou enchimento e há um único dia útil),
  // 'fds' (sem dia útil e com palavra de fim de semana; só responde "a visita é de segunda a sexta", não grava nada) ou null.
  function lerDia(texto) {
    var t = ' ' + sa(String(texto || '')).replace(/[^a-z]+/g, ' ').trim() + ' ';
    t = t.replace(/ fim de semana(?= )/g, ' fds');
    var w = t.split(' ').filter(Boolean);
    var UTIL = { segunda: 'seg', seg: 'seg', terca: 'ter', ter: 'ter', quarta: 'qua', qua: 'qua', quinta: 'qui', qui: 'qui', sexta: 'sex', sex: 'sex' };
    var FDS = { sabado: 1, sabados: 1, sabadao: 1, sab: 1, domingo: 1, domingos: 1, domingao: 1, dom: 1, fds: 1 };
    var ENCH = {};
    'pode ser pra para na no a o de da do feira manha tarde cedo prefiro prefere quero melhor dia que vem proxima proximo sim ok entao acho essa esse eu fica bom bem otimo'.split(' ').forEach(function (x) { ENCH[x] = 1; });
    var dias = {}, nDias = 0, fds = false, tudo = w.length > 0, i;
    // "ter" também é verbo ("pode ter"): só vale como terça se for a mensagem inteira ("ter" ou "ter feira")
    var terSolo = t === ' ter ' || t === ' ter feira ';
    for (i = 0; i < w.length; i++) {
      if (w[i] === 'ter' && !terSolo) { tudo = false; continue; }
      if (UTIL[w[i]]) { if (!dias[UTIL[w[i]]]) { dias[UTIL[w[i]]] = 1; nDias++; } }
      else { if (FDS[w[i]]) fds = true; if (!ENCH[w[i]]) tudo = false; }
    }
    if (tudo && nDias === 1) return Object.keys(dias)[0];
    if (nDias === 0 && fds) return 'fds';
    return null;
  }
  function enviarVisita() {
    var g = ger, v = E.v;
    ocupado = true; atualizarCampo();
    var corpo = { cidade: v.cidade, bairro: v.bairro, dia: v.dia, periodo: v.periodo, nome: vNome, telefone: vTel };
    garantirToken(g).then(function (ok) {
      if (g !== ger) return;
      if (ok === 'limite') { fimVisita(); return falhaF6(); }
      if (ok !== 'ok') return falhaTemp();
      return api.visita(E.token, corpo).then(function (r) { return tratarVisita(r, corpo, g, false); });
    }).catch(function () { if (g === ger) return falhaTemp(); }).then(function () {
      if (g !== ger) return;
      ocupado = false; atualizarCampo(); if (aberto) focarEntrada();
    });
  }
  function tratarVisita(r, corpo, g, tok) {
    if (g !== ger) return;
    var pos = emFinal() ? [{ id: 'r_criar', t: 'Criar minha conta também' }, CH_RESUMO, CH_RECOMECAR] : [{ id: 'duvida', t: 'Tirar uma dúvida' }, { id: 'revender', t: 'Quero revender' }];
    if (r && r.ok) { fimVisita(); salvar(); return puriDiz(T.visitaOk, pos); }
    var m = r && r.motivo;
    if (m === 'ja_pedida') { fimVisita(); salvar(); return puriDiz(T.visitaJa, pos); }
    if (m === 'cidade_fora') { fimVisita(); salvar(); return puriDiz(T.foraCidade, CHIPS_FORA); }
    if (m === 'dados_invalidos') { return iniciarVendedor(T.visitaDados); } // recomeça do primeiro passo
    if (ehLimite(m)) { fimVisita(); return falhaF6(); }
    if (m === 'token_invalido' && !tok) {
      E.token = null; salvar();
      return garantirToken(g).then(function (ok) {
        if (g !== ger) return;
        if (ok === 'limite') { fimVisita(); return falhaF6(); }
        if (ok !== 'ok') return falhaTemp();
        return api.visita(E.token, corpo).then(function (r2) { return tratarVisita(r2, corpo, g, true); });
      });
    }
    return falhaTemp(); // erro | timeout | rede
  }

  // ---- F4: revender (um passo por vez; ROTEIRO F4 passos 1-5 e 10) ----
  var rRetry = null, escTimer = 0, escVoo = false, escUltimo = '';
  var FORA = 'Entregamos só em Cuiabá e Várzea Grande. De outra cidade, dá pra revender retirando na fábrica.';
  var FALA_R = {
    segmento: 'Que tipo de negócio você tem (ou quer ter)?', segmento_sug: 'Acho que é um destes. Qual chega mais perto?',
    ja_vende: QUALIF.ja_vende.fala, cidade: 'Em que cidade?', cidade_outra: 'Qual cidade?', retira: 'Consegue retirar na fábrica em Cuiabá?',
    bairro: 'E o bairro?', objetivo: 'O que você quer com a revenda? Pode contar do seu jeito.', confirma_acai: 'Você quer mesmo vender açaí?', espera_nome: 'Quer entrar na nossa lista de espera? Assim que a Dupuro chegar aí, a gente te avisa. Qual é o seu nome?', espera_tel: 'E o seu WhatsApp com DDD?',
    contato_nome: 'Pra gente te chamar, qual é o seu nome?', contato_tel: 'E o seu WhatsApp com DDD?',
    movimento: 'Quantos copos por dia você vende (ou imagina vender)?', esclarecer: 'Pode me contar um pouco mais?',
    compra: 'Como você pensa em comprar no começo?', comeco: QUALIF.comeco.fala, papel: QUALIF.papel.fala, conheceu: QUALIF.conheceu.fala
  };
  var T_NAO_ENTENDI = 'Não entendi direitinho. Toca numa das opções ou escreve de outro jeito.';
  var T_MOV_PADRAO = 'Sem problema! Usei até 20 copos por dia na conta. Dá pra ajustar depois.';
  var SAIDA_ESC = { id: 'r_sd_escrever', t: 'Escrever com as minhas palavras' }, SAIDA_NS = { id: 'r_sd_naosei', t: 'Não sei, e tudo bem' }, SAIDA_PULAR = { id: 'r_sd_pular', t: 'Prefiro pular esta' };
  var COM_SAIDAS = ['segmento', 'segmento_sug', 'ja_vende', 'movimento', 'compra', 'sim', 'comeco', 'papel', 'conheceu', 'esclarecer']; // passos de botões que ganham as saídas (cidade só ganha "escrever"; retira/confirma_acai não)
  var interpFalhas = {}, vEsp = null, compraTimer = 0; // só em memória (vEsp: nome/WhatsApp da lista de espera)
  var T_SIM = 'Fiz uma conta rápida com o seu movimento.';
  var T_SEM_CUSTO = 'Não consegui puxar o preço do atacado agora. Mostro só quanto você vende por caixa.';
  var T_REGRAS = 'Como funciona: o primeiro pedido não tem mínimo; depois, pedidos a partir de 30 L (3 caixas de 10 L ou 6 de 5 L). Granola e complementos não entram na conta. Entregamos em Cuiabá e Várzea Grande, ou você retira na fábrica.';
  function sa(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function fmtR(v) {
    var n = Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : v.toFixed(2).replace('.', ',');
    var p = n.split(','); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + p.join(',');
  }
  function opcoesPasso(p) { // opções lógicas [{id, rotulo}] do passo de botões (as mesmas que vão ao servidor no `interpretar`)
    var r = E.r || {};
    if (QUALIF[p]) return QUALIF[p].opts.map(function (o) { return { id: o[0], rotulo: o[1] }; });
    switch (p) {
      case 'segmento': case 'segmento_sug': return SEG_CHIPS.map(function (s) { return { id: s[0], rotulo: s[1] }; });
      case 'movimento': return MOV_CHIPS.map(function (m) { return { id: m[0], rotulo: m[1] }; });
      case 'compra': return r.compraOp || COMPRA_PADRAO;
      case 'retira': return [{ id: 'sim', rotulo: 'Sim, consigo retirar' }, { id: 'nao', rotulo: 'Não consigo' }];
      case 'confirma_acai': return [{ id: 'sim', rotulo: 'Sim, quero vender açaí' }, { id: 'nao', rotulo: 'Não, era outra coisa' }, { id: 'consumo', rotulo: 'Na verdade quero comprar pra mim' }];
      case 'sim': return PRECOS.map(function (n) { return { id: 'preco_' + n, rotulo: 'R$ ' + n }; }).concat([{ id: 'continuar', rotulo: 'Continuar' }]);
    }
    return [];
  }
  function saidasR(p) {
    var l = [];
    if (p === 'cidade') return [SAIDA_ESC];
    if (COM_SAIDAS.indexOf(p) < 0) return l;
    if (p !== 'esclarecer') l.push(SAIDA_ESC);
    if (!(p === 'compra' && opcoesPasso('compra').some(function (o) { return o.id === 'nao_sei'; }))) l.push(SAIDA_NS);
    if (p !== 'sim') l.push(SAIDA_PULAR);
    return l;
  }
  function chipsR(p) {
    var base = [];
    switch (p) {
      case 'segmento': case 'segmento_sug': base = SEG_CHIPS.map(function (s) { return { id: 'r_seg_' + s[0], t: s[1] }; }); break;
      case 'ja_vende': case 'comeco': case 'papel': case 'conheceu': base = QUALIF[p].opts.map(function (o) { return { id: 'r_q_' + p + '_' + o[0], t: o[1] }; }); break;
      case 'cidade': base = [{ id: 'r_cid_cuiaba', t: 'Cuiabá' }, { id: 'r_cid_vg', t: 'Várzea Grande' }, { id: 'r_cid_outra', t: 'Outra cidade' }]; break;
      case 'cidade_outra': base = [{ id: 'r_cid_cuiaba', t: 'Cuiabá' }, { id: 'r_cid_vg', t: 'Várzea Grande' }]; break;
      case 'espera_nome': case 'espera_tel': return [CH.humano];
      case 'contato_nome': case 'contato_tel': return [{ id: 'r_contato_voltar', t: 'Voltar' }];
      case 'retira': return [{ id: 'r_rt_sim', t: 'Sim, consigo retirar' }, { id: 'r_rt_nao', t: 'Não consigo' }];
      case 'bairro': case 'objetivo': return [{ id: 'r_pular', t: 'Pular' }];
      case 'confirma_acai': return [{ id: 'r_ac_sim', t: 'Sim, quero vender açaí' }, { id: 'r_ac_nao', t: 'Não, era outra coisa' }, { id: 'r_ac_consumo', t: 'Na verdade quero comprar pra mim' }];
      case 'movimento': base = MOV_CHIPS.map(function (m) { return { id: 'r_mv_' + m[0], t: m[1] }; }); break;
      case 'compra': base = opcoesPasso('compra').map(function (o) { return { id: 'r_cp_' + o.id, t: o.rotulo }; }); break;
      case 'sim': base = PRECOS.map(function (n) { return { id: 'r_preco_' + n, t: 'R$ ' + n }; }).concat([{ id: 'r_continuar', t: 'Continuar' }]); break;
    }
    return base.concat(saidasR(p));
  }
  function perguntarR(p, prefixo) {
    if (!E.r) return;
    E.r.passo = p; rRetry = null; salvar(); // avançou de passo: "Tentar de novo" nunca refaz um passo antigo
    if (p !== 'objetivo') { clearTimeout(escTimer); limparNotas(); }
    clearTimeout(compraTimer);
    var pr = puriDiz((prefixo ? prefixo + ' ' : '') + FALA_R[p], chipsR(p));
    if (p === 'compra') pr = pr.then(function () { agendarExplicacao(); });
    return pr;
  }
  function iniciarR() {
    limparVisita(); E.etapa = 'abertura'; E.assunto = 'revender'; interpFalhas = {};
    E.r = { passo: 'segmento', segmento: null, cidade: null, bairro: null, movimento: null, preco: null, sim: null, escN: 0 };
    return perguntarR('segmento');
  }
  // Passo `compra`: se a pessoa não responder em 7 s, a Puri comenta a `explicacao` do servidor (uma vez só, aba visível)
  function agendarExplicacao() {
    clearTimeout(compraTimer);
    var r = E.r, g = ger;
    if (!r || r.passo !== 'compra' || !r.compraExp) return;
    var texto = r.compraExp;
    compraTimer = setTimeout(function () {
      if (g !== ger || !E.r || E.r.passo !== 'compra' || ocupado || document.hidden || E.r.expDita) return;
      if (campo && campo.value.trim()) return; // está digitando: não interrompe
      E.r.expDita = true;
      puriDiz(texto, E.chips.slice());
    }, 7000);
  }
  // Roda fn(g) com o campo travado; falhas viram "Tentar de novo" (rRetry refaz o mesmo passo).
  function rede(fn) {
    var g = ger; ocupado = true; atualizarCampo();
    var falhou = false;
    return Promise.resolve().then(function () { return fn(g); }).catch(function () { falhou = true; if (g === ger) return falhaTemp(); }).then(function () {
      if (g !== ger) return;
      if (!falhou && !E.chips.some(function (c) { return c.id === 'retry'; })) rRetry = null; // concluiu sem "Tentar de novo" na tela: nada a refazer
      ocupado = false; atualizarCampo(); if (aberto) focarEntrada();
    });
  }
  function rodarR(fn) { rRetry = function () { return rede(fn); }; return rede(fn); }
  // Chamada da Edge `revenda`: garante token, renova uma vez se token_invalido.
  // tokFixo (opcional): envia com esse token, sem passar por garantirToken e sem renovar (usado no 'consumo', cujo token já foi descartado).
  function chamarR(corpo, g, tok, tokFixo) {
    return (tokFixo ? Promise.resolve('ok') : garantirToken(g)).then(function (ok) {
      if (g !== ger) return { velho: true };
      if (ok === 'limite') return { limite: true };
      if (ok !== 'ok') return { temp: true };
      return api.revenda(tokFixo || E.token, corpo).then(function (r) {
        if (g !== ger) return { velho: true };
        if (r && r.ok) return { r: r };
        var m = r && r.motivo;
        if (ehLimite(m)) return { limite: true, motivo: m };
        if (m === 'token_invalido' && !tok && !tokFixo) { E.token = null; salvar(); return chamarR(corpo, g, true); }
        if (m === 'limite_ajuste') return { ajuste: true };
        return { temp: true, motivo: m };
      });
    });
  }
  function falhaR(x) {
    if (!x || x.velho) return;
    if (x.limite) return falhaF6(); // limite: mantém os dados da revenda no estado (só "Recomeçar" limpa)
    return falhaTemp();
  }
  function segTexto(texto, g) {
    return chamarR({ passo: 'segmento', texto: texto }, g).then(function (x) {
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var s = temSeg(x.r.segmento) ? x.r.segmento : 'outro', conf = Number(x.r.confianca);
      rRetry = null;
      var sug0 = (Array.isArray(x.r.sugestoes) ? x.r.sugestoes : []).filter(function (k, i, a) { return temSeg(k) && a.indexOf(k) === i; }).length;
      if (s === 'outro' && !E.r.tipoPerg && !sug0) { // tipo vago sem sugestões do servidor: pergunta uma vez com a lista fixa
        E.r.tipoPerg = true; E.r.passo = 'segmento_sug'; salvar();
        var cv = SEG_CHIPS.filter(function (k) { return k[0] !== 'outro'; }).map(function (k) { return { id: 'r_seg_' + k[0], t: SEG_LABEL[k[0]] }; }).concat([{ id: 'r_seg_outro', t: 'É outro tipo mesmo' }], saidasR('segmento_sug').slice(0, 1));
        return puriDiz('Que tipo de negócio é?', cv);
      }
      var sug = (Array.isArray(x.r.sugestoes) ? x.r.sugestoes : []).filter(function (k, i, a) { return temSeg(k) && a.indexOf(k) === i; }).slice(0, 3);
      if (sug.length && ((isFinite(conf) && x.r.confianca != null && conf < 0.7) || (s === 'outro')) && !E.r.tipoPerg) {
        E.r.tipoPerg = true; // confiança baixa: a pessoa escolhe entre as sugestões (ou "Outro")
        E.r.passo = 'segmento_sug'; salvar();
        var ch = sug.map(function (k) { return { id: 'r_seg_' + k, t: SEG_ROT[k].charAt(0).toUpperCase() + SEG_ROT[k].slice(1) }; }).concat([{ id: 'r_seg_outro', t: 'Outro' }], saidasR('segmento_sug').slice(0, 1));
        return puriDiz(FALA_R.segmento_sug, ch);
      }
      E.r.segmento = s;
      return perguntarR('ja_vende', 'Anotei: ' + SEG_ROT[s] + '.');
    });
  }
  function cidadeLocal(texto) { var n = sa(texto); return /cuiab/.test(n) ? 'Cuiabá' : (/varzea|\bvg\b/.test(n) ? 'Várzea Grande' : null); }
  function definirCidade(texto) {
    var c = cidadeLocal(texto);
    if (c) { E.r.cidade = c; E.r.retira = false; return perguntarR('bairro', ''); }
    E.r.cidade = texto.slice(0, 60); E.r.retira = false; // outra cidade: fora da área de entrega
    return perguntarR('retira', 'Por enquanto a gente entrega só em Cuiabá e Várzea Grande.');
  }
  function perfilR(g) {
    var r = E.r, corpo = { passo: 'perfil', segmento: r.segmento || 'outro', cidade: r.cidade || 'Cuiabá', movimento: r.movimento };
    if (r.bairro) corpo.bairro = r.bairro;
    if (r.retira) corpo.retira = true;
    return chamarR(corpo, g).then(function (x) {
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var esc = x.r.esclarecer && typeof x.r.esclarecer === 'object' ? sanTxt(x.r.esclarecer.pergunta, 200) : '';
      var ir = function () { return esc ? esclarecerR(esc) : compraR(g); };
      if (x.r.fora_area === true && !E.r.retira) return puriDiz(FORA).then(function () { return g === ger && E.r ? ir() : null; });
      return ir();
    });
  }
  // movimento -> perfil: se os dados não baterem, a Puri faz uma pergunta (campo livre + saídas)
  function esclarecerR(pergunta) {
    E.r.passo = 'esclarecer'; rRetry = null; salvar();
    return puriDiz(pergunta, chipsR('esclarecer'), undefined, 'esc');
  }
  function esclarecerResp(texto) { // texto: resposta livre; null = "Não sei"/"Pular"
    var g = ger;
    if (texto) { try { chamarR({ passo: 'esclarecer_resp', texto: String(texto).slice(0, 300) }, g).catch(function () {}); } catch (e) {} }
    return rodarR(function (g2) { return compraR(g2); });
  }
  // passo compra: opções do servidor (`opcoes_compra`); sem servidor novo, as 3 padrão
  function compraR(g) {
    rRetry = function () { return rede(compraR); };
    E.r.passo = 'compra'; E.r.compraOp = null; E.r.compraExp = null; limparChips(); E.chips = []; salvar();
    return chamarR({ passo: 'opcoes_compra' }, g).then(function (x) {
      if (x.velho) return;
      if (x.limite) return falhaR(x);
      if (!E.r) return;
      if (x.r) { E.r.compraOp = sanOpcoes(x.r.opcoes); E.r.compraExp = sanTxt(x.r.explicacao, 200) || null; }
      rRetry = null;
      return perguntarR('compra');
    });
  }
  // Qualificação (ja_vende, compra, comeco, papel, conheceu): grava no servidor sem travar o fluxo
  function qualifR(campo, valor, texto) {
    if (E.r && QR_CAMPOS.indexOf(campo) >= 0) { // rótulo legível para o painel "Seu caso" (pulou/texto ficam sem rótulo = "—")
      var rot = valor === 'nao_sei' ? 'Não sabe' : '';
      if (!rot) { var ops = campo === 'compra' ? opcoesPasso('compra').map(function (o) { return [o.id, o.rotulo]; }) : (QUALIF[campo] ? QUALIF[campo].opts : []); ops.forEach(function (o) { if (o[0] === valor) rot = o[1]; }); }
      E.r.qr = E.r.qr || {}; if (rot) E.r.qr[campo] = sanTxt(rot, 60); else delete E.r.qr[campo]; salvar();
    }
    var c = { passo: 'qualif', campo: campo, valor: valor };
    if (valor === 'texto' && texto) c.texto = String(texto).slice(0, 200);
    try { chamarR(c, ger).catch(function () {}); } catch (e) {}
  }
  function simR(preco, g, fala) {
    return chamarR({ passo: 'simulacao', preco_copo: preco }, g).then(function (x) {
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var s = sanSim(x.r.simulacao);
      if (!s) return falhaTemp();
      s.preco_copo = preco;
      E.r.preco = preco; E.r.sim = s; E.r.passo = 'sim'; rRetry = null; salvar();
      var ficha = function () {
        if (g !== ger) return;
        Array.prototype.forEach.call(msgs.querySelectorAll('.puri-sim'), function (n) { n.remove(); });
        limparChips(); msgs.appendChild(cartaoSim(s, true)); E.chips = chipsR('sim'); salvar(); desenharChips(E.chips); rolar();
      };
      if (s.custo_caixa == null) fala = T_SEM_CUSTO;
      if (fala) return puriDiz(fala, []).then(ficha);
      ficha();
    });
  }
  function cartaoSim(s, animar) {
    var c = el('div', 'puri-sim'); c.setAttribute('role', 'group'); c.setAttribute('aria-label', 'Simulação por caixa');
    function lin(cls, partes) {
      var p = el('p', 'puri-sim-l' + (cls ? ' ' + cls : ''));
      partes.forEach(function (x) { if (typeof x === 'string') p.appendChild(document.createTextNode(x)); else p.appendChild(el('strong', 'puri-sim-n', x.n)); });
      c.appendChild(p);
    }
    lin('puri-sim-t', ['1 caixa de 10 L ≈ ' + Math.round(s.copos_caixa || 20) + ' copos de 500 ml']);
    if (s.venda_caixa != null) lin('', ['Vendendo a ' + fmtR(s.preco_copo) + ': ', { n: fmtR(s.venda_caixa) }, ' por caixa']);
    if (s.custo_caixa != null) {
      lin('', ['A caixa sai ', { n: fmtR(s.custo_caixa) }, ' no atacado']);
      if (s.sobra_caixa != null) lin('puri-sim-sobra', ['Sobra ≈ ', { n: fmtR(s.sobra_caixa) }, ' por caixa']);
      if (s.caixas_semana != null && s.sobra_semana != null) lin('', ['No seu movimento: ≈ ', { n: Math.round(s.caixas_semana) + ' caixas' }, ' por semana → ≈ ', { n: fmtR(s.sobra_semana) }, ' por semana']);
    }
    var nok = function (x) { return typeof x === 'number' && isFinite(x); };
    if (nok(s.venda_caixa) && nok(s.custo_caixa) && nok(s.sobra_caixa) && s.venda_caixa > 0) {
      var bar = el('div', 'puri-sim-barras'); bar.setAttribute('aria-hidden', 'true'); // os mesmos números já estão no texto acima
      var fills = [];
      [['Venda', s.venda_caixa, 'venda'], ['Custo', s.custo_caixa, 'custo'], ['Sobra', s.sobra_caixa, 'sobra']].forEach(function (b) {
        var pct = Math.max(0, Math.min(100, b[1] / s.venda_caixa * 100));
        var linha = el('div', 'puri-sim-barra'), trilho = el('span', 'puri-sim-trilho'), fill = el('i', b[2]);
        fill.style.width = (animar && !REDUZIDO) ? '0%' : pct + '%'; fills.push([fill, pct]);
        trilho.appendChild(fill);
        linha.appendChild(el('span', 'puri-sim-bl', b[0])); linha.appendChild(trilho); linha.appendChild(el('span', 'puri-sim-bv', fmtR(b[1])));
        bar.appendChild(linha);
      });
      c.appendChild(bar);
      if (animar && !REDUZIDO) requestAnimationFrame(function () { requestAnimationFrame(function () { fills.forEach(function (f) { f[0].style.width = f[1] + '%'; }); }); });
    }
    c.appendChild(el('p', 'puri-sim-nota', 'Estimativa, sem contar copo, cobertura e outros custos.'));
    return c;
  }
  // Escuta ao vivo (passo "objetivo"): debounce 1200 ms, 1 chamada em voo, resposta velha descartada.
  function limparNotas() { escUltimo = ''; notasAnt = []; if (notasBox) { notasBox.hidden = true; notasBox.textContent = ''; } }
  var notasAnt = [], I_CHECK = 'M5 12.5l4.5 4.5L19 7';
  function mostrarNotas(arr) {
    var ul = el('ul'), novoI = -1, atual = [];
    arr.slice(0, 6).forEach(function (a) {
      if (typeof a !== 'string' || !a.trim()) return;
      var t = a.trim().slice(0, 120), li = el('li'), ck = icone(I_CHECK);
      ck.setAttribute('class', 'puri-ck'); li.appendChild(ck); li.appendChild(el('span', null, t)); ul.appendChild(li); atual.push(t);
      if (notasAnt.length && notasAnt.indexOf(t) < 0) novoI = ul.children.length - 1; // o mais novo = último que não estava antes
    });
    if (!ul.children.length) return;
    if (novoI >= 0) ul.children[novoI].className = 'puri-nova';
    notasAnt = atual;
    ultimaNota = ul.lastChild.textContent; atualizarCaso();
    notasBox.textContent = ''; notasBox.appendChild(el('strong', null, 'O que já anotamos')); notasBox.appendChild(ul); notasBox.hidden = false;
  }
  function agendarEscuta() {
    clearTimeout(escTimer);
    if (!E.r || E.r.passo !== 'objetivo') return;
    var t = limpar(campo.value);
    if (t.length < 25 || t.length - escUltimo.length < 20 || (E.r.escN || 0) >= 4) return;
    escTimer = setTimeout(function () { escutar(t); }, 1200);
  }
  function escutar(t) {
    if (escVoo || ocupado || !E.r || E.r.passo !== 'objetivo') return;
    if ((E.r.escN || 0) >= 4) return;
    var g = ger; escVoo = true; escUltimo = t; E.r.escN = (E.r.escN || 0) + 1; salvar();
    chamarR({ passo: 'escutar', texto: t, final: false }, g).then(function (x) {
      if (g !== ger || ocupado || !E.r || E.r.passo !== 'objetivo') return;
      if (x.r && Array.isArray(x.r.anotacoes) && x.r.anotacoes.length) mostrarNotas(x.r.anotacoes);
    }).catch(function () {}).then(function () { escVoo = false; agendarEscuta(); });
  }
  function esperaEscuta() { return new Promise(function (ok) { (function t(n) { if (!escVoo || n > 60) return ok(); setTimeout(function () { t(n + 1); }, 100); })(0); }); }
  function objetivoFinal(texto, g) {
    return esperaEscuta().then(function () {
      if (g !== ger) return null;
      return chamarR({ passo: 'escutar', texto: texto, final: true }, g);
    }).then(function (x) {
      if (!x || g !== ger || !E.r) return;
      if (!x.r) return falhaR(x);
      rRetry = null;
      var an = Array.isArray(x.r.anotacoes) ? x.r.anotacoes.filter(function (a) { return typeof a === 'string' && a.trim(); }).slice(0, 6).map(function (a) { return a.trim().replace(/[.\s]+$/, ''); }) : [];
      if (an.length) ultimaNota = an[an.length - 1].slice(0, 120);
      var nota = an.length ? 'Anotei: ' + an.join('; ') + '.' : 'Anotado.', cena = sanCena(x.r.cena);
      if (cena) E.r.cena = cena; // cena do servidor (desenhada depois da anotação; sem ela, comportamento antigo)
      if (x.r.nao_acai === true) {
        if (!cena) return perguntarR('confirma_acai', nota);
        return puriDiz(nota, []).then(function () { return g === ger && E.r ? perguntarR('confirma_acai') : null; });
      }
      if (!cena) return perguntarR('movimento', nota);
      return puriDiz(nota, []).then(function () {
        if (g !== ger || !E.r) return;
        inserirCena();
        return perguntarR('movimento');
      });
    });
  }
  // ---- F4 passos 6-8: aprofundamento, palpite, resumo (tudo da IA entra só por textContent, com corte defensivo) ----
  function pontos() {
    if (REDUZIDO) return function () {};
    var d = el('div', 'puri-b p puri-dig'); d.setAttribute('aria-hidden', 'true');
    d.appendChild(el('i')); d.appendChild(el('i')); d.appendChild(el('i'));
    msgs.appendChild(d); rolar();
    return function () { d.remove(); };
  }
  // Fio em segundo plano: `aprofundar` sai ao responder `comeco`; o `palpite` só depois do aprofundar_resp (ou de pular); o resultado fica em memória até o passo aprof.
  var bg = {};
  function bgR(k, corpo, g, efeito) {
    var s = bg[k]; if (s && s.g === g) return s.p;
    var p = chamarR(corpo, g).catch(function () { return { temp: true }; }).then(function (x) { try { if (efeito && x && x.r && g === ger && E.r) efeito(x.r); } catch (e) {} return x; });
    bg[k] = { g: g, p: p }; return p;
  }
  function usaBgR(k, corpo, g) { // usa o que já foi disparado; se falhou, chama de novo uma vez
    var via = !!(bg[k] && bg[k].g === g);
    return bgR(k, corpo, g).then(function (x) {
      delete bg[k];
      if (!x.r && !x.velho && !x.limite && via) return chamarR(corpo, g);
      return x;
    });
  }
  function efeitoAp(r) {
    var q = sanTxt(r.pergunta, 200);
    if (q) { E.r.ap = { p: q, rs: (Array.isArray(r.respostas) ? r.respostas : []).map(function (t) { return sanTxt(t, 60); }).filter(Boolean).slice(0, 4) }; return; }
    E.r.apOk = true; salvar(); dispararPal(ger); // sem pergunta: já adianta o palpite
  }
  function dispararAp(g) { if (E.r && !E.r.apOk && !E.r.ap) bgR('ap', { passo: 'aprofundar' }, g, efeitoAp); }
  function dispararPal(g) { if (E.r && !E.r.palOk) bgR('pal', { passo: 'palpite' }, g); }
  var CH_AP_PULAR = { id: 'r_ap_pular', t: 'Prefiro pular esta' };
  function aprofR(g) {
    rRetry = function () { return rede(aprofR); };
    E.r.passo = 'aprof'; limparChips(); E.chips = []; salvar();
    if (E.r.apOk) return palpiteR(g);
    var off = pontos();
    return usaBgR('ap', { passo: 'aprofundar' }, g).then(function (x) {
      off();
      if (x.velho) return;
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var q = sanTxt(x.r.pergunta, 200);
      if (!q) { E.r.apOk = true; return palpiteR(g); }
      var rs = (Array.isArray(x.r.respostas) ? x.r.respostas : []).map(function (t) { return sanTxt(t, 60); }).filter(Boolean).slice(0, 4);
      E.r.ap = { p: q, rs: rs }; rRetry = null;
      return puriDiz(q, rs.map(function (t, i) { return { id: 'r_ap_' + i, t: t }; }).concat([CH_AP_PULAR]), undefined, 'aprof');
    });
  }
  function aprofResp(texto) {
    texto = String(texto || '').slice(0, 300);
    E.r.apOk = true; salvar();
    return rodarR(function (g) {
      return chamarR({ passo: 'aprofundar_resp', texto: texto }, g).then(function (x) {
        if (!x.r) return falhaR(x);
        if (!E.r) return;
        return palpiteR(g);
      });
    });
  }
  function palpiteR(g) {
    rRetry = function () { return rede(palpiteR); };
    E.r.passo = 'palpite'; limparChips(); E.chips = []; salvar();
    var off = pontos();
    return usaBgR('pal', { passo: 'palpite' }, g).then(function (x) {
      off();
      if (x.velho) return;
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var p = sanTxt(x.r.palpite, 220);
      if (!p) { E.r.palOk = true; return resumoR(g); }
      rRetry = null;
      return puriDiz(p, [{ id: 'r_pp_mosca', t: 'Na mosca' }, { id: 'r_pp_parte', t: 'Em parte' }, { id: 'r_pp_nao', t: 'Não, é outra coisa' }], undefined, 'palp');
    });
  }
  var FALA_PARTE = 'O que está faltando ou diferente?', CH_PP_PULAR = { id: 'r_pp_pular', t: 'Prefiro pular esta' };
  function chipsAlt() {
    var l = (E.r && E.r.alt || []).map(function (t, i) { return { id: 'r_al_' + i, t: t }; });
    l.push({ id: 'r_al_n', t: 'Nenhuma, fica como eu escrevi' });
    return l;
  }
  function palpiteResp(valor, texto) {
    E.r.palOk = true; salvar();
    return rodarR(function (g) {
      var c = { passo: 'palpite_resp', valor: valor };
      if (texto) c.texto = String(texto).slice(0, 300);
      return chamarR(c, g).then(function (x) {
        if (!x.r) return falhaR(x);
        if (!E.r) return;
        var alt = texto && valor !== 'mosca' && Array.isArray(x.r.alternativas) ? x.r.alternativas.map(function (t) { return sanTxt(t, 160); }).filter(Boolean).slice(0, 3) : [];
        if (!alt.length) return resumoR(g);
        E.r.alt = alt; E.r.passo = 'palpite_alt'; rRetry = null; salvar();
        return puriDiz('Seria algo assim?', chipsAlt());
      });
    });
  }
  function palpiteEscolha(indice) {
    var alt = E.r.alt || []; if (indice != null && !alt[indice]) indice = null;
    E.r.alt = []; E.r.passo = 'resumo'; salvar();
    return rodarR(function (g) {
      return chamarR({ passo: 'palpite_escolha', indice: indice }, g).then(function (x) {
        if (x.velho) return;
        if (x.limite) return falhaR(x);
        if (!E.r) return;
        return resumoR(g); // falha do servidor: segue mesmo assim
      });
    });
  }
  var FALA_RS_COR = 'O que eu entendi errado?', CH_RS_PULAR = { id: 'r_rs_pular', t: 'Prefiro pular esta' };
  var CH_RS = [{ id: 'r_rs_ok', t: 'Isso mesmo' }, { id: 'r_rs_cor', t: 'Quero corrigir' }];
  function chipsResumo() { return E.r && E.r.resC ? [CH_RS[0]] : CH_RS; }
  function resumoR(g) {
    rRetry = function () { return rede(resumoR); };
    E.r.passo = 'resumo'; limparChips(); E.chips = []; salvar();
    var off = pontos();
    return chamarR({ passo: 'resumo' }, g).then(function (x) {
      off();
      if (x.velho) return;
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var re = sanTxt(x.r.resumo, 300);
      if (!re) return mapaR(g);
      E.r.resumo = re; E.r.problema = cortarPilula(x.r.problema, 40) || null; E.r.termo = sanTxt(x.r.termo, 40) || null; E.r.resI = E.msgs.length; rRetry = null; salvar();
      msgs.appendChild(cartaoResumo(E.r.resumo, E.r.problema, E.r.termo)); rolar();
      return puriDiz('Foi isso que eu entendi?', chipsResumo());
    });
  }
  function resumoCorrigir(texto) {
    return rodarR(function (g) {
      return chamarR({ passo: 'resumo_resp', valor: 'corrigir', texto: String(texto).slice(0, 300) }, g).then(function (x) {
        if (x.velho) return;
        if (x.limite) return falhaR(x);
        if (!E.r) return;
        E.r.resC = 1; rRetry = null;
        var re = x.r ? sanTxt(x.r.resumo, 300) : '';
        if (!re) { salvar(); return mapaR(g); } // falha do servidor: segue
        E.r.resumo = re; E.r.problema = cortarPilula(x.r.problema, 40) || E.r.problema; E.r.termo = sanTxt(x.r.termo, 40) || E.r.termo; salvar();
        return puriDiz('Corrigi. Veja como ficou.', []).then(function () {
          if (g !== ger || !E.r) return;
          Array.prototype.forEach.call(msgs.querySelectorAll('.puri-resumo'), function (n) { n.remove(); });
          E.r.resI = E.msgs.length; salvar();
          msgs.appendChild(cartaoResumo(E.r.resumo, E.r.problema, E.r.termo)); rolar();
          return mapaR(g);
        });
      });
    });
  }
  // ---- Mapa do caso (opcional: qualquer falha segue em silêncio para as regras) ----
  var FALA_MAPA_AJ = 'O que eu devo mudar no mapa?';
  var CH_MAPA_OK = { id: 'r_mp_ok', t: 'Está certo' }, CH_MAPA_PULAR = { id: 'r_mp_pular', t: 'Pular o mapa' };
  var FALA_MAPA_FALHA = 'Não consegui montar o mapa agora.';
  function sanMapa(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.nos)) return null;
    var nos = [], setas = [];
    m.nos.slice(0, 6).forEach(function (n, k) {
      if (!n || typeof n !== 'object' || TIPOS_MAPA.indexOf(n.tipo) < 0) return;
      var tx = sanTxt(n.texto, 70); if (!tx) return;
      if (nos.length) setas.push(Array.isArray(m.setas) && typeof m.setas[k - 1] === 'string' ? (sanTxt(m.setas[k - 1], 22) || null) : null); // seta que liga o nó anterior original a este (k-1)
      nos.push({ tipo: n.tipo, titulo: sanTxt(n.titulo, 24) || TIT_MAPA[n.tipo], texto: tx, ajustado: n.ajustado === true });
    });
    if (nos.length < 2) return null;
    return { nos: nos, setas: setas, simples: m.simples === true, ajustes: Math.min(2, Math.max(0, Math.floor(+m.ajustes) || 0)) };
  }
  function mapaEl(m, animar) {
    var c = el('div', 'puri-mapa'), ol = el('ol', 'puri-mapa-l'), nos = [];
    ol.setAttribute('aria-label', 'Mapa do caso');
    m.nos.forEach(function (n, i) {
      var li = el('li', 'puri-mapa-no puri-mapa-' + n.tipo + (n.ajustado ? ' aj' : '')), h = el('p', 'puri-mapa-h');
      h.appendChild(el('span', 'puri-mapa-ti', n.titulo));
      if (n.ajustado) h.appendChild(el('span', 'puri-mapa-ajt', 'Ajustado'));
      li.appendChild(h); li.appendChild(el('p', 'puri-mapa-tx', n.texto));
      ol.appendChild(li); nos.push(li);
      if (i < m.nos.length - 1) {
        var s = el('li', 'puri-mapa-seta');
        if (m.setas[i]) s.appendChild(el('span', 'puri-mapa-leg', m.setas[i])); // legenda lida pelo leitor de tela
        else s.setAttribute('aria-hidden', 'true'); // seta sem legenda é só enfeite
        ol.appendChild(s);
      }
    });
    c.appendChild(ol);
    if (animar && !REDUZIDO) {
      c.classList.add('anima');
      nos.forEach(function (li, i) { setTimeout(function () { li.classList.add('vis'); }, 120 + i * 100); });
      setTimeout(function () { c.classList.add('fim'); }, 120 + nos.length * 100 + 200);
    }
    return c;
  }
  function mapaChips(m) {
    var l = [CH_MAPA_OK];
    if (m.ajustes < 2) l.push({ id: 'r_mp_aj', t: m.ajustes ? 'Ajustar mais alguma coisa' : 'Quero ajustar' });
    l.push(CH_MAPA_PULAR);
    return l;
  }
  function mapaMostrar(m, fala) { // fala, depois o cartão, depois os chips
    return puriDiz(fala, []).then(function () {
      if (!E.r || (E.r.passo !== 'mapa' && E.r.passo !== 'mapa_txt')) return;
      try {
        var c = mapaEl(m, true); if (!c) throw 0;
        msgs.appendChild(c);
        E.r.mapas = (E.r.mapas || []).concat([{ i: E.msgs.length, m: m }]).slice(-3); E.r.mapaAj = m.ajustes; E.r.passo = 'mapa';
        rolar();
      } catch (e) { return irDestino(); }
      E.chips = mapaChips(m); salvar(); desenharChips(E.chips); atualizarCampo(); rolar();
    });
  }
  function mapaR(g) {
    rRetry = null;
    E.r.passo = 'mapa'; limparChips(); E.chips = []; salvar();
    var off = pontos();
    return chamarR({ passo: 'mapa' }, g).then(function (x) {
      off();
      if (x && x.velho) return;
      if (!E.r) return;
      var m = null;
      try { m = x.r ? sanMapa(x.r.mapa) : null; } catch (e) { m = null; }
      if (!m && x && x.limite) return falhaR(x);
      if (!m) return puriDiz(FALA_MAPA_FALHA, []).then(function () { return g === ger && E.r ? irDestino(g) : null; });
      return mapaMostrar(m, m.simples ? 'Montei um mapa mais simples do seu caso.' : 'Montei o mapa do seu caso. Confere?');
    }).catch(function () { off(); if (g === ger && E.r) return puriDiz(FALA_MAPA_FALHA, []).then(function () { return g === ger && E.r ? irDestino(g) : null; }); });
  }
  function mapaAjusteR(texto, g) { // um ajuste por vez: ajVoo bloqueia chips e envio até terminar
    if (ajVoo) return;
    ajVoo = true;
    var p = mapaAjusteInt(texto, g), fim = function () { ajVoo = false; };
    p.then(fim, fim);
    return p;
  }
  function mapaAjusteInt(texto, g) {
    rRetry = function () { return rede(function (g2) { return mapaAjusteR(texto, g2); }); };
    var off = pontos();
    return chamarR({ passo: 'mapa_ajuste', texto: texto }, g).then(function (x) {
      off();
      if (x.velho) return;
      if (!E.r) return;
      if (x.ajuste) { E.r.passo = 'mapa'; rRetry = null; return puriDiz('Já usei os dois ajustes que tenho. Se estiver certo, seguimos.', [CH_MAPA_OK]); }
      if (!x.r) return falhaR(x);
      var m = null;
      try { m = sanMapa(x.r.mapa); } catch (e) { m = null; }
      rRetry = null;
      if (!m || x.r.sem_mudanca) { E.r.passo = 'mapa'; return puriDiz('Não consegui ajustar isso com segurança, então mantive o mapa. O time confere com você depois.', [CH_MAPA_OK]); }
      return mapaMostrar(m, 'Ajustei o mapa com o que você disse. Ficou certo agora?');
    });
  }
  function cartaoResumo(resumo, problema, termo) {
    var c = el('div', 'puri-resumo'); c.setAttribute('role', 'group'); c.setAttribute('aria-label', 'O que ficou do que você contou');
    c.appendChild(el('p', 'puri-resumo-t', 'O que ficou do que você contou'));
    c.appendChild(el('span', 'puri-et', ETIQ.esp)); // etiqueta junto ao texto do especialista, não acima do título
    c.appendChild(el('p', 'puri-resumo-l', resumo));
    if (problema) c.appendChild(el('span', 'puri-resumo-pilula', problema));
    if (termo) { var tm = el('p', 'puri-resumo-termo'); tm.appendChild(document.createTextNode('A gente chama isso de ')); tm.appendChild(el('span', 'puri-resumo-pilula', termo)); c.appendChild(tm); }
    return c;
  }
  // Retomada após recarregar no meio de um destes passos (o retorno da Edge não estava salvo).
  function retomarR() {
    var r = E.r, p = r.passo, retry = E.chips.some(function (c) { return c.id === 'retry'; }), vazio = !E.chips.length || retry;
    if (p === 'aprof' && vazio) return rodarR(function (g) { return r.apOk ? palpiteR(g) : aprofR(g); });
    if (p === 'palpite' && vazio) return rodarR(function (g) { return r.palOk ? resumoR(g) : palpiteR(g); });
    if (p === 'palpite_txt' && !r.palOk && !E.chips.length && !retry) return rodarR(function () { return puriDiz(r.palV === 'parte' ? FALA_PARTE : FALA_NAO, [CH_PP_PULAR]); });
    if (p === 'palpite_txt' && (retry || (r.palOk && !E.chips.length))) return rodarR(function (g) { return r.palOk ? resumoR(g) : puriDiz(FALA_NAO, []); });
    if (p === 'palpite_alt') {
      if (!(r.alt && r.alt.length)) return rodarR(function (g) { return resumoR(g); });
      if (!E.chips.length) { E.chips = chipsAlt(); salvar(); desenharChips(E.chips); atualizarCampo(); rolar(); }
      return;
    }
    if (p === 'resumo') {
      if (!r.resumo) return rodarR(function (g) { return resumoR(g); });
      if (!E.chips.length || retry) { E.chips = chipsResumo(); salvar(); desenharChips(E.chips); atualizarCampo(); rolar(); }
      return;
    }
    if (p === 'resumo_txt') {
      var ur = E.msgs[E.msgs.length - 1];
      if (retry || !ur || ur.t !== FALA_RS_COR) return rodarR(function () { return puriDiz(FALA_RS_COR, [CH_RS_PULAR]); });
      return;
    }
    if (p === 'mapa') {
      if (r.mapaOk) {
        if (r.destino) return rodarR(function (g) { return irDestino(g); });
        var corpoOk = r.mapaPulou ? { passo: 'mapa_ok', pulou: true } : { passo: 'mapa_ok' }; // reenvia o mapa_ok (a recarga pode ter vindo antes dele chegar)
        return rodarR(function (g) { return chamarR(corpoOk, g).catch(function () {}).then(function () { return g === ger ? irDestino(g) : null; }); });
      }
      var mp = r.mapas && r.mapas.length ? r.mapas[r.mapas.length - 1].m : null;
      if (!mp) return rodarR(function () { return mapaR(ger); });
      if (!E.chips.length) { E.chips = mapaChips(mp); salvar(); desenharChips(E.chips); atualizarCampo(); rolar(); }
      return;
    }
    if (p === 'mapa_txt') {
      var ult = E.msgs[E.msgs.length - 1];
      if (retry || !ult || ult.t !== FALA_MAPA_AJ) return rodarR(function () { return puriDiz(FALA_MAPA_AJ, []); });
    }
  }
  // ---- Etapa 3: destino. O servidor decide 1 de 5; qualquer falha, tempo estourado ou resposta inválida cai em `cadastro`. ----
  var FALA_DEST = {
    contato_rapido: 'Pelo que você contou, seu caso é prioridade pra gente.',
    visita: 'Que tal provar antes? Um vendedor leva amostras grátis até você, de segunda a sexta, das 8h às 17h.',
    delivery: 'Pelo que entendi, é pra consumo seu. O delivery é o caminho mais rápido.',
    cadastro: T_REGRAS
  };
  var CH_RESUMO = { id: 'r_resumo', t: 'Ver o resumo do caso' }, CH_RECOMECAR = { id: 'r_recomecar', t: 'Começar de novo' };
  var T_QUENTE_ESPERA = 'a gente te chama no WhatsApp em até 24 horas úteis.';
  function destinoAtual() { return (E.r && E.r.destino) || 'cadastro'; }
  function chipsDestino(d) {
    d = d || destinoAtual();
    var c;
    if (d === 'contato_rapido') c = [{ id: 'r_criar', t: 'Criar minha conta' }, { id: 'r_contato', t: 'Só quero que me chamem' }];
    else if (d === 'visita') c = [{ id: 'r_visita', t: 'Quero receber a visita' }, { id: 'r_cadastro', t: 'Prefiro criar a conta direto' }];
    else if (d === 'delivery') c = [{ id: 'l', t: 'Abrir o delivery', href: hrefDelivery() }, { id: 'r_revender', t: 'Na verdade quero revender' }];
    else {
      c = [{ id: 'r_criar', t: 'Criar minha conta' }];
      if (E.r && E.r.visitaPre && E.r.visitaPre.cidade) c.push({ id: 'r_visita', t: 'Quero provar antes' });
      c.push(CH.humano);
    }
    return c.concat([CH_RESUMO, CH_RECOMECAR]);
  }
  function mostrarDestino(d) {
    if (!E.r) return;
    E.r.destino = d; rRetry = null;
    if (d === 'lista_espera') { vEsp = null; return perguntarR('espera_nome'); } // por garantia: o fluxo da lista de espera costuma terminar antes
    E.r.passo = 'destino'; salvar();
    return puriDiz(FALA_DEST[d] || T_REGRAS, chipsDestino(d));
  }
  function irDestino(g) { // já decidido (recarga): só redesenha, sem chamar o servidor
    g = g === undefined ? ger : g;
    if (!E.r) return;
    if (E.r.destino) return mostrarDestino(E.r.destino);
    var off = pontos();
    return chamarR({ passo: 'destino' }, g).then(function (x) {
      off();
      if (x.velho || g !== ger || !E.r) return;
      var d = x.r && DESTINOS.indexOf(x.r.destino) >= 0 ? x.r.destino : null;
      if (d) E.r.visitaPre = sanVisitaPre(x.r.visita);
      return mostrarDestino(d || 'cadastro');
    }).catch(function () { off(); if (g === ger && E.r) return mostrarDestino('cadastro'); });
  }
  function depoisDoMapa(corpo) { // avisa o servidor do mapa (sem travar nada) e então chama o destino
    var g0 = ger, pre = chamarR(corpo, g0).catch(function () {});
    return rodarR(function (g) { return pre.then(function () { return g === ger ? irDestino(g) : null; }); });
  }
  function mostrarResumo() { // reexibe cartão do resumo e último mapa a partir de E.r (sem servidor)
    var g = ger, r = E.r;
    if (!r) return;
    var mp = r.mapas && r.mapas.length ? r.mapas[r.mapas.length - 1] : null;
    if (!r.resumo && !mp) return puriDiz('Ainda não tenho um resumo do seu caso.', chipsDestino());
    return puriDiz('Aqui está o resumo do seu caso.', []).then(function () {
      if (g !== ger || !E.r) return;
      Array.prototype.forEach.call(msgs.querySelectorAll('.puri-resumo, .puri-mapa'), function (n) { n.remove(); }); // move para o fim (mesmo padrão do resumoCorrigir)
      if (r.resumo) { r.resI = E.msgs.length; msgs.appendChild(cartaoResumo(r.resumo, r.problema, r.termo)); }
      if (mp) { mp.i = E.msgs.length; r.mapas = [mp]; try { msgs.appendChild(mapaEl(mp.m, false)); } catch (e) {} }
      E.chips = chipsDestino(); salvar(); desenharChips(E.chips); rolar();
    });
  }
  // "Só quero que me chamem": nome e WhatsApp só em memória (vEsp), nunca no sessionStorage
  function contatoFim(msg) {
    vEsp = null; E.r.passo = 'destino'; rRetry = null; salvar();
    return puriDiz(msg, [CH_RESUMO, CH_RECOMECAR]);
  }
  function contatoPerdi() { E.r.passo = 'contato_nome'; vEsp = null; salvar(); return puriDiz(T_PERDI_ESP, chipsR('contato_nome')); }
  function contatoEnviar(g) {
    if (!E.r) return;
    if (!vEsp || !vEsp.nome || !vEsp.tel) return contatoPerdi();
    var nome = vEsp.nome.split(' ')[0];
    return chamarR({ passo: 'contato', nome: vEsp.nome, telefone: vEsp.tel }, g).then(function (x) {
      if (!x || x.velho || g !== ger || !E.r) return;
      var m = x.motivo;
      if (x.r) return contatoFim('Anotei, ' + nome + '! ' + T_QUENTE_ESPERA.charAt(0).toUpperCase() + T_QUENTE_ESPERA.slice(1));
      if (m === 'ja_registrado') return contatoFim('Seu contato já está com a gente. ' + T_QUENTE_ESPERA.charAt(0).toUpperCase() + T_QUENTE_ESPERA.slice(1));
      if (m === 'dados_invalidos') { rRetry = null; vEsp = null; return perguntarR('contato_nome', 'Alguma informação não passou. Vamos conferir de novo.'); }
      if (m === 'limite_dia') { vEsp = null; E.r.passo = 'destino'; salvar(); return puriDiz('Por hoje não consigo anotar mais contatos por aqui. Fala com a gente direto no WhatsApp?', [CH.humano, CH_RESUMO, CH_RECOMECAR]); }
      if (x.limite) return falhaR(x);
      return puriDiz('Não consegui anotar agora. Tenta de novo ou fala com uma pessoa.', [{ id: 'retry', t: 'Tentar de novo' }, CH.humano, CH_RESUMO, CH_RECOMECAR]);
    });
  }
  // Texto digitado na tela final (passo `destino`/`regras`): é dúvida DENTRO da revenda (não sai dela nem zera E.r); responde e volta aos chips das regras.
  function duvidaRegras() {
    var texto = limpar(campo.value);
    if (!texto) return;
    campo.value = ''; campo.style.height = 'auto';
    if (E.n >= MAX_MSGS) { usuarioDiz(texto); return falhaF6(T.limiteMsgs); }
    E.n++; usuarioDiz(texto);
    return rodarR(function (g) {
      return garantirToken(g).then(function (ok) {
        if (g !== ger) return;
        if (ok === 'limite') return falhaF6();
        if (ok !== 'ok') return falhaTemp();
        return api.mensagem(E.token, 'duvida', texto).then(function (r) { return tratarRegras(r, texto, g, false); });
      });
    });
  }
  function tratarRegras(r, texto, g, tok) {
    if (g !== ger || !E.r) return;
    if (!r || !r.ok) {
      var m = r && r.motivo;
      if (ehLimite(m)) return falhaF6();
      if (m === 'token_invalido' && !tok) {
        E.token = null; salvar();
        return garantirToken(g).then(function (ok) {
          if (g !== ger) return;
          if (ok === 'limite') return falhaF6();
          if (ok !== 'ok') return falhaTemp();
          return api.mensagem(E.token, 'duvida', texto).then(function (r2) { return tratarRegras(r2, texto, g, true); });
        });
      }
      return falhaTemp();
    }
    if ((r.tipo === 'resposta' || r.tipo === 'humano') && typeof r.texto === 'string' && r.texto) return puriDiz(r.texto, chipsDestino());
    if (r.tipo === 'humano') return puriDiz(T.humano, chipsDestino());
    return puriDiz(T.escolhe, chipsDestino()); // intenção/outro: segue nas regras
  }
  // ---- F4 passo 11: criar a conta dentro do chat (um dado por vez; tudo só em memória) ----
  var MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function modoSenha(on, ph) {
    if (!campoS) return;
    if (on) { campoS.type = 'password'; campoS.setAttribute('autocomplete', 'new-password'); campoS.placeholder = ph || ''; campoS.hidden = false; campo.hidden = true; }
    else { campoS.value = ''; campoS.type = 'text'; campoS.setAttribute('autocomplete', 'off'); campoS.placeholder = ''; campoS.hidden = true; campo.hidden = false; }
  }
  function limparConta() { cc = null; modoSenha(false); }
  function loginHref(hash) { return (PAGINA === 'home' ? './' : '../') + 'area-cliente/login.html' + (hash || ''); }
  function perguntarConta(p, fala) {
    cc.p = p; E.r.passo = 'conta'; salvar();
    var f = fala, chips = [];
    if (p === 'nome') f = f || 'Pra criar sua conta, me diz seu nome.';
    else if (p === 'tel') f = f || 'Seu WhatsApp com DDD?';
    else if (p === 'email') f = f || 'Seu e-mail?';
    else if (p === 'senha') { modoSenha(true, 'Crie uma senha (mín. 6)'); f = f || 'Crie uma senha (mínimo 6 caracteres).'; }
    else if (p === 'senha2') { modoSenha(true, 'Repita a senha'); f = f || 'Repete a senha pra conferir.'; }
    else if (p === 'aviso') { modoSenha(false); f = f || 'Posso te mandar avisos do seu cadastro e pedidos no WhatsApp?'; chips = [{ id: 'r_c_sim', t: 'Pode sim' }, { id: 'r_c_nao', t: 'Prefiro não' }]; }
    return puriDiz(f, chips);
  }
  function iniciarConta(prefixo) {
    cc = { p: 'nome', nome: '', tel: '', email: '', senha: '', s1: '', aceita: false };
    return perguntarConta('nome', (prefixo ? prefixo + ' ' : '') + 'Pra criar sua conta, me diz seu nome.');
  }
  function retomarConta() { return iniciarConta('Pra continuar, preciso dos seus dados de novo.'); }
  function enviarConta() {
    var g = ger, r = enviarContaPasso();
    if (!r || !r.then) return;
    ocupado = true; atualizarCampo();
    var fim = function () { if (g !== ger) return; ocupado = false; atualizarCampo(); if (aberto) focarEntrada(); };
    r.then(fim, fim);
  }
  function enviarContaPasso() {
    var p = cc.p, s, texto;
    if (p === 'senha' || p === 'senha2') {
      s = campoS.value; campoS.value = '';
      if (!s) return;
      usuarioDiz('••••••', '••••••'); // a senha nunca aparece em balão
      if (p === 'senha') {
        if (s.length < 6 || s.length > 72) return perguntarConta('senha', 'Essa senha não foi aceita. Tenta uma com pelo menos 6 caracteres.');
        cc.s1 = s; return perguntarConta('senha2');
      }
      if (s !== cc.s1) { cc.s1 = ''; return perguntarConta('senha', 'As senhas não bateram. Vamos de novo.'); }
      cc.senha = s; cc.s1 = '';
      return perguntarConta('aviso');
    }
    texto = limpar(campo.value);
    if (!texto) return;
    campo.value = ''; campo.style.height = 'auto';
    if (p === 'nome') {
      if (texto.length < 2 || texto.length > 80) return puriDiz(T.nomeRuim, []);
      cc.nome = normalizarNome(texto); usuarioDiz(texto, '(nome informado)'); return perguntarConta('tel');
    }
    if (p === 'tel') {
      var d = normalizarTel(texto);
      if (!d) return puriDiz(T.telRuim, []);
      cc.tel = d; usuarioDiz(mascararTel(d)); return perguntarConta('email');
    }
    if (p === 'email') {
      var em = texto.toLowerCase();
      if (em.length > 120 || !MAIL_RE.test(em)) return puriDiz('Esse e-mail não parece certo. Pode escrever de novo?', []);
      cc.email = em; usuarioDiz(em, '[e-mail]'); return perguntarConta('senha');
    }
    if (p === 'erro') return puriDiz('Toque em "Tentar de novo".', [{ id: 'r_c_retry', t: 'Tentar de novo' }, CH.humano]);
    return puriDiz(T.escolhe, [{ id: 'r_c_sim', t: 'Pode sim' }, { id: 'r_c_nao', t: 'Prefiro não' }]); // passo 'aviso': só chips
  }
  function aoChipConta(c) {
    if (c.id === 'r_c_sim' || c.id === 'r_c_nao') {
      if (cc.p !== 'aviso') return puriDiz(T.escolhe, [CH.humano]);
      cc.aceita = c.id === 'r_c_sim'; return criarConta();
    }
    if (c.id === 'r_c_retry') return (cc.nome && cc.tel && cc.email && cc.senha) ? criarConta() : iniciarConta('Perdi os seus dados por segurança.');
    return puriDiz(T.escolhe, [CH.humano]);
  }
  // Nome: espaços colapsados, cada palavra com a inicial maiúscula e o resto minúsculo ("da/de/do/das/dos/e" ficam minúsculos fora da 1ª posição)
  function normalizarNome(t) {
    var minus = { da: 1, de: 1, do: 1, das: 1, dos: 1, e: 1 };
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase().split(' ').map(function (w, i) {
      if (i > 0 && minus[w]) return w;
      return w.replace(/(^|[-'’])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); });
    }).join(' ');
  }
  // Liga a conversa à conta: confere o resultado do `converter`; até 2 novas tentativas com espera. true = ligou.
  function converterConferido(at, g) {
    var extra = 0;
    function uma() {
      return Promise.resolve().then(function () { return garantirToken(g); }).then(function (ok) {
        if (ok !== 'ok' || !E.token) return false;
        return api.converter(E.token, at).then(function (x) { return !!(x && (x.ok === true || x.motivo === 'ja_convertido')); });
      }).catch(function () { return false; });
    }
    function laco() {
      return uma().then(function (ok) {
        if (ok) return true;
        if (g !== ger || extra >= 2) return false;
        extra++;
        return new Promise(function (res) { setTimeout(res, 1200 * extra); }).then(laco);
      });
    }
    return laco();
  }
  function criarConta() {
    var g = ger, c = cc;
    ocupado = true; atualizarCampo(); limparChips(); E.chips = []; salvar();
    var dig = el('div', 'puri-b p puri-dig'); dig.setAttribute('aria-hidden', 'true');
    dig.appendChild(el('i')); dig.appendChild(el('i')); dig.appendChild(el('i'));
    msgs.appendChild(dig); rolar();
    var corpo = { email: c.email, senha: c.senha, data: { nome: c.nome, empresa: (E.r && E.r.segmento && SEG_LABEL[E.r.segmento]) || '', telefone: c.tel, cidade: (E.r && E.r.cidade) || '', aceita_whatsapp: c.aceita } };
    var fim = function () { if (g !== ger) return; ocupado = false; atualizarCampo(); if (aberto) focarEntrada(); };
    return Promise.resolve().then(function () { return api.signup(corpo); }).catch(function () { return { r: 'erro' }; }).then(function (res) {
      dig.remove();
      if (g !== ger) return;
      var r = res && res.r;
      if (r === 'ok') {
        var at = res.access_token; res = null;
        c.senha = ''; corpo.senha = '';
        var primeiro = c.nome.split(' ')[0];
        return converterConferido(at, g).then(function (ligou) {
          at = null;
          if (g !== ger) return;
          var prob = E.r && E.r.problema, quente = E.r && E.r.destino === 'contato_rapido', fala;
          if (E.r) E.r.passo = 'destino';
          limparConta(); salvar();
          if (!ligou) {
            fala = 'Sua conta foi criada! Não consegui ligar esta conversa a ela, mas o time vai ver do mesmo jeito.';
            if (E.token) { try { chamarR({ passo: 'conversao_falhou' }, g).catch(function () {}); } catch (e) {} } // sem esperar a resposta
          } else if (quente) fala = primeiro + ', seu caso já está com o nosso time; ' + T_QUENTE_ESPERA;
          else fala = 'Conta criada! Ela fica pendente até o time aprovar; a gente te avisa.' + (prob ? ' Já anotei o que você contou pra gente te ajudar no primeiro pedido.' : '');
          return puriDiz(fala, [{ id: 'r_c_painel', t: 'Ver o painel', href: loginHref() }, CH.humano, CH_RESUMO, CH_RECOMECAR]);
        });
      }
      if (r === 'existe') {
        if (E.r) E.r.passo = 'destino';
        limparConta(); salvar();
        return puriDiz('Você já tem conta com esse e-mail.', [{ id: 'r_c_login', t: 'Entrar', href: loginHref() }, { id: 'r_c_rec', t: 'Esqueci a senha', href: loginHref('#recuperar') }, CH.humano]);
      }
      if (r === 'senha') { cc.senha = ''; return perguntarConta('senha', 'Essa senha não foi aceita. Tenta uma com pelo menos 6 caracteres.'); }
      cc.p = 'erro'; salvar();
      return puriDiz('Não consegui criar a conta agora.', [{ id: 'r_c_retry', t: 'Tentar de novo' }, CH.humano]);
    }).then(fim, fim);
  }
  function aoChipR(c) {
    if (!E.r) return puriDiz(T.incertoAb, CH.abertura);
    var id = c.id, p = E.r.passo;
    if (id === 'r_mp_aj' && p === 'mapa') { E.r.passo = 'mapa_txt'; salvar(); return puriDiz(FALA_MAPA_AJ, []); }
    if (id === 'r_mp_pular' && (p === 'mapa' || p === 'mapa_txt')) {
      E.r.mapaOk = true; E.r.mapaPulou = true; salvar();
      return depoisDoMapa({ passo: 'mapa_ok', pulou: true });
    }
    if (id === 'r_mp_ok' && (p === 'mapa' || p === 'mapa_txt')) {
      E.r.mapaOk = true; salvar();
      return depoisDoMapa({ passo: 'mapa_ok' });
    }
    if (id === 'r_recomecar') return recomecar();
    if (id === 'r_contato_voltar' && E.r.destino) { vEsp = null; E.r.passo = 'destino'; return mostrarDestino(E.r.destino); }
    if (emFinal()) { // telas finais por destino (Etapa 3)
      if (id === 'r_criar') return iniciarConta('');
      if (id === 'r_contato') { vEsp = null; return perguntarR('contato_nome'); }
      if (id === 'r_visita') return iniciarVendedor('');
      if (id === 'r_cadastro' || id === 'r_revender') return mostrarDestino('cadastro');
      if (id === 'r_resumo') return rede(mostrarResumo);
    }
    if (/^r_c_/.test(id) && p === 'conta') return cc ? aoChipConta(c) : retomarConta();
    if (id === 'r_sd_escrever') { focarEntrada(); return; } // a Puri já mostrou o campo; só leva o foco
    if (id === 'r_sd_naosei' || id === 'r_sd_pular') return agirPasso(p, id === 'r_sd_naosei' ? 'nao_sei' : 'pulou');
    if (id.indexOf('r_seg_') === 0 && (p === 'segmento' || p === 'segmento_sug') && temSeg(id.slice(6))) return agirPasso(p, id.slice(6));
    var mq = /^r_q_(ja_vende|comeco|papel|conheceu)_(.+)$/.exec(id);
    if (mq && mq[1] === p) return agirPasso(p, mq[2]);
    if (p === 'retira' && (id === 'r_rt_sim' || id === 'r_rt_nao')) return agirPasso(p, id === 'r_rt_sim' ? 'sim' : 'nao');
    if (p === 'confirma_acai' && (id === 'r_ac_sim' || id === 'r_ac_nao' || id === 'r_ac_consumo')) return agirPasso(p, id === 'r_ac_sim' ? 'sim' : (id === 'r_ac_nao' ? 'nao' : 'consumo'));
    if (p === 'compra' && id.indexOf('r_cp_') === 0) return agirPasso(p, id.slice(5));
    if (p === 'cidade' && id === 'r_cid_cuiaba') { E.r.cidade = 'Cuiabá'; return perguntarR('bairro'); }
    if (p === 'cidade' && id === 'r_cid_vg') { E.r.cidade = 'Várzea Grande'; return perguntarR('bairro'); }
    if (p === 'cidade' && id === 'r_cid_outra') return perguntarR('cidade_outra');
    if (id === 'r_pular' && p === 'bairro') { E.r.bairro = null; return perguntarR('objetivo'); }
    if (id === 'r_pular' && p === 'objetivo') return perguntarR('movimento');
    if (p === 'movimento' && id.indexOf('r_mv_') === 0) return agirPasso(p, id.slice(5));
    if (p === 'sim' && id.indexOf('r_preco_') === 0) return agirPasso(p, 'preco_' + id.slice(8));
    if (p === 'sim' && id === 'r_continuar') return agirPasso(p, 'continuar');
    if (p === 'aprof' && id === 'r_ap_pular') { E.r.apOk = true; salvar(); return rodarR(palpiteR); }
    if (p === 'aprof' && /^r_ap_\d$/.test(id)) return aprofResp(sanTxt(c.t, 60));
    if (p === 'palpite' && id === 'r_pp_mosca') return palpiteResp('mosca');
    if (p === 'palpite' && (id === 'r_pp_parte' || id === 'r_pp_nao')) { E.r.passo = 'palpite_txt'; E.r.palV = id === 'r_pp_parte' ? 'parte' : null; salvar(); return puriDiz(E.r.palV ? FALA_PARTE : FALA_NAO, [CH_PP_PULAR]); }
    if (p === 'palpite_txt' && id === 'r_pp_pular') { E.r.palOk = true; salvar(); return rodarR(resumoR); }
    if (p === 'palpite_alt' && /^r_al_\d$/.test(id)) return palpiteEscolha(+id.slice(5));
    if (p === 'palpite_alt' && id === 'r_al_n') return palpiteEscolha(null);
    if (p === 'resumo' && id === 'r_rs_ok') {
      try { chamarR({ passo: 'resumo_resp', valor: 'ok' }, ger).catch(function () {}); } catch (e) {}
      return rodarR(mapaR);
    }
    if (p === 'resumo' && id === 'r_rs_cor' && !E.r.resC) { E.r.passo = 'resumo_txt'; salvar(); return puriDiz(FALA_RS_COR, [CH_RS_PULAR]); }
    if (p === 'resumo_txt' && id === 'r_rs_pular') return rodarR(mapaR);
    return puriDiz(T_NAO_ENTENDI, emFinal() ? chipsDestino() : chipsR(p));
  }
  // Ação única de um passo de botões: v = id da opção | 'nao_sei' | 'pulou' | 'texto' (texto livre aceito após 2 falhas)
  function agirPasso(p, v, texto) {
    if (!E.r) return;
    delete interpFalhas[p];
    var livre = v === 'nao_sei' || v === 'pulou' || v === 'texto';
    if (p === 'segmento' || p === 'segmento_sug') {
      var s = temSeg(v) ? v : 'outro';
      E.r.segmento = s; salvar();
      return perguntarR('ja_vende', livre ? '' : 'Anotei: ' + SEG_ROT[s] + '.');
    }
    if (QUALIF[p]) {
      if (!livre && !QUALIF[p].opts.some(function (o) { return o[0] === v; })) return puriDiz(T_NAO_ENTENDI, chipsR(p));
      qualifR(p, v, texto);
      if (p === 'comeco') dispararAp(ger); // movimento, compra e simulador já respondidos: a pergunta enxerga a qualificação
      if (QUALIF[p].prox === 'aprof') return rodarR(aprofR);
      return perguntarR(QUALIF[p].prox);
    }
    if (p === 'movimento') {
      var ok = MOV_CHIPS.some(function (m) { return m[0] === v; });
      E.r.movimento = ok ? v : 'ate20'; salvar();
      if (E.r.pixI == null) inserirPixel();
      if (ok) return rodarR(perfilR);
      return rodarR(function (g) { return puriDiz(T_MOV_PADRAO, []).then(function () { return g === ger && E.r ? perfilR(g) : null; }); });
    }
    if (p === 'compra') {
      qualifR('compra', v, texto);
      return rodarR(function (g) { return simR(18, g, T_SIM); }); // simulador começa em R$ 18
    }
    if (p === 'sim') {
      var n = /^preco_(\d+)$/.exec(v);
      if (n && PRECOS.indexOf(+n[1]) >= 0) return rodarR(function (g) { return simR(+n[1], g, null); });
      return perguntarR('comeco'); // continuar / não sei / pular: segue com o preço que está na tela (R$ 18 por padrão)
    }
    if (p === 'retira') {
      E.r.retira = v === 'sim'; salvar();
      if (v === 'sim') return perguntarR('objetivo');
      vEsp = null;
      return perguntarR('espera_nome', 'Entendi. Por enquanto a gente não chega aí.');
    }
    if (p === 'confirma_acai') {
      if (v !== 'sim' && v !== 'nao' && v !== 'consumo') return puriDiz(T_NAO_ENTENDI, chipsR(p));
      try {
        if (v === 'consumo') {
          // depois de 'consumo' o servidor trava os passos da revenda daquele token: descarta ja (sincrono) e envia com o token fixo
          var tokC = E.token; E.token = null; salvar();
          if (tokC) chamarR({ passo: 'confirma_acai', valor: v }, ger, false, tokC).catch(function () {});
        } else chamarR({ passo: 'confirma_acai', valor: v }, ger).catch(function () {});
      } catch (e) {}
      if (v === 'sim') { if (E.r.cena && E.r.cenaI == null) inserirCena(); return perguntarR('movimento'); }
      limparVisita(); E.etapa = 'abertura'; E.assunto = null; salvar();
      if (v === 'consumo') return puriDiz('Então o delivery é o caminho mais rápido pra você.', [{ id: 'l', t: 'Abrir o delivery', href: hrefDelivery() }, { id: 'duvida', t: 'Tirar uma dúvida' }, { id: 'inicio', t: 'Começar de novo' }]);
      return puriDiz('Sem problema! Se precisar de algo de açaí, é só chamar.', CH.abertura);
    }
    if (p === 'esclarecer') return esclarecerResp(v === 'nao_sei' || v === 'pulou' ? null : texto);
    return puriDiz(T_NAO_ENTENDI, chipsR(p));
  }
  // Lista de espera (cidade fora da área): nome e telefone só em memória (vEsp), nunca no sessionStorage
  function esperaFim(msg) {
    limparVisita(); E.etapa = 'abertura'; E.assunto = null; salvar();
    return puriDiz(msg, [{ id: 'duvida', t: 'Tirar uma dúvida' }, { id: 'provar', t: 'Quero provar antes' }]);
  }
  function esperaPerdi() { E.r.passo = 'espera_nome'; vEsp = null; salvar(); return puriDiz(T_PERDI_ESP, chipsR('espera_nome')); }
  function esperaEnviar(g) {
    if (!E.r) return;
    if (!vEsp || !vEsp.nome || !vEsp.tel) return esperaPerdi();
    return chamarR({ passo: 'lista_espera', nome: vEsp.nome, telefone: vEsp.tel, cidade: E.r.cidade || '' }, g).then(function (x) {
      if (!x || x.velho || g !== ger || !E.r) return;
      var m = x.motivo;
      if (x.r) { rRetry = null; return esperaFim('Anotei! Assim que a Dupuro chegar aí, a gente te avisa.'); }
      if (m === 'ja_registrado') { rRetry = null; return esperaFim('Você já está na nossa lista.'); }
      if (m === 'dados_invalidos') { rRetry = null; vEsp = null; return perguntarR('espera_nome', 'Alguma informação não passou. Vamos conferir de novo.'); }
      if (x.limite && m !== 'limite_dia') return falhaR(x);
      return puriDiz('Não consegui anotar agora. Tenta de novo ou fala com uma pessoa.', [{ id: 'retry', t: 'Tentar de novo' }, CH.humano]);
    });
  }
  var INTERP = ['segmento_sug', 'ja_vende', 'movimento', 'compra', 'sim', 'comeco', 'papel', 'conheceu', 'retira', 'confirma_acai'];
  function interpretarR(p, texto, g) {
    var ops = opcoesPasso(p).filter(function (o) { return o.id !== 'nao_sei' && o.id !== 'pulou' && o.id !== 'nenhuma'; });
    return chamarR({ passo: 'interpretar', etapa: p, texto: texto.slice(0, 200), opcoes: ops }, g).then(function (x) {
      if (!x.r) return falhaR(x);
      if (!E.r || E.r.passo !== p) return;
      var e = x.r.escolha;
      if (typeof e === 'string' && (e === 'nao_sei' || e === 'pulou' || ops.some(function (o) { return o.id === e; }))) { rRetry = null; return agirPasso(p, e, texto); }
      rRetry = null;
      interpFalhas[p] = (interpFalhas[p] || 0) + 1;
      if (interpFalhas[p] >= 2) return agirPasso(p, 'texto', texto);
      return puriDiz(T_NAO_ENTENDI, chipsR(p));
    });
  }
  function enviarR() {
    var p = E.r.passo, texto = limpar(campo.value);
    if (!texto) return;
    campo.value = ''; campo.style.height = 'auto';
    clearTimeout(escTimer);
    if (p === 'segmento') { usuarioDiz(texto); return rodarR(function (g) { return segTexto(texto, g); }); }
    if (p === 'cidade' || p === 'cidade_outra') {
      if (texto.length < 2) return rede(function () { return puriDiz('Pode escrever a cidade de novo?', chipsR(p)); });
      usuarioDiz(texto); return rede(function () { return definirCidade(texto); });
    }
    if (p === 'bairro') {
      if (texto.length < 2 || texto.length > 60) return rede(function () { return puriDiz(T.bairroRuim, chipsR(p)); });
      usuarioDiz(texto); E.r.bairro = mascararObj(texto); return rede(function () { return perguntarR('objetivo'); });
    }
    if (p === 'objetivo') { usuarioDiz(texto, mascararObj(texto)); return rodarR(function (g) { return objetivoFinal(texto, g); }); }
    if (p === 'aprof') { usuarioDiz(texto, mascararObj(texto)); return aprofResp(texto); }
    if (p === 'palpite_txt') { usuarioDiz(texto, mascararObj(texto)); return palpiteResp(E.r.palV || 'nao', texto); }
    if (p === 'resumo_txt') { usuarioDiz(texto, mascararObj(texto)); return resumoCorrigir(texto); }
    if (p === 'resumo' || p === 'palpite_alt') return;
    if (p === 'espera_nome') {
      if (texto.length < 2 || texto.length > 80) return rede(function () { return puriDiz(T.nomeRuim, chipsR(p)); });
      vEsp = { nome: texto, tel: '' }; usuarioDiz(texto, '(nome informado)'); return rede(function () { return perguntarR('espera_tel'); });
    }
    if (p === 'contato_nome') {
      if (texto.length < 2 || texto.length > 80) return rede(function () { return puriDiz(T.nomeRuim, chipsR(p)); });
      vEsp = { nome: normalizarNome(texto), tel: '' }; usuarioDiz(texto, '(nome informado)'); return rede(function () { return perguntarR('contato_tel'); });
    }
    if (p === 'contato_tel') {
      var dc = normalizarTel(texto);
      if (!dc) return rede(function () { return puriDiz(T.telRuim, chipsR(p)); }); // não ecoa o número inválido
      if (!vEsp || !vEsp.nome) return rede(contatoPerdi);
      vEsp.tel = dc; usuarioDiz(mascararTel(dc)); return rodarR(contatoEnviar);
    }
    if (p === 'espera_tel') {
      var dt = normalizarTel(texto);
      if (!dt) return rede(function () { return puriDiz(T.telRuim, chipsR(p)); }); // não ecoa o número inválido
      if (!vEsp || !vEsp.nome) return rede(esperaPerdi);
      vEsp.tel = dt; usuarioDiz(mascararTel(dt)); return rodarR(esperaEnviar);
    }
    if (INTERP.indexOf(p) >= 0) { usuarioDiz(texto); return rodarR(function (g) { return interpretarR(p, texto, g); }); }
    if (p === 'esclarecer') { usuarioDiz(texto, mascararObj(texto)); return esclarecerResp(texto); }
    if (p === 'palpite') { usuarioDiz(texto, mascararObj(texto)); return palpiteResp('nao', texto); }
    if (p === 'mapa_txt' || p === 'mapa') {
      texto = texto.slice(0, 200);
      if (texto.length < 4) return rede(function () { return puriDiz('Pode contar um pouco mais?', []); });
      usuarioDiz(texto, mascararObj(texto)); return rodarR(function (g) { return mapaAjusteR(texto, g); });
    }
    return rede(function () { return puriDiz(T_NAO_ENTENDI, E.chips && E.chips.length ? E.chips : chipsR(p)); });
  }

  function aoChip(c) {
    if (ocupado || ajVoo) { avisarOcupado(); return; } // sem duplicar a ação; dá retorno discreto
    usuarioDiz(c.t);
    if (/^r_/.test(c.id)) return aoChipR(c);
    if (c.id === 'retry') {
      if (rRetry) return rRetry();
      if (E.v && E.v.passo === 'confirma' && vNome && vTel) return enviarVisita();
      if (!ultimoTexto || E.etapa === 'fim') { E.etapa = 'duvida'; return puriDiz(T.pergunta, chipsQ(SUGESTOES)); }
      return processar(ultimoTexto);
    }
    if (c.id === 'inicio') { // volta ao menu inicial sem apagar a conversa
      limparVisita(); E.etapa = 'abertura'; E.assunto = null;
      return puriDiz(T.abertura, CH.abertura);
    }
    if (c.id === 'como_entrega' || c.id === 'q') {
      limparVisita(); E.etapa = 'duvida'; E.assunto = 'duvida';
      if (E.n >= MAX_MSGS) return falhaF6(T.limiteMsgs);
      E.n++; ultimoTexto = c.t;
      return processar(c.t);
    }
    if (c.id === 'rev_retira' && emFinal()) { soVisita(); return mostrarDestino(E.r.destino); } // tela final: não recria o caso
    if (c.id === 'rev_retira') { var pr = iniciarR(); if (E.r) { E.r.retira = true; salvar(); } return pr; } // revenda de quem está fora da área: retirando na fábrica
    if (c.id === 'fabrica' || c.id === 'vendedor' || CIDADES[c.id] || /^(cid_outra|dia_|per_|confirmar|corrigir|v_)/.test(c.id)) return aoChipVisita(c);
    irPara(c.id);
  }

  function limpar(t) { return t.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS); }

  function enviar() {
    if (ocupado || ajVoo) { avisarOcupado(); return; } // o texto fica no campo; nada é descartado
    if (E.etapa === 'fim') { // campo normalmente travado; se chegar aqui, a Puri orienta
      campo.value = ''; campo.style.height = 'auto';
      return puriDiz(T.escolhe, E.chips && E.chips.length ? E.chips : [CH.humano]);
    }
    if (E.v && emFinal()) return enviarCampo(); // visita pedida a partir da tela final: o caso (E.r) fica
    if (E.r && E.r.passo === 'conta') return cc ? enviarConta() : retomarConta();
    if (emFinal()) return duvidaRegras();
    if (E.r) return enviarR();
    if (E.v) return enviarCampo();
    var texto = limpar(campo.value);
    if (!texto) return;
    campo.value = ''; campo.style.height = 'auto';
    if (E.n >= MAX_MSGS) { usuarioDiz(texto); falhaF6(T.limiteMsgs); return; }
    E.n++;
    usuarioDiz(texto);
    ultimoTexto = texto;
    processar(texto);
  }

  // Envia `texto` à Edge (garante token). Falhas temporárias não travam o campo.
  function processar(texto) {
    var g = ger;
    ocupado = true; atualizarCampo();
    var etapa = E.etapa === 'duvida' ? 'duvida' : 'abertura';
    garantirToken(g).then(function (ok) {
      if (g !== ger) return;
      if (ok === 'limite') return falhaF6();
      if (ok !== 'ok') return falhaTemp();
      return api.mensagem(E.token, etapa, texto).then(function (r) { return tratar(r, texto, g, { etapa: etapa }); });
    }).catch(function () { if (g === ger) return falhaTemp(); }).then(function () {
      if (g !== ger) return; // Recomeçar já zerou ocupado
      ocupado = false; atualizarCampo(); if (aberto) focarEntrada();
    });
  }

  // Resolve 'ok' | 'limite' | 'erro'
  function garantirToken(g) {
    if (E.token) return Promise.resolve('ok');
    return api.iniciar(PAGINA).then(function (r) {
      if (g !== ger) return 'erro';
      if (r && r.ok && r.token) { E.token = r.token; salvar(); return 'ok'; }
      return r && ehLimite(r.motivo) ? 'limite' : 'erro';
    });
  }

  // fl: {etapa: etapa enviada, tok: já reenviou por token_invalido}
  function tratar(r, texto, g, fl) {
    if (g !== ger) return;
    if (!r || !r.ok) {
      var m = r && r.motivo;
      if (ehLimite(m)) return falhaF6();
      if (m === 'token_invalido' && !fl.tok) { // renova a conversa e reenvia UMA vez
        E.token = null; salvar();
        return garantirToken(g).then(function (ok) {
          if (g !== ger) return;
          if (ok === 'limite') return falhaF6();
          if (ok !== 'ok') return falhaTemp();
          return api.mensagem(E.token, fl.etapa, texto).then(function (r2) { return tratar(r2, texto, g, { etapa: fl.etapa, tok: true }); });
        });
      }
      return falhaTemp(); // erro | timeout | rede | token_invalido repetido | texto_invalido
    }
    if (r.tipo === 'resposta' && typeof r.texto === 'string') {
      E.etapa = 'duvida'; E.assunto = 'duvida';
      if (r.fora === true) { // assunto sem relação com a Dupuro: sugestões do servidor + "Outra dúvida", sem "Falar com uma pessoa"
        var csf = chipsServidor(r);
        if (csf.length) return puriDiz(r.texto, csf.concat([CH_OUTRA]));
        return puriDiz(r.texto, CH.abertura.filter(function (c) { return c.id !== 'duvida'; }).concat([CH_OUTRA]));
      }
      var cs = chipsServidor(r);
      var jaIntencao = {};
      (Array.isArray(r.acoes) ? r.acoes : []).forEach(function (a) { // ações (caminho do menu), não texto de pergunta
        if (typeof a === 'string' && CH_INTENCAO[a] && !jaIntencao[a]) { jaIntencao[a] = 1; cs.push(CH_INTENCAO[a]); }
      });
      if (r.intencao && CH_INTENCAO[r.intencao] && !jaIntencao[r.intencao]) cs.push(CH_INTENCAO[r.intencao]); // caminho correspondente
      cs.push(CH_OUTRA);
      if (r.humano === true) cs.push(CH.humano);
      cs.push(CH_INICIO);
      return puriDiz(r.texto, cs);
    }
    if (r.tipo === 'humano') {
      E.assunto = 'humano';
      if (fl.etapa === 'duvida') E.etapa = 'duvida'; // continua aceitando dúvida digitada
      return puriDiz(typeof r.texto === 'string' && r.texto ? r.texto : T.humano, [CH.humano, CH_INICIO]);
    }
    if (r.tipo === 'intencao') {
      switch (r.intencao) {
        case 'humano': E.assunto = 'humano'; return puriDiz(T.humano, [CH.humano]);
        case 'revender': case 'consumir': case 'provar':
          return irPara(r.intencao);
        case 'social': // cumprimento/agradecimento: responde e continua na abertura
          return puriDiz(typeof r.texto === 'string' && r.texto ? r.texto : T.olaSocial, CH.abertura);
        case 'duvida':
          if (fl.etapa === 'duvida') return puriDiz(T.incertoAb, CH.abertura); // já era a etapa de dúvida: não recursa
          E.etapa = 'duvida'; E.assunto = 'duvida';
          E.n++; // o servidor conta as duas chamadas (abertura e dúvida); ele é a fonte de verdade, este contador é só espelho local
          return api.mensagem(E.token, 'duvida', texto).then(function (r2) { return tratar(r2, texto, g, { etapa: 'duvida', tok: fl.tok }); });
        default: return puriDiz(T.incertoAb, CH.abertura);
      }
    }
    return falhaTemp();
  }

  // ---- Botão acima das barras fixas do delivery; some com gaveta/pagamento ----
  var raf = 0;
  function ajustarBotao() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      if (!btn || PAGINA !== 'delivery') return;
      var gaveta = document.querySelector('.dl-gaveta:not([hidden])');
      var pagando = document.body.classList.contains('dl-pagando');
      btn.classList.toggle('puri-btn-solto', !!(gaveta || pagando) && !aberto);
      var base = window.innerWidth < 640 ? 16 : 26, sobe = base;
      var larg = btn.offsetWidth, dir = window.innerWidth - parseFloat(getComputedStyle(btn).right) - larg;
      ['.dl-fixa.on', '.dl-barra'].forEach(function (sel) {
        var b = document.querySelector(sel);
        if (!b || !b.offsetHeight) return;
        var ref = b.querySelector('.dl-barra-in') || b, rr = ref.getBoundingClientRect();
        if (rr.right < dir || rr.left > dir + larg) return; // sem sobreposição horizontal
        var emb = parseFloat(getComputedStyle(b).bottom) || 0;
        sobe = Math.max(sobe, emb + b.offsetHeight + 12);
      });
      btn.style.setProperty('--puri-b', sobe + 'px');
    });
  }
  function observar() {
    if (PAGINA !== 'delivery') return; // só o delivery tem barras fixas/gaveta
    ajustarBotao();
    window.addEventListener('scroll', ajustarBotao, { passive: true });
    // As barras/gaveta são estáticas no HTML; só mudam por class/hidden (sem childList).
    if ('MutationObserver' in window) {
      new MutationObserver(ajustarBotao).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    }
  }

  function iniciar() {
    montar();
    atualizarCampo();
    if (E.msgs.length) desenharTudo();
    if (E.etapa === 'fim') { /* limite atingido: nada a retomar */ }
    else if (E.r && E.r.passo === 'sim') { E.chips = chipsR('sim'); desenharChips(E.chips, false); salvar(); } // retoma a escolha de preço
    else if (E.r && ['aprof', 'palpite', 'palpite_txt', 'palpite_alt', 'resumo', 'resumo_txt', 'mapa', 'mapa_txt'].indexOf(E.r.passo) >= 0) retomarR();
    else if (E.r && E.r.passo === 'conta') retomarConta(); // nome/telefone/e-mail/senha não sobrevivem ao recarregar
    else if (emFinal() && !E.v && !E.chips.length && E.r.destino) { E.chips = chipsDestino(); salvar(); desenharChips(E.chips, false); } // recarga na tela final: redesenha os botões do destino, sem servidor
    else if (E.r && ['ja_vende', 'segmento_sug', 'retira', 'espera_nome', 'espera_tel', 'contato_nome', 'contato_tel', 'confirma_acai', 'esclarecer', 'compra', 'comeco', 'papel', 'conheceu'].indexOf(E.r.passo) >= 0 && (!E.chips.length || E.chips.some(function (c) { return c.id === 'retry'; }))) {
      if (E.r.passo === 'espera_tel') esperaPerdi(); else perguntarR(E.r.passo); // sem botões salvos: refaz a pergunta e os botões
    }
    else if (E.r && E.r.passo !== 'regras' && E.r.passo !== 'destino' && E.chips.some(function (c) { return c.id === 'retry'; })) perguntarR(E.r.passo); // falha temporária: refaz a pergunta
    observar();
  }
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
