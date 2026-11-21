/* ==========================================================================
   Puri — assistente flutuante da Dupuro (Etapa 3: casca, F0/F1/F5/F6).
   IIFE autocontido, sem dependências. Injeta o próprio markup no <body>.

   CONFIG (opcional, antes do script):  window.PURI = { pagina: 'home'|'revenda'|'delivery', api: 'mock'|'edge', edgeLocal: true }
   MODO: padrão 'edge' (produção). Em localhost/127.0.0.1 vira 'mock' automaticamente,
   a menos que PURI.edgeLocal === true. PURI.api ('mock'|'edge') sobrescreve tudo.
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
   {acao:'catalogo'} (sem token) -> {ok:true, delivery:{a_partir_de, produto_id}, atacado:{caixa10:{preco,litros}|null, caixa5:...|null}} | {ok:false, motivo}
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
  var QMODO = LOCAL ? (/[?&]puri=(edge|mock)(&|$)/.exec(location.search) || [])[1] : null;
  var QPROD = LOCAL && /[?&]puri=prod(&|$)/.test(location.search);
  var FUNC = (LOCAL && !QPROD) ? 'assistente-dev' : 'assistente';
  var MODO = QMODO || (QPROD ? 'edge' : null) || cfg.api || ((LOCAL && cfg.edgeLocal !== true) ? 'mock' : MODO_PADRAO);

  var WA_BASE = 'https://wa.me/5565992888228';
  // Rótulos do assunto do WhatsApp (F5). Nunca entra texto digitado pelo usuário.
  var ROTULOS = { revender: 'quero revender', consumir: 'comprar pra consumir', provar: 'quero provar antes', duvida: 'tirar uma dúvida', humano: 'falar com uma pessoa' };
  function waLink() {
    var r = ROTULOS[E.assunto] || ROTULOS.humano;
    return WA_BASE + '?text=' + encodeURIComponent('Oi! Vim pelo assistente do site. Assunto: ' + r + '.');
  }
  var MAX_CHARS = 500, MAX_MSGS = 25, MAX_BALOES = 50, TIMEOUT = 10000;
  var CHAVE = 'puri:v1';
  var REDUZIDO = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Textos (fonte: ROTEIRO F0/F1/F2/F3/F5/F6 e base-de-fatos) ----
  var T = {
    abertura: 'Oi! Eu sou a Puri, assistente da Dupuro. Posso tirar uma dúvida ou te ajudar a começar.',
    pergunta: 'Pode perguntar.',
    humano: 'Tudo bem. Vou te passar pra uma pessoa.',
    incerto: 'Não entendi bem. Escolhe uma das opções.',
    limite: 'Agora é melhor seguir com uma pessoa.',
    limiteMsgs: 'Pra seguir, melhor com uma pessoa.',
    fimCampo: 'Pra seguir, fala com uma pessoa.',
    // TODO Etapa 4 (próximo lote): F4 real; `revender` é placeholder.
    consumir: 'Pra consumir em casa é pelo nosso delivery, com entrega em Cuiabá e Várzea Grande. Pedido mínimo de R$ 20 em produtos.',
    consumirPreco: function (p) { return 'Pra consumir em casa é pelo nosso delivery: caixas a partir de ' + p + ', com entrega em Cuiabá e Várzea Grande. Pedido mínimo de R$ 20 em produtos.'; },
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
    foraCidade: 'Por enquanto a visita é só em Cuiabá e Várzea Grande. Você pode provar na fábrica.',
    visitaOk: 'Pronto! Nosso vendedor vai te chamar pra combinar.',
    visitaJa: 'Seu pedido de visita já está com a gente. O vendedor vai te chamar.',
    visitaDados: 'Alguma informação não passou. Vamos conferir de novo.',
    escolhe: 'Escolhe uma das opções.',
    perdi: 'Por segurança não guardo nome nem telefone quando a página recarrega. Qual é o seu nome?'
  };
  var ENDERECO_FABRICA = 'Av. das Torres, 16, Jardim Imperial II, Cuiabá-MT, 78076-001';
  var MAPA_FABRICA = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ENDERECO_FABRICA);
  var DIAS = { seg: 'segunda-feira', ter: 'terça-feira', qua: 'quarta-feira', qui: 'quinta-feira', sex: 'sexta-feira' };
  var DIA_CURTO = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex' };
  var CIDADES = { cid_cuiaba: 'Cuiabá', cid_vg: 'Várzea Grande' };
  var PASSOS = ['cidade', 'bairro', 'dia', 'periodo', 'nome', 'tel', 'confirma'];
  var CH = {
    abertura: [
      { id: 'revender', t: 'Quero revender' }, { id: 'consumir', t: 'Comprar pra consumir' },
      { id: 'provar', t: 'Quero provar antes' }, { id: 'duvida', t: 'Tirar uma dúvida' }
    ],
    humano: { id: 'humano', t: 'Falar com uma pessoa', href: WA_BASE, hum: true } // href real montado por waLink() ao desenhar
  };

  // ---- F4: revender (constantes) ----
  var SEG_ROT = { delivery_acai: 'delivery de açaí', acaiteria: 'açaiteria', lanchonete_bar: 'lanchonete ou bar', sorveteria: 'sorveteria', feira_evento: 'feira ou evento', mercado_varejo: 'mercado ou varejo', revenda_casa: 'revenda em casa', outro: 'outro tipo de negócio' };
  var SEG_CHIPS = [['acaiteria', 'Açaiteria'], ['lanchonete_bar', 'Lanchonete ou bar'], ['delivery_acai', 'Delivery de açaí'], ['sorveteria', 'Sorveteria'], ['feira_evento', 'Feira ou evento'], ['mercado_varejo', 'Mercado ou varejo'], ['revenda_casa', 'Revenda em casa'], ['outro', 'Outro']];
  var MOV_CHIPS = [['ate20', 'Até 20'], ['20a50', '20 a 50'], ['50a100', '50 a 100'], ['100mais', 'Mais de 100']];
  var RP = ['segmento', 'cidade', 'cidade_outra', 'bairro', 'objetivo', 'movimento', 'sim', 'aprof', 'palpite', 'palpite_txt', 'resumo', 'regras', 'conta'];
  var FALA_NAO = 'Me conta o que é, então.';
  var SIM_CHAVES = ['preco_copo', 'custo_caixa', 'copos_caixa', 'venda_caixa', 'sobra_caixa', 'copos_dia', 'caixas_semana', 'sobra_semana'];
  var PRECOS = [18, 19, 20];
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
  var I_CHAT = 'M4 5h16v11H9l-5 4z', I_X = 'M6 6l12 12M18 6L6 18', I_ENV = 'M4 12l16-8-6 16-3-7z', I_REC = 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7';

  // ---- Estado ----
  function novoEstado() { return { msgs: [], chips: [], token: null, n: 0, etapa: 'abertura', assunto: null, v: null, r: null }; }
  var cc = null; // F4 passo 11 (conta): nome/telefone/e-mail/senha SÓ em memória; a senha só vai ao /auth/v1/signup (nunca a balão, E, sessionStorage, console ou à Edge da Puri)
  var campoS; // input da senha (o textarea não tem type=password)
  var vNome = '', vTel = ''; // só em memória: nunca vão ao sessionStorage (o balão do nome guarda "(nome informado)"; o resumo guarda "você" no lugar do nome)
  var E = novoEstado();
  var aberto = false, ocupado = false, travado = null;
  var ger = 0; // geração da conversa: respostas de geração antiga (após Recomeçar) são descartadas
  var ETAPAS = ['abertura', 'duvida', 'fim'], IDS_CHIP = ['revender', 'consumir', 'provar', 'duvida', 'outra', 'humano', 'retry',
    'fabrica', 'vendedor', 'como_entrega', 'cid_cuiaba', 'cid_vg', 'cid_outra', 'dia_seg', 'dia_ter', 'dia_qua', 'dia_qui', 'dia_sex', 'per_manha', 'per_tarde', 'confirmar', 'corrigir'];
  var HREF_OK = /^(https:\/\/wa\.me\/|https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=|\/(?![\/\\\t\r\n])|\.\.?\/|#)/;
  // O sessionStorage é dado externo: normaliza tudo antes de usar.
  function normalizar(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.msgs)) return null;
    var r = novoEstado();
    r.n = Math.max(0, +s.n || 0);
    r.etapa = ETAPAS.indexOf(s.etapa) >= 0 ? s.etapa : 'abertura';
    r.token = typeof s.token === 'string' ? s.token : null;
    r.assunto = typeof s.assunto === 'string' && ROTULOS[s.assunto] ? s.assunto : null;
    s.msgs.forEach(function (m) {
      if (m && (m.de === 'u' || m.de === 'p') && typeof m.t === 'string') r.msgs.push({ de: m.de, t: m.t.slice(0, 2000) });
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
        if (typeof c.href !== 'string' || !HREF_OK.test(c.href)) return; // href suspeito: descarta o chip
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
        apOk: q.apOk === true, palOk: q.palOk === true,
        resumo: sanTxt(q.resumo, 300) || null, problema: sanTxt(q.problema, 40) || null, resI: Math.min(MAX_BALOES, Math.max(0, Math.floor(+q.resI) || 0)),
        cenaI: typeof q.cenaI === 'number' && isFinite(q.cenaI) ? Math.min(MAX_BALOES, Math.max(0, Math.floor(q.cenaI))) : null,
        pixI: typeof q.pixI === 'number' && isFinite(q.pixI) ? Math.min(MAX_BALOES, Math.max(0, Math.floor(q.pixI))) : null
      };
      if (q.ap && typeof q.ap === 'object' && sanTxt(q.ap.p, 200)) r.r.ap = { p: sanTxt(q.ap.p, 200), rs: (Array.isArray(q.ap.rs) ? q.ap.rs : []).map(function (x) { return sanTxt(x, 60); }).filter(Boolean).slice(0, 4) };
    }
    if (semChips) r.chips = [CH.humano];
    return r;
  }
  try { var salvo = normalizar(JSON.parse(sessionStorage.getItem(CHAVE) || 'null')); if (salvo) E = salvo; } catch (e) {}
  function salvar() { try { sessionStorage.setItem(CHAVE, JSON.stringify(E)); } catch (e) {} atualizarCaso(); }

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
    function post(corpo) {
      var base = window.DUPURO_SUPABASE_URL, k = window.DUPURO_SUPABASE_ANON_KEY;
      if (!base || !k) return Promise.resolve({ ok: false, motivo: 'erro' });
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT), t2;
      return Promise.race([
        fetch(base + '/functions/v1/' + FUNC, {
          method: 'POST', signal: ctl ? ctl.signal : undefined,
          headers: { 'apikey': k, 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo)
        }).then(function (r) { return r.json(); }),
        new Promise(function (res) { t2 = setTimeout(function () { res({ ok: false, motivo: 'erro' }); }, TIMEOUT + 200); })
      ]).catch(function () { return { ok: false, motivo: 'erro' }; })
        .then(function (j) { clearTimeout(t); clearTimeout(t2); return j && typeof j === 'object' ? j : { ok: false, motivo: 'erro' }; });
    }
    return {
      iniciar: function (pagina) { return post({ acao: 'iniciar', pagina: pagina }); },
      mensagem: function (token, etapa, texto) { return post({ acao: 'mensagem', token: token, etapa: etapa, texto: texto }); },
      catalogo: function () { return post({ acao: 'catalogo' }); },
      visita: function (token, d) {
        return post({ acao: 'visita', token: token, cidade: d.cidade, bairro: d.bairro, dia: d.dia, periodo: d.periodo, nome: d.nome, telefone: d.telefone });
      },
      converter: function (token, at) { return post({ acao: 'converter', token: token, access_token: at }); },
      signup: signupReal,
      revenda: function (token, d) {
        var b = { acao: 'revenda', token: token };
        Object.keys(d).forEach(function (k) { b[k] = d[k]; });
        return post(b);
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
      catalogo: function () { return atraso({ ok: true, delivery: { a_partir_de: 25, produto_id: 21 }, atacado: { caixa10: { preco: 145, litros: 10 }, caixa5: null } }); },
      visita: function (token, d) {
        var tel = String(d.telefone || '').replace(/\D/g, ''), c = norm(String(d.cidade || ''));
        if (!d.nome || !d.bairro || !DIAS[d.dia] || (d.periodo !== 'manha' && d.periodo !== 'tarde') || tel.length < 10 || tel.length > 11) return atraso({ ok: false, motivo: 'dados_invalidos' });
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
          if (p !== 18 && p !== 19 && p !== 20) return atraso({ ok: false, motivo: 'dados_invalidos' });
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
    tit.appendChild(h); tit.appendChild(el('span', null, 'Assistente da Dupuro'));
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
    col.appendChild(casoAba); col.appendChild(casoAside); col.appendChild(msgs); col.appendChild(notasBox); col.appendChild(form);
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
    window.addEventListener('resize', function () { if (aberto) travarScroll(); ajustarBotao(); clearTimeout(casoTimer); casoTimer = setTimeout(atualizarCaso, 150); });
  }

  // Campo/enviar: desligados depois do F6 (etapa 'fim') e enquanto a Puri processa.
  function atualizarCampo() {
    var fim = E.etapa === 'fim';
    campo.disabled = fim;
    campo.maxLength = (E.r && (E.r.passo === 'aprof' || E.r.passo === 'palpite_txt')) ? 300 : MAX_CHARS; // a Edge aceita 300 nesses passos
    env.disabled = fim || ocupado;
    campo.placeholder = fim ? T.fimCampo : 'Escreva aqui';
  }
  // ---- "Seu caso": resumo ao vivo da conversa de revenda (tudo por textContent) ----
  var CASO_CAMPOS = [['negocio', 'Negócio'], ['cidade', 'Cidade'], ['quer', 'O que quer'], ['mov', 'Movimento'], ['sim', 'Simulação'], ['etapa', 'Etapa']];
  var MOV_ROT = { ate20: 'até 20 copos/dia', '20a50': '20 a 50 copos/dia', '50a100': '50 a 100 copos/dia', '100mais': '100 ou mais copos/dia' };
  var CASO_ETAPA = { segmento: 'Seu negócio', cidade: 'Onde fica', cidade_outra: 'Onde fica', bairro: 'Onde fica', objetivo: 'O que você quer', movimento: 'Movimento', sim: 'Simulação', aprof: 'Entender melhor', palpite: 'Entender melhor', palpite_txt: 'Entender melhor', resumo: 'Resumo', regras: 'Regras', conta: 'Conta' };
  function casoAtivo() { return !!(E.r && RP.indexOf(E.r.passo) >= 0); }
  function casoLargo() { return window.innerWidth >= 900 && !(window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  function casoValores() {
    var r = E.r, v = {};
    v.negocio = (r.segmento && SEG_LABEL[r.segmento]) || '';
    v.cidade = [r.cidade, r.bairro].filter(Boolean).join(' · ');
    v.quer = r.problema || ultimaNota || '';
    v.mov = (r.movimento && MOV_ROT[r.movimento]) || '';
    v.sim = (r.sim && r.sim.sobra_semana != null && isFinite(r.sim.sobra_semana)) ? 'Sobra ≈ ' + fmtR(r.sim.sobra_semana) + ' por semana' : '';
    v.etapa = CASO_ETAPA[r.passo] || '';
    return v;
  }
  function atualizarCaso() {
    if (!painel || !casoAside) return;
    var ativo = casoAtivo(), largo = casoLargo();
    if (largo ? casoAside.parentNode !== corpo : casoAside.parentNode !== col) { if (largo) corpo.appendChild(casoAside); else col.insertBefore(casoAside, msgs); }
    painel.classList.toggle('puri-largo', ativo && largo);
    var abaFocada = document.activeElement === casoAba;
    casoAba.hidden = !ativo || largo;
    if (abaFocada && casoAba.hidden) { var alvo = (campo && !campo.disabled && campo.offsetParent !== null) ? campo : painel; if (alvo === painel && !painel.hasAttribute('tabindex')) painel.setAttribute('tabindex', '-1'); alvo.focus(); }
    if (!ativo) { casoPronto = false; casoAberto = false; ultimaNota = ''; casoAside.hidden = true; casoAba.setAttribute('aria-expanded', 'false'); return; }
    casoAside.hidden = !largo && !casoAberto;
    casoAba.setAttribute('aria-expanded', casoAberto ? 'true' : 'false');
    var v = casoValores(), n = 0;
    ['negocio', 'cidade', 'quer', 'mov', 'sim'].forEach(function (k) { if (v[k]) n++; });
    casoAba.textContent = 'Seu caso · ' + n + ' de 5';
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
    var fim = msgs.scrollHeight;
    if (seco || REDUZIDO) msgs.scrollTop = fim; else msgs.scrollTo({ top: fim, behavior: 'smooth' });
  }
  function baloes() { return msgs.querySelectorAll('.puri-b'); }
  function addBalao(de, texto, animar) {
    var b = el('div', 'puri-b ' + de, texto);
    if (animar === false) b.style.animation = 'none';
    msgs.appendChild(b);
    return b;
  }
  function limparChips() { var c = msgs.querySelector('.puri-chips'); if (c) c.remove(); }
  function desenharChips(lista, animar) {
    limparChips();
    if (!lista || !lista.length) return;
    var box = el('div', 'puri-chips');
    if (animar === false) box.style.animation = 'none';
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
        x.addEventListener('click', function () { aoChip(c); });
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
  function cenaEl(seg) { // monta o cartão (SVG por createElementNS; legenda por textContent). Null se algo falhar.
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
      var c = cenaEl(E.r.segmento); if (!c) return;
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
    return { g: v('--gold', '#F5B301'), v: v('--verde', '#8BB831'), c: v('--cream', '#FFF7EC'), r: v('--roxo-300', '#A94E8C') };
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
  function pixFinal(card) { // quadro final (só os bonequinhos) no tamanho atual do cartão
    var cv = card.querySelector('canvas'), W = Math.floor(card.querySelector('.puri-pix-cv').clientWidth);
    if (!cv || W < 20) return false;
    var dpr = Math.min(2, window.devicePixelRatio || 1), ctx = cv.getContext('2d');
    cv.width = Math.round(W * dpr); cv.height = Math.round(PIX_H * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
    var L = pixLayout(PIX_N[card._mov], W, PIX_H, pixCores());
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
      wrap.appendChild(cv); card.appendChild(wrap); var leg = el('p', 'puri-pix-leg', pixTexto(mov)); leg.setAttribute('aria-hidden', 'true'); card.appendChild(leg);
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
    function cena(i) { if (cn && cn.cenaI === i) { var c = cenaEl(cn.segmento); if (c) msgs.appendChild(c); } }
    var px = E.r && E.r.movimento && typeof E.r.pixI === 'number' ? E.r : null;
    function pixel(i) { if (px && px.pixI === i) pixelMonta(px.movimento, px.segmento, false); }
    cena(0); pixel(0);
    if (rc && rc.resI === 0) msgs.appendChild(cartaoResumo(rc.resumo, rc.problema));
    E.msgs.forEach(function (m, i) { addBalao(m.de, m.t, false); cena(i + 1); pixel(i + 1); if (rc && rc.resI === i + 1) msgs.appendChild(cartaoResumo(rc.resumo, rc.problema)); });
    if (E.r && E.r.passo === 'sim' && E.r.sim) msgs.appendChild(cartaoSim(E.r.sim));
    desenharChips(E.chips, false);
    atualizarCampo(); atualizarCaso();
    rolar(true);
  }
  function guardar(de, t) {
    E.msgs.push({ de: de, t: t });
    if (E.msgs.length > MAX_BALOES) { var corte = E.msgs.length - MAX_BALOES; E.msgs = E.msgs.slice(-MAX_BALOES); if (E.r && E.r.resumo) E.r.resI = Math.max(0, (E.r.resI || 0) - corte); if (E.r && typeof E.r.cenaI === 'number') E.r.cenaI = Math.max(0, E.r.cenaI - corte); if (E.r && typeof E.r.pixI === 'number') E.r.pixI = Math.max(0, E.r.pixI - corte); }
    salvar();
  }
  function podarDom() { var b = baloes(); while (b.length > MAX_BALOES) { b[0].remove(); b = baloes(); } }

  function sanTxt(t, n) { return typeof t === 'string' ? t.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n) : ''; }
  function mascararObj(t) { // guardado: sequências de 4+ dígitos viram "••••", e-mails viram "[e-mail]"
    return String(t).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]').replace(/\d(?:[\s().-]*\d){3,}/g, '••••');
  }
  function usuarioDiz(t, guardado) { limparChips(); E.chips = []; guardar('u', guardado === undefined ? t : guardado); addBalao('u', t); podarDom(); rolar(); }

  // Puri fala: "•••" por 0,3–1 s (sem atraso em reduced-motion), depois balão + chips.
  function puriDiz(texto, chips, guardado) {
    limparChips(); E.chips = [];
    var g = ger;
    var dig = el('div', 'puri-b p puri-dig'); dig.setAttribute('aria-hidden', 'true');
    dig.appendChild(el('i')); dig.appendChild(el('i')); dig.appendChild(el('i'));
    if (!REDUZIDO) { msgs.appendChild(dig); rolar(); }
    var espera = REDUZIDO ? 0 : Math.min(1000, 300 + texto.length * 6);
    return new Promise(function (ok) {
      setTimeout(function () {
        dig.remove();
        if (g !== ger) return ok(); // conversa recomeçada enquanto a Puri "digitava"
        guardar('p', guardado === undefined ? texto : guardado); E.chips = chips || []; salvar();
        addBalao('p', texto); podarDom(); desenharChips(E.chips); atualizarCampo(); topoHum.href = waLink(); rolar();
        ok();
      }, espera);
    });
  }

  // ---- Fluxo ----
  function comecar() { puriDiz(T.abertura, CH.abertura); }

  function recomecar() {
    ger++;
    ultimoTexto = ''; vNome = ''; vTel = ''; limparConta(); rRetry = null; clearTimeout(escTimer); escVoo = false; escUltimo = ''; limparNotas();
    E = novoEstado();
    ocupado = false; ultimaNota = ''; salvar(); msgs.textContent = ''; atualizarCampo(); topoHum.href = waLink();
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
        return puriDiz(T.pergunta, []);
    }
    return puriDiz(T.incerto, CH.abertura);
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
  function irConsumir() {
    limparVisita(); E.etapa = 'abertura'; E.assunto = 'consumir';
    var g = ger, antes = ocupado;
    ocupado = true; atualizarCampo();
    var link = { id: 'l', t: 'Abrir o delivery', href: PAGINA === 'delivery' ? './' : (PAGINA === 'revenda' ? '../delivery/' : './delivery/') };
    return catalogo().then(function (r) {
      if (g !== ger) return;
      var v = r && r.ok && r.delivery ? Number(r.delivery.a_partir_de) : NaN;
      var fala = isFinite(v) && v > 0 ? T.consumirPreco(reais(v)) : T.consumir;
      return puriDiz(fala, [link, { id: 'como_entrega', t: 'Como funciona a entrega?' }, { id: 'revender', t: 'Na verdade quero revender' }]).then(function () {
        if (g === ger) { ocupado = antes; atualizarCampo(); }
      });
    });
  }

  // ---- F3: provar (fábrica ou visita do vendedor) ----
  function limparVisita() { vNome = ''; vTel = ''; limparConta(); E.v = null; E.r = null; rRetry = null; clearTimeout(escTimer); limparNotas(); }
  function irFabrica() {
    limparVisita(); E.etapa = 'abertura'; E.assunto = 'provar';
    return puriDiz(T.fabrica, [{ id: 'l', t: 'Ver no mapa', href: MAPA_FABRICA }, { id: 'revender', t: 'Quero revender' }]);
  }
  function resumoVisita(anonimo) {
    var v = E.v;
    return 'Visita em ' + v.bairro + ', ' + v.cidade + ', ' + DIAS[v.dia] + ' de ' + (v.periodo === 'manha' ? 'manhã' : 'tarde') + ', pra ' + (anonimo ? 'você' : vNome) + '.';
  }
  function chipsPasso(p) {
    switch (p) {
      case 'cidade': return [{ id: 'cid_cuiaba', t: 'Cuiabá' }, { id: 'cid_vg', t: 'Várzea Grande' }, { id: 'cid_outra', t: 'Outra cidade' }, CH.humano];
      case 'dia': return ['seg', 'ter', 'qua', 'qui', 'sex'].map(function (d) { return { id: 'dia_' + d, t: DIA_CURTO[d] }; });
      case 'periodo': return [{ id: 'per_manha', t: 'Manhã (8h–12h)' }, { id: 'per_tarde', t: 'Tarde (13h–17h)' }];
      case 'confirma': return [{ id: 'confirmar', t: 'Confirmar' }, { id: 'corrigir', t: 'Corrigir' }];
    }
    return [CH.humano]; // bairro, nome, tel (texto livre)
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
    if (!E.v) return puriDiz(T.incerto, CH.abertura);
    if (c.id === 'cid_outra') { limparVisita(); E.assunto = 'provar'; return puriDiz(T.foraCidade, [{ id: 'fabrica', t: 'Visitar a fábrica' }, CH.humano]); }
    if (CIDADES[c.id]) { E.v.cidade = CIDADES[c.id]; return perguntarPasso('bairro'); }
    if (/^dia_/.test(c.id)) { E.v.dia = c.id.slice(4); return perguntarPasso('periodo'); }
    if (c.id === 'per_manha' || c.id === 'per_tarde') { E.v.periodo = c.id === 'per_manha' ? 'manha' : 'tarde'; return perguntarPasso('nome'); }
    if (c.id === 'corrigir') return iniciarVendedor('');
    if (c.id === 'confirmar') return (!vNome || !vTel) ? iniciarVendedor(T.perdi) : enviarVisita();
    return puriDiz(T.incerto, CH.abertura);
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
      E.v.bairro = texto; usuarioDiz(texto); return perguntarPasso('dia');
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
    return puriDiz(T.escolhe, chipsPasso(p)); // passo de chips: não ecoa o texto
  }
  function enviarVisita() {
    var g = ger, v = E.v;
    ocupado = true; atualizarCampo();
    var corpo = { cidade: v.cidade, bairro: v.bairro, dia: v.dia, periodo: v.periodo, nome: vNome, telefone: vTel };
    garantirToken(g).then(function (ok) {
      if (g !== ger) return;
      if (ok === 'limite') { limparVisita(); return falhaF6(); }
      if (ok !== 'ok') return falhaTemp();
      return api.visita(E.token, corpo).then(function (r) { return tratarVisita(r, corpo, g, false); });
    }).catch(function () { if (g === ger) return falhaTemp(); }).then(function () {
      if (g !== ger) return;
      ocupado = false; atualizarCampo(); if (aberto) focarEntrada();
    });
  }
  function tratarVisita(r, corpo, g, tok) {
    if (g !== ger) return;
    var pos = [{ id: 'duvida', t: 'Tirar uma dúvida' }, { id: 'revender', t: 'Quero revender' }];
    if (r && r.ok) { limparVisita(); salvar(); return puriDiz(T.visitaOk, pos); }
    var m = r && r.motivo;
    if (m === 'ja_pedida') { limparVisita(); salvar(); return puriDiz(T.visitaJa, pos); }
    if (m === 'cidade_fora') { limparVisita(); salvar(); return puriDiz(T.foraCidade, [{ id: 'fabrica', t: 'Visitar a fábrica' }, CH.humano]); }
    if (m === 'dados_invalidos') { return iniciarVendedor(T.visitaDados); } // recomeça do primeiro passo
    if (m === 'limite_dia') { limparVisita(); return falhaF6(); }
    if (m === 'token_invalido' && !tok) {
      E.token = null; salvar();
      return garantirToken(g).then(function (ok) {
        if (g !== ger) return;
        if (ok === 'limite') { limparVisita(); return falhaF6(); }
        if (ok !== 'ok') return falhaTemp();
        return api.visita(E.token, corpo).then(function (r2) { return tratarVisita(r2, corpo, g, true); });
      });
    }
    return falhaTemp(); // erro | timeout | rede
  }

  // ---- F4: revender (um passo por vez; ROTEIRO F4 passos 1-5 e 10) ----
  var rRetry = null, escTimer = 0, escVoo = false, escUltimo = '';
  var FORA = 'Entregamos só em Cuiabá e Várzea Grande. De outra cidade, dá pra revender retirando na fábrica.';
  var FALA_R = { segmento: 'Que tipo de negócio você tem (ou quer ter)?', cidade: 'Em que cidade?', cidade_outra: 'Qual cidade?', bairro: 'E o bairro?', objetivo: 'O que você quer com a revenda? Pode contar do seu jeito.', movimento: 'Quantos copos por dia você vende (ou imagina vender)?' };
  var T_SIM = 'Fiz uma conta rápida com o seu movimento.';
  var T_SEM_CUSTO = 'Não consegui puxar o preço do atacado agora. Mostro só quanto você vende por caixa.';
  var T_REGRAS = 'Como funciona: o primeiro pedido não tem mínimo; depois, pedidos a partir de 30 L (3 caixas de 10 L ou 6 de 5 L). Granola e complementos não entram na conta. Entregamos em Cuiabá e Várzea Grande, ou você retira na fábrica.';
  function sa(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function fmtR(v) {
    var n = Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : v.toFixed(2).replace('.', ',');
    var p = n.split(','); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + p.join(',');
  }
  function chipsR(p) {
    switch (p) {
      case 'segmento': return SEG_CHIPS.map(function (s) { return { id: 'r_seg_' + s[0], t: s[1] }; });
      case 'cidade': return [{ id: 'r_cid_cuiaba', t: 'Cuiabá' }, { id: 'r_cid_vg', t: 'Várzea Grande' }, { id: 'r_cid_outra', t: 'Outra cidade' }];
      case 'bairro': case 'objetivo': return [{ id: 'r_pular', t: 'Pular' }];
      case 'movimento': return MOV_CHIPS.map(function (m) { return { id: 'r_mv_' + m[0], t: m[1] }; });
      case 'sim': return PRECOS.map(function (n) { return { id: 'r_preco_' + n, t: 'R$ ' + n }; }).concat([{ id: 'r_continuar', t: 'Continuar' }]);
    }
    return [];
  }
  function perguntarR(p, prefixo) {
    if (!E.r) return;
    E.r.passo = p; salvar();
    if (p === 'cidade' && E.r.segmento && E.r.cenaI == null) inserirCena();
    if (p !== 'objetivo') { clearTimeout(escTimer); limparNotas(); }
    return puriDiz((prefixo ? prefixo + ' ' : '') + FALA_R[p], chipsR(p));
  }
  function iniciarR() {
    limparVisita(); E.etapa = 'abertura'; E.assunto = 'revender';
    E.r = { passo: 'segmento', segmento: null, cidade: null, bairro: null, movimento: null, preco: null, sim: null, escN: 0 };
    return perguntarR('segmento');
  }
  // Roda fn(g) com o campo travado; falhas viram "Tentar de novo" (rRetry refaz o mesmo passo).
  function rede(fn) {
    var g = ger; ocupado = true; atualizarCampo();
    return Promise.resolve().then(function () { return fn(g); }).catch(function () { if (g === ger) return falhaTemp(); }).then(function () {
      if (g !== ger) return;
      ocupado = false; atualizarCampo(); if (aberto) focarEntrada();
    });
  }
  function rodarR(fn) { rRetry = function () { return rede(fn); }; return rede(fn); }
  // Chamada da Edge `revenda`: garante token, renova uma vez se token_invalido.
  function chamarR(corpo, g, tok) {
    return garantirToken(g).then(function (ok) {
      if (g !== ger) return { velho: true };
      if (ok === 'limite') return { limite: true };
      if (ok !== 'ok') return { temp: true };
      return api.revenda(E.token, corpo).then(function (r) {
        if (g !== ger) return { velho: true };
        if (r && r.ok) return { r: r };
        var m = r && r.motivo;
        if (m === 'limite_conversa' || m === 'limite_dia') return { limite: true };
        if (m === 'token_invalido' && !tok) { E.token = null; salvar(); return chamarR(corpo, g, true); }
        return { temp: true };
      });
    });
  }
  function falhaR(x) {
    if (!x || x.velho) return;
    if (x.limite) { E.r = null; return falhaF6(); }
    return falhaTemp();
  }
  function segTexto(texto, g) {
    return chamarR({ passo: 'segmento', texto: texto }, g).then(function (x) {
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var s = temSeg(x.r.segmento) ? x.r.segmento : 'outro';
      E.r.segmento = s; rRetry = null;
      return perguntarR('cidade', 'Anotei: ' + SEG_ROT[s] + '.');
    });
  }
  function definirCidade(texto) {
    var n = sa(texto), c = /cuiab/.test(n) ? 'Cuiabá' : (/varzea/.test(n) ? 'Várzea Grande' : null);
    E.r.cidade = c || texto.slice(0, 60);
    return perguntarR('bairro', '');
  }
  function perfilR(g) {
    var r = E.r, corpo = { passo: 'perfil', segmento: r.segmento || 'outro', cidade: r.cidade || 'Cuiabá', movimento: r.movimento };
    if (r.bairro) corpo.bairro = r.bairro;
    return chamarR(corpo, g).then(function (x) {
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      if (x.r.fora_area === true) return puriDiz(FORA).then(function () { return g === ger && E.r ? simR(18, g, T_SIM) : null; });
      return simR(18, g, T_SIM);
    });
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
  function limparNotas() { escUltimo = ''; if (notasBox) { notasBox.hidden = true; notasBox.textContent = ''; } }
  function mostrarNotas(arr) {
    var ul = el('ul');
    arr.slice(0, 6).forEach(function (a) { if (typeof a === 'string' && a.trim()) ul.appendChild(el('li', null, a.trim().slice(0, 120))); });
    if (!ul.children.length) return;
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
      return perguntarR('movimento', an.length ? 'Anotei: ' + an.join('; ') + '.' : 'Anotado.');
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
  function aprofR(g) {
    rRetry = function () { return rede(aprofR); };
    E.r.passo = 'aprof'; limparChips(); E.chips = []; salvar();
    var off = pontos();
    return chamarR({ passo: 'aprofundar' }, g).then(function (x) {
      off();
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var q = sanTxt(x.r.pergunta, 200);
      if (!q) { E.r.apOk = true; return palpiteR(g); }
      var rs = (Array.isArray(x.r.respostas) ? x.r.respostas : []).map(function (t) { return sanTxt(t, 60); }).filter(Boolean).slice(0, 4);
      E.r.ap = { p: q, rs: rs }; rRetry = null;
      return puriDiz(q, rs.map(function (t, i) { return { id: 'r_ap_' + i, t: t }; }).concat([{ id: 'r_ap_pular', t: 'Pular' }]));
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
    return chamarR({ passo: 'palpite' }, g).then(function (x) {
      off();
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var p = sanTxt(x.r.palpite, 220);
      if (!p) { E.r.palOk = true; return resumoR(g); }
      rRetry = null;
      return puriDiz(p, [{ id: 'r_pp_mosca', t: 'Na mosca' }, { id: 'r_pp_parte', t: 'Em parte' }, { id: 'r_pp_nao', t: 'Não, é outra coisa' }]);
    });
  }
  function palpiteResp(valor, texto) {
    E.r.palOk = true; salvar();
    return rodarR(function (g) {
      var c = { passo: 'palpite_resp', valor: valor };
      if (texto) c.texto = String(texto).slice(0, 300);
      return chamarR(c, g).then(function (x) {
        if (!x.r) return falhaR(x);
        if (!E.r) return;
        return resumoR(g);
      });
    });
  }
  function resumoR(g) {
    rRetry = function () { return rede(resumoR); };
    E.r.passo = 'resumo'; limparChips(); E.chips = []; salvar();
    var off = pontos();
    return chamarR({ passo: 'resumo' }, g).then(function (x) {
      off();
      if (!x.r) return falhaR(x);
      if (!E.r) return;
      var re = sanTxt(x.r.resumo, 300);
      if (!re) return irRegras();
      E.r.resumo = re; E.r.problema = sanTxt(x.r.problema, 40) || null; E.r.resI = E.msgs.length; salvar();
      msgs.appendChild(cartaoResumo(E.r.resumo, E.r.problema)); rolar();
      return irRegras();
    });
  }
  function cartaoResumo(resumo, problema) {
    var c = el('div', 'puri-resumo'); c.setAttribute('role', 'group'); c.setAttribute('aria-label', 'O que ficou do que você contou');
    c.appendChild(el('p', 'puri-resumo-t', 'O que ficou do que você contou'));
    c.appendChild(el('p', 'puri-resumo-l', resumo));
    if (problema) c.appendChild(el('span', 'puri-resumo-pilula', problema));
    return c;
  }
  // Retomada após recarregar no meio de um destes passos (o retorno da Edge não estava salvo).
  function retomarR() {
    var r = E.r, p = r.passo, retry = E.chips.some(function (c) { return c.id === 'retry'; }), vazio = !E.chips.length || retry;
    if (p === 'aprof' && vazio) return rodarR(function (g) { return r.apOk ? palpiteR(g) : aprofR(g); });
    if (p === 'palpite' && vazio) return rodarR(function (g) { return r.palOk ? resumoR(g) : palpiteR(g); });
    if (p === 'palpite_txt' && (retry || (r.palOk && !E.chips.length))) return rodarR(function (g) { return r.palOk ? resumoR(g) : puriDiz(FALA_NAO, []); });
    if (p === 'resumo') return rodarR(function () { return r.resumo ? irRegras() : resumoR(ger); });
  }
  function irRegras() {
    E.r.passo = 'regras'; rRetry = null; salvar();
    return puriDiz(T_REGRAS, [{ id: 'r_criar', t: 'Criar minha conta' }, CH.humano]);
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
    var f = fala, chips = [CH.humano];
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
      if (texto.length < 2 || texto.length > 80) return puriDiz(T.nomeRuim, [CH.humano]);
      cc.nome = texto; usuarioDiz(texto, '(nome informado)'); return perguntarConta('tel');
    }
    if (p === 'tel') {
      var d = normalizarTel(texto);
      if (!d) return puriDiz(T.telRuim, [CH.humano]);
      cc.tel = d; usuarioDiz(mascararTel(d)); return perguntarConta('email');
    }
    if (p === 'email') {
      var em = texto.toLowerCase();
      if (em.length > 120 || !MAIL_RE.test(em)) return puriDiz('Esse e-mail não parece certo. Pode escrever de novo?', [CH.humano]);
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
  function criarConta() {
    var g = ger, c = cc;
    ocupado = true; atualizarCampo(); limparChips(); E.chips = []; salvar();
    var dig = el('div', 'puri-b p puri-dig'); dig.setAttribute('aria-hidden', 'true');
    dig.appendChild(el('i')); dig.appendChild(el('i')); dig.appendChild(el('i'));
    msgs.appendChild(dig); rolar();
    var corpo = { email: c.email, senha: c.senha, data: { nome: c.nome, empresa: '', telefone: c.tel, cidade: (E.r && E.r.cidade) || '', aceita_whatsapp: c.aceita } };
    var fim = function () { if (g !== ger) return; ocupado = false; atualizarCampo(); if (aberto) focarEntrada(); };
    return Promise.resolve().then(function () { return api.signup(corpo); }).catch(function () { return { r: 'erro' }; }).then(function (res) {
      dig.remove();
      if (g !== ger) return;
      var r = res && res.r;
      if (r === 'ok') {
        var at = res.access_token; res = null;
        var conv = Promise.resolve().then(function () { return garantirToken(g); }).then(function (ok) {
          if (ok !== 'ok' || !E.token) return; // sem token: segue sem converter
          return api.converter(E.token, at);
        }).catch(function () {});
        return conv.then(function () {
          at = null;
          if (g !== ger) return;
          var prob = E.r && E.r.problema;
          if (E.r) E.r.passo = 'regras';
          limparConta(); salvar();
          return puriDiz('Conta criada! Ela fica pendente até o time aprovar; a gente te avisa.' + (prob ? ' Já anotei o que você contou pra gente te ajudar no primeiro pedido.' : ''),
            [{ id: 'r_c_painel', t: 'Ver o painel', href: loginHref() }, CH.humano]);
        });
      }
      if (r === 'existe') {
        if (E.r) E.r.passo = 'regras';
        limparConta(); salvar();
        return puriDiz('Você já tem conta com esse e-mail.', [{ id: 'r_c_login', t: 'Entrar', href: loginHref() }, { id: 'r_c_rec', t: 'Esqueci a senha', href: loginHref('#recuperar') }, CH.humano]);
      }
      if (r === 'senha') { cc.senha = ''; return perguntarConta('senha', 'Essa senha não foi aceita. Tenta uma com pelo menos 6 caracteres.'); }
      cc.p = 'erro'; salvar();
      return puriDiz('Não consegui criar a conta agora.', [{ id: 'r_c_retry', t: 'Tentar de novo' }, CH.humano]);
    }).then(fim, fim);
  }
  function aoChipR(c) {
    if (!E.r) return puriDiz(T.incerto, CH.abertura);
    var id = c.id, p = E.r.passo;
    if (id === 'r_criar' && p === 'regras') return iniciarConta('');
    if (/^r_c_/.test(id) && p === 'conta') return cc ? aoChipConta(c) : retomarConta();
    if (id.indexOf('r_seg_') === 0 && p === 'segmento' && temSeg(id.slice(6))) { E.r.segmento = id.slice(6); return perguntarR('cidade'); }
    if (p === 'cidade' && id === 'r_cid_cuiaba') { E.r.cidade = 'Cuiabá'; return perguntarR('bairro'); }
    if (p === 'cidade' && id === 'r_cid_vg') { E.r.cidade = 'Várzea Grande'; return perguntarR('bairro'); }
    if (p === 'cidade' && id === 'r_cid_outra') return perguntarR('cidade_outra');
    if (id === 'r_pular' && p === 'bairro') { E.r.bairro = null; return perguntarR('objetivo'); }
    if (id === 'r_pular' && p === 'objetivo') return perguntarR('movimento');
    if (p === 'movimento' && id.indexOf('r_mv_') === 0 && MOV_CHIPS.some(function (m) { return m[0] === id.slice(5); })) {
      E.r.movimento = id.slice(5); salvar();
      if (E.r.pixI == null) inserirPixel();
      return rodarR(perfilR);
    }
    if (p === 'sim' && id.indexOf('r_preco_') === 0 && PRECOS.indexOf(+id.slice(8)) >= 0) {
      var n = +id.slice(8);
      return rodarR(function (g) { return simR(n, g, null); });
    }
    if (p === 'sim' && id === 'r_continuar') return rodarR(aprofR);
    if (p === 'aprof' && id === 'r_ap_pular') { E.r.apOk = true; return rodarR(palpiteR); }
    if (p === 'aprof' && /^r_ap_\d$/.test(id)) return aprofResp(sanTxt(c.t, 60));
    if (p === 'palpite' && (id === 'r_pp_mosca' || id === 'r_pp_parte')) return palpiteResp(id === 'r_pp_mosca' ? 'mosca' : 'parte');
    if (p === 'palpite' && id === 'r_pp_nao') { E.r.passo = 'palpite_txt'; salvar(); return puriDiz(FALA_NAO, []); }
    return puriDiz(T.escolhe, chipsR(p));
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
      usuarioDiz(texto); E.r.bairro = texto; return rede(function () { return perguntarR('objetivo'); });
    }
    if (p === 'objetivo') { usuarioDiz(texto, mascararObj(texto)); return rodarR(function (g) { return objetivoFinal(texto, g); }); }
    if (p === 'aprof') { usuarioDiz(texto, mascararObj(texto)); return aprofResp(texto); }
    if (p === 'palpite_txt') { usuarioDiz(texto, mascararObj(texto)); return palpiteResp('nao', texto); }
    if (p === 'resumo') return;
    return rede(function () { return puriDiz(T.escolhe, E.chips && E.chips.length ? E.chips : chipsR(p)); }); // movimento / sim / palpite: só chips
  }

  function aoChip(c) {
    if (ocupado) return;
    usuarioDiz(c.t);
    if (/^r_/.test(c.id)) return aoChipR(c);
    if (c.id === 'retry') {
      if (rRetry) return rRetry();
      if (E.v && E.v.passo === 'confirma' && vNome && vTel) return enviarVisita();
      if (!ultimoTexto || E.etapa === 'fim') { E.etapa = 'duvida'; return puriDiz(T.pergunta, []); }
      return processar(ultimoTexto);
    }
    if (c.id === 'como_entrega') {
      limparVisita(); E.etapa = 'duvida'; E.assunto = 'duvida';
      if (E.n >= MAX_MSGS) return falhaF6(T.limiteMsgs);
      E.n++; ultimoTexto = c.t;
      return processar(c.t);
    }
    if (c.id === 'fabrica' || c.id === 'vendedor' || CIDADES[c.id] || /^(cid_outra|dia_|per_|confirmar|corrigir)/.test(c.id)) return aoChipVisita(c);
    irPara(c.id);
  }

  function limpar(t) { return t.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS); }

  function enviar() {
    if (ocupado) return; // o texto fica no campo; nada é descartado
    if (E.etapa === 'fim') { // campo normalmente travado; se chegar aqui, a Puri orienta
      campo.value = ''; campo.style.height = 'auto';
      return puriDiz(T.escolhe, E.chips && E.chips.length ? E.chips : [CH.humano]);
    }
    if (E.r && E.r.passo === 'conta') return cc ? enviarConta() : retomarConta();
    if (E.r && E.r.passo !== 'regras') return enviarR();
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
      return r && r.motivo === 'limite_dia' ? 'limite' : 'erro';
    });
  }

  // fl: {etapa: etapa enviada, tok: já reenviou por token_invalido}
  function tratar(r, texto, g, fl) {
    if (g !== ger) return;
    if (!r || !r.ok) {
      var m = r && r.motivo;
      if (m === 'limite_conversa' || m === 'limite_dia') return falhaF6();
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
      return puriDiz(r.texto, [{ id: 'outra', t: 'Outra dúvida' }, CH.humano]);
    }
    if (r.tipo === 'humano') {
      E.assunto = 'humano';
      if (fl.etapa === 'duvida') E.etapa = 'duvida'; // continua aceitando dúvida digitada
      return puriDiz(typeof r.texto === 'string' && r.texto ? r.texto : T.humano, [CH.humano]);
    }
    if (r.tipo === 'intencao') {
      switch (r.intencao) {
        case 'humano': E.assunto = 'humano'; return puriDiz(T.humano, [CH.humano]);
        case 'revender': case 'consumir': case 'provar':
          return irPara(r.intencao);
        case 'duvida':
          if (fl.etapa === 'duvida') return puriDiz(T.incerto, CH.abertura); // já era a etapa de dúvida: não recursa
          E.etapa = 'duvida'; E.assunto = 'duvida';
          E.n++; // o servidor conta as duas chamadas (abertura e dúvida); ele é a fonte de verdade, este contador é só espelho local
          return api.mensagem(E.token, 'duvida', texto).then(function (r2) { return tratar(r2, texto, g, { etapa: 'duvida', tok: fl.tok }); });
        default: return puriDiz(T.incerto, CH.abertura);
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
    if (E.r && E.r.passo === 'sim') { E.chips = chipsR('sim'); desenharChips(E.chips, false); salvar(); } // retoma a escolha de preço
    else if (E.r && ['aprof', 'palpite', 'palpite_txt', 'resumo'].indexOf(E.r.passo) >= 0) retomarR();
    else if (E.r && E.r.passo === 'conta') retomarConta(); // nome/telefone/e-mail/senha não sobrevivem ao recarregar
    else if (E.r && E.r.passo !== 'regras' && E.chips.some(function (c) { return c.id === 'retry'; })) perguntarR(E.r.passo); // falha temporária: refaz a pergunta
    observar();
  }
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
