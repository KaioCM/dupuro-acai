/* ==========================================================================
   Puri — assistente flutuante da Dupuro (Etapa 3: casca, F0/F1/F5/F6).
   IIFE autocontido, sem dependências. Injeta o próprio markup no <body>.

   CONFIG (opcional, antes do script):  window.PURI = { pagina: 'home'|'revenda'|'delivery', api: 'mock'|'edge', edgeLocal: true }
   MODO: padrão 'edge' (produção). Em localhost/127.0.0.1 vira 'mock' automaticamente,
   a menos que PURI.edgeLocal === true. PURI.api ('mock'|'edge') sobrescreve tudo.
   TESTE LOCAL: em localhost/127.0.0.1/[::1] a query ?puri=edge|mock sobrescreve o modo (ignorada em produção).
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
  var MODO = QMODO || cfg.api || ((LOCAL && cfg.edgeLocal !== true) ? 'mock' : MODO_PADRAO);

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

  // ---- Ícones inline ----
  var SVGNS = 'http://www.w3.org/2000/svg';
  function icone(d) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); s.appendChild(p); return s;
  }
  var I_CHAT = 'M4 5h16v11H9l-5 4z', I_X = 'M6 6l12 12M18 6L6 18', I_ENV = 'M4 12l16-8-6 16-3-7z', I_REC = 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7';

  // ---- Estado ----
  function novoEstado() { return { msgs: [], chips: [], token: null, n: 0, etapa: 'abertura', assunto: null, v: null }; }
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
      } else if (IDS_CHIP.indexOf(c.id) >= 0) {
        r.chips.push({ id: c.id, t: c.t });
      }
    });
    if (semChips) r.chips = [CH.humano];
    return r;
  }
  try { var salvo = normalizar(JSON.parse(sessionStorage.getItem(CHAVE) || 'null')); if (salvo) E = salvo; } catch (e) {}
  function salvar() { try { sessionStorage.setItem(CHAVE, JSON.stringify(E)); } catch (e) {} }

  // ---- Adaptador de API ----
  var api = MODO === 'edge' ? apiEdge() : apiMock();

  function apiEdge() {
    function post(corpo) {
      var base = window.DUPURO_SUPABASE_URL, k = window.DUPURO_SUPABASE_ANON_KEY;
      if (!base || !k) return Promise.resolve({ ok: false, motivo: 'erro' });
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT), t2;
      return Promise.race([
        fetch(base + '/functions/v1/assistente', {
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
    var visitasMock = 0;
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
  var btn, painel, msgs, form, campo, env, topoHum;
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
    form.appendChild(campo); form.appendChild(env);

    painel.appendChild(topo); painel.appendChild(msgs); painel.appendChild(form);
    document.body.appendChild(btn); document.body.appendChild(painel);

    btn.addEventListener('click', function () { aberto ? fechar() : abrir(); });
    fec.addEventListener('click', fechar);
    rec.addEventListener('click', recomecar);
    topoHum.addEventListener('click', function () { topoHum.href = waLink(); });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); enviar(); });
    campo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); enviar(); }
    });
    campo.addEventListener('input', function () {
      campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight, 96) + 'px';
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && aberto) fechar(); });
    window.addEventListener('resize', function () { if (aberto) travarScroll(); ajustarBotao(); });
  }

  // Campo/enviar: desligados depois do F6 (etapa 'fim') e enquanto a Puri processa.
  function atualizarCampo() {
    var fim = E.etapa === 'fim';
    campo.disabled = fim;
    env.disabled = fim || ocupado;
    campo.placeholder = fim ? T.fimCampo : 'Escreva aqui';
  }
  function movel() { return window.innerWidth < 640 || (window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  // Desktop: foca o campo. Celular: foca o painel (não abre o teclado).
  function focarEntrada() {
    if (movel() || campo.disabled) painel.focus({ preventScroll: true }); else campo.focus();
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
  function desenharTudo() {
    msgs.textContent = '';
    E.msgs.forEach(function (m) { addBalao(m.de, m.t, false); });
    desenharChips(E.chips, false);
    atualizarCampo();
    rolar(true);
  }
  function guardar(de, t) {
    E.msgs.push({ de: de, t: t });
    if (E.msgs.length > MAX_BALOES) E.msgs = E.msgs.slice(-MAX_BALOES);
    salvar();
  }
  function podarDom() { var b = baloes(); while (b.length > MAX_BALOES) { b[0].remove(); b = baloes(); } }

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
    ultimoTexto = ''; vNome = ''; vTel = '';
    E = novoEstado();
    ocupado = false; salvar(); msgs.textContent = ''; atualizarCampo(); topoHum.href = waLink();
    comecar(); focarEntrada();
  }

  var ultimoTexto = '';
  function falhaTemp() { return puriDiz(T.erroTemp, [{ id: 'retry', t: 'Tentar de novo' }, CH.humano]); }
  function falhaF6(textoFala) { E.etapa = 'fim'; return puriDiz(textoFala || T.limite, [CH.humano]); }

  // Destino de cada opção (chip ou intenção vinda de texto livre). Sem guard de `ocupado`.
  function irPara(id) {
    switch (id) {
      case 'revender': // TODO Etapa 4 (próximo lote): F4 real
        limparVisita(); E.etapa = 'abertura'; E.assunto = 'revender';
        return puriDiz(T.revender, [{ id: 'l', t: 'Ver como funciona a revenda', href: PAGINA === 'home' ? './revenda/#revenda' : (PAGINA === 'delivery' ? '../revenda/#revenda' : '#revenda') }, CH.humano]);
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
  function limparVisita() { vNome = ''; vTel = ''; E.v = null; }
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

  function aoChip(c) {
    if (ocupado) return;
    usuarioDiz(c.t);
    if (c.id === 'retry') {
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
    observar();
  }
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
