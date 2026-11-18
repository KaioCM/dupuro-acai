// ==========================================================================
// Dupuro Açaí — Chat de qualificação de revenda (MVP)
// Máquina de estados 100% LOCAL. Edge devolve {ok,objecao,segmento,interesse…} —
// só usa para atualizar dots/painel. Transições são locais. Roteiro v1.
// ==========================================================================

var DupuroChat = (function () {

  /* ------------------------------------------------------------------ */
  /*  Utilitários                                                      */
  /* ------------------------------------------------------------------ */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; }); }

  var SUPABASE_URL = window.DUPURO_SUPABASE_URL || '';
  var FUNC_PATH    = '/functions/v1/qualificar-turno';
  var ANON_KEY     = window.DUPURO_SUPABASE_ANON_KEY || '';

  /* localStorage seguro com fallback memória */
  var _mem = {};
  var safeLS = (function () {
    var testKey = '__ls_test__';
    var ok = false;
    try { localStorage.setItem(testKey, '1'); localStorage.removeItem(testKey); ok = true; } catch(e) {}
    if (!ok) return {
      getItem: function(k){ return _mem[k] !== undefined ? _mem[k] : null; },
      setItem: function(k,v){ _mem[k] = String(v); },
      removeItem: function(k){ delete _mem[k]; }
    };
    return localStorage;
  })();

  /* ------------------------------------------------------------------ */
  /*  Estado                                                             */
  /* ------------------------------------------------------------------ */

  /* Variáveis locais capturadas dos inputs livres */
  var _local = { negocio:'', bairro:'', cidade:'', nome:'', telefone:'' };
  var ctx    = { token:null, segmento:null, interesse:0 };
  var history= [];       /* [{role:'bot'|'user', text:''}] */
  var estadoAtual = null; /* chave do nó ativo */
  var emTransicao   = false;

  /* Mapeamento humano segmento/objecao que vem da Edge */
  var SEG_LABELS = {
    revenda_serio:'Revenda', varejo_curiosidade:'Varejo (curiosidade)',
    amostra_teste:'Teste', produto_duvida:'Produto',
    abrangencia_entrega:'Entrega', preco_minimo:'Preço/mínimo',
    concorrente_fornecedor:'Concorrente', duvida_operacional:'Dúvida operacional',
    sem_intencao:'—', individuo_sem_negocio:'Indivíduo'
  };
  var NEG_LABELS = {
    delivery_acai:'Delivery de açaí', acaieteria:'Açaiteria',
    lanchonete_bar:'Lanchonete/bar', feira_evento:'Feira/evento',
    mercado_varejo:'Mercado', individuo_sem_negocio:'Indivíduo'
  };

  /* ------------------------------------------------------------------ */
  /*  DOM helpers                                                       */
  /* ------------------------------------------------------------------ */

  function panelEl()  { return document.getElementById('rvPanel'); }
  function threadEl() { return document.getElementById('rvThread'); }
  function quickEl()  { return document.getElementById('rvQuick'); }
  function inputEl()  { return document.getElementById('rvInput'); }
  function sendBtn()  { return document.getElementById('rvSend'); }
  function skipLink() { return document.getElementById('rvSkip'); }
  function formWrap() { return document.getElementById('formWrapper'); }
  function chatDiv()  { return document.getElementById('rvChat'); }

  /** MENOR-A: renderiza bolha — {html:'…'} = inserido direto / {text:'…'} ou string = esc(). */
  function appendBubble(who, msg) {
    var d = document.createElement('div');
    d.className = 'rv-bubble rv-bubble--' + who;
    if (typeof msg === 'object' && typeof msg.html === 'string') {
      d.innerHTML = msg.html;
    } else {
      d.textContent = typeof msg === 'string' ? msg : '';
    }
    threadEl().appendChild(d);
    scrollThread();
  }

  function scrollThread() { threadEl().scrollTop = threadEl().scrollHeight; }

  function renderHistory() {
    threadEl().innerHTML = '';
    var i, msg;
    for (i = 0; i < history.length; i++) {
      msg = history[i];
      appendBubble(msg.role === 'bot' ? 'bot' : 'user', msg.text);
    }
  }

  function showQuick(chips) {
    var q = quickEl();
    q.innerHTML = '';
    if (!chips || chips.length === 0) { q.setAttribute('hidden', ''); return; }
    q.removeAttribute('hidden');
    var i, btn;
    for (i = 0; i < chips.length; i++) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rv-chip-rv';
      (function(chip, el) {
        el.addEventListener('click', function(e) { e.preventDefault(); handleChip(chip); });
      })(chips[i], btn);
      btn.textContent = chips[i].label;
      q.appendChild(btn);
    }
  }

  function hideQuick() { quickEl().setAttribute('hidden', ''); }

  /* ------------------------------------------------------------------ */
  /*  Painel                                                            */
  /* ------------------------------------------------------------------ */

  function updatePanel(eduResult) {
    var p = panelEl();
    if (!p) return;

    /* Segmento */
    var segDot = p.querySelector('.rv-panel-seg');
    if (segDot && ctx.segmento) {
      segDot.className = 'rv-chip-rv rv-panel-item';
      segDot.innerHTML = '<b>' + esc(SEG_LABELS[ctx.segmento] || ctx.segmento) + '</b>';
    }

    /* Info rows */
    var rows = p.querySelectorAll('.rv-panel-row-info');
    var r, row, key, val;
    for (r = 0; r < rows.length; r++) {
      row = rows[r];
      key = row.getAttribute('data-key');
      val = _local[key] || (eduResult && eduResult.campos && eduResult.campos[key]) || '';
      row.className = 'rv-panel-row-info' + (val ? '' : ' rv-panel-row-empty');
      row.querySelector('.rv-panel-val').textContent = val || '—';
    }

    /* Interesse dots */
    var dots = p.querySelectorAll('.rv-dot');
    var di;
    for (di = 0; di < dots.length; di++) {
      dots[di].className = 'rv-dot' + (di < ctx.interesse ? ' filled' : '');
    }

    /* Status legível */
    if (eduResult && eduResult.status) {
      setStatusChip(eduResult.status);
    }
  }

  function setStatusChip(status) {
    var chip = panelEl().querySelector('.rv-panel-status');
    if (!chip) return;
    chip.className = 'rv-chip-rv rv-panel-item rv-panel-status';
    var labelMap = {
      varejo:'Varejo', expansao:'Expansão', potencial:'Potencial',
      pronto_cadastro:'Pronto cadastro', sem_acao:'Sem ação'
    };
    chip.innerHTML = '<b>' + esc(labelMap[status] || status) + '</b>';
  }

  /* ------------------------------------------------------------------ */
  /*  Despedida / Rate-limit                                            */
  /* ------------------------------------------------------------------ */

  function farewell(errMsg) {
    errMsg = errMsg || 'Tá difícil por aqui. Me chama no WhatsApp:';
    var html = esc(errMsg) + ' <a href="https://wa.me/5565992888228" target="_blank" rel="noopener">(65) 99288-8228</a>';
    appendBubble('bot', { html: html });
    hideQuick();
    skipLink().style.display = 'none';
    inputEl().disabled = true;
    sendBtn().disabled = true;
  }

  /* ------------------------------------------------------------------ */
  /*  API                                                               */
  /* ------------------------------------------------------------------ */

  async function iniciar() {
    try {
      var stored = safeLS.getItem('dupuro_lead');
      if (stored && stored.length > 0) {
        ctx.token = stored;
        return true;
      }
      var res = await fetch(SUPABASE_URL + FUNC_PATH, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ acao:'iniciar' })
      });
      var body = await res.json().catch(function(){ return {}; });
      if (!res.ok || !body.ok) throw new Error(body.erro || 'Falha');
      ctx.token = body.token;
      safeLS.setItem('dupuro_lead', body.token);
      return true;
    } catch(e) { console.warn('[DupuroChat] iniciar:', e); return false; }
  }

  /** Chama turno — envia campos locais. Usa resposta SOLO para atualização de painel.
   * REDE FALHA → sempre farewell() antes de rethrow. */
  async function callTurno(textoUsuario) {
    try {
      var payload = {
        acao:'turno',
        token: ctx.token,
        texto: (textoUsuario||'').substring(0,300),
        campos: Object.assign({}, _local)
      };
      var res = await fetch(SUPABASE_URL + FUNC_PATH, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', apikey: ANON_KEY },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        /* 429 ou qualquer outro HTTP erro → SEMPRE farewell com wa.me */
        var errBody;
        try { errBody = await res.json(); } catch(e2){ errBody = {}; }
        var msg = (res.status === 429 ? 'Limite de tentativas.' :
                   errBody.erro && errBody.erro !== 'limite' ? errBody.erro : 'Erro na conexão.');
        farewell(msg);
        throw new Error(res.status + ' ' + msg);
      }
      var body = await res.json().catch(function(){ return {}; });
      if (!body.ok) throw new Error(body.erro || 'Resposta inválida');
      return body;
    } catch(e) {
      console.warn('[DupuroChat] callTurno:', e);
      throw e; // rethrow → try/finally do caller liberta trava; farewell já rodou
    }
  }

  async function flagStatus(st) {
    try {
      await fetch(SUPABASE_URL + FUNC_PATH, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ acao:'flag', token:ctx.token, status:st })
      });
    } catch(e) { console.warn('[DupuroChat] flag:', e); }
  }

  async function converter() {
    try {
      var client = window.DupuroSupabaseClient;
      var session = await client.auth.getSession();
      if (!session.data.session) return false;
      var res = await fetch(SUPABASE_URL + FUNC_PATH, {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          apikey: ANON_KEY,
          'Authorization':'Bearer ' + session.data.session.access_token
        },
        body: JSON.stringify({ acao:'converter', token: ctx.token })
      });
      var body = await res.json().catch(function(){ return {}; });
      if (!res.ok || !body.ok) return false;
      safeLS.removeItem('dupuro_lead');
      ctx.token = null;
      return true;
    } catch(e) { console.warn('[DupuroChat] converter:', e); return false; }
  }

  /* ------------------------------------------------------------------ */
  /*  Nó helper — empilha histórico + mostra bot + quick               */
  /* ------------------------------------------------------------------ */

  /** D5: statePush aceita opts com end:true → desabilita input/send, mantém skip visível. */
  function statePush(key, botMsg, chips, opts) {
    estadoAtual = key;
    appendBubble('bot', typeof botMsg === 'string' ? botMsg : '');
    history.push({ role:'bot', text: botMsg });
    showQuick(chips);
    inputEl().value = '';
    inputEl().removeAttribute('placeholder');
    skipLink().style.display = '';
    if (opts && opts.end) {
      inputEl().disabled = true;
      sendBtn().disabled = true;
      /* Mantém skipLink visível */
    }
  }

  /* ------------------------------------------------------------------ */
  /*  NODES — Roteiro v1 (100% LOCAL)                                  */
  /* ------------------------------------------------------------------ */

  var nodes = {

    /* ---- N0 – entrada ---- */
    'N0': function() {
      statePush('N0',
        'Fala! Aqui é a Dupuro Açaí, fábrica em Cuiabá. Em 1 minuto eu te digo se a revenda cabe no seu negócio. Como você está chegando?',
        [
          { label:'Quero revender' },
          { label:'Comprar pra consumir' },
          { label:'Só dando uma olhada' }
        ]
      );
    },

    /* ---- B-Varejo (direto de "comprar pra consumir") ---- */
    'B-Varejo': function() {
      ctx.segmento = 'varejo_curiosidade';
      flagStatus('varejo').then(function(){});
      statePush('B-Varejo',
        'Fechado! Varejo a gente entrega direto na sua casa — catálogo completo aqui: dupuroacai.com/delivery. Retirada: Av. das Torres, 16, Jd. Imperial II. Se a ideia de revenda aparecer depois, é só voltar aqui.',
        [
          { label:'Quero revender agora' },
          { label:'Ver catálogo varejo', link:'https://dupuroacai.com/delivery' }
        ],
        { end:true }
      );
    },

    /* ---- B-Olhando (trânsito: curiosidade → volta ou sai) ---- */
    'B-Olhando': function() {
      statePush('B-Olhando',
        'Sem problema. Se a ideia virar negociozinho com açaí, a gente monta condição a partir de 1 caixa de 10 L. Posso te mostrar o catálogo de varejo enquanto isso?',
        [
          { label:'Quero revender agora' },
          { label:'Ver catálogo varejo', link:'https://dupuroacai.com/delivery' }
        ]
      );
    },

    /* ---- R1 – tipo de negócio (input livre) ---- */
    'R1': function(result) {
      var botText = 'Show. Que tipo de negócio é (ou vai ser)? Delivery de açaí, açaiteria, lanchonete, feira… me diz do seu jeito.';
      var chips = [
        { label:'Delivery de açaí' },
        { label:'Açaiteria' },
        { label:'Lanchonete' },
        { label:'Outro' }
      ];

      /* Branch: curiosidade varejo sem negócio definido */
      if (result && result.objecao === 'varejo_curiosidade' &&
          (result.segmento === 'individuo_sem_negocio' || !result.segmento)) {
        botText = 'Só pra eu não te enrolar: é pra consumir em casa ou pra revender mesmo?';
        chips = [ { label:'Revender' }, { label:'Consumir' } ];
      }
      statePush('R1', botText, chips);
    },

    /* ---- R2 – localização (input livre) ---- */
    'R2': function() {
      statePush('R2',
        'Onde vocês ficam? Bairro e cidade.',
        [ { label:'Cuiabá' }, { label:'Várzea Grande' }, { label:'Outra cidade' } ]
      );
    },

    /* ---- R3 – pitch + preço/mínimo em sequência (D6) ---- */
    'R3': function() {
      /* Mensagem pitch padrão */
      appendBubble('bot', 'Boa! Quem revende trabalha com caixa de 10 L: rende muitos copos e a margem típica passa de 2x. O pedido mínimo é 1 caixa por produto — 50 L no pedido dispensam mínimo. Começa pequeno, repete quando rodar.');
      history.push({ role:'bot', text:'Boa! Quem revende trabalha com caixa de 10 L: rende muitos copos e a margem típica passa de 2x. O pedido mínimo é 1 caixa por produto — 50 L no pedido dispensam mínimo. Começa pequeno, repete quando rodar.' });
      /* R4a mensagem preço */
      appendBubble('bot', 'Faz a conta comigo: o valor fecha no seu orçamento — me deixa fechar o cadastro que a gente te manda a tabela de revenda com tudo.');
      history.push({ role:'bot', text:'Faz a conta comigo: o valor fecha no seu orçamento — me deixa fechar o cadastro que a gente te manda a tabela de revenda com tudo.' });
      /* R4b mensagem mínimo */
      appendBubble('bot', '1 caixa por produto te coloca na rota; 50 L somados no pedido dispensam o mínimo. Dá pra misturar açaí e creme.');
      history.push({ role:'bot', text:'1 caixa por produto te coloca na rota; 50 L somados no pedido dispensam o mínimo. Dá pra misturar açaí e creme.' });
      estadoAtual = 'R3-price-min';
      showQuick([
        { label:'Como funciona o pagamento' },
        { label:'Quero testar antes' },
        { label:'Fechar cadastro' }
      ]);
      inputEl().value = '';
      inputEl().removeAttribute('placeholder');
      skipLink().style.display = '';
    },

    /* ---- R4a – preço ---- */
    'R4a': function() {
      statePush('R4a',
        'Faz a conta comigo: o valor fecha no seu orçamento — me deixa fechar o cadastro que a gente te manda a tabela de revenda com tudo.',
        [ { label:'Fechar cadastro' } ]
      );
    },

    /* ---- R4c – pagamento ---- */
    'R4c': function() {
      statePush('R4c',
        'O primeiro pedido pode ser com pagamento na entrega; a partir do segundo você paga como quiser pelo painel.',
        [ { label:'Fechar cadastro' } ]
      );
    },

    /* ---- R4d – amostra (fala transitória) MENOR-Es: match cuiabá/VG EXATO ---- */
    'R4d': function() {
      var city = (_local.cidade||'').toLowerCase();
      /* Apenas ['cuiabá','várzea grande','varzea grande']; curitiba FORA → expansão */
      var insideCVG = city === 'cuiabá' || city === 'várzea grande' || city === 'varzea grande';
      var botText = insideCVG
        ? 'Melhor que conversa é colherada: passa na fábrica (Av. das Torres, 16, Jd. Imperial II) e prova com a gente.'
        : 'Anotado que você quer testar antes — nosso time fala com você sobre amostra.';
      statePush('R4d', botText, [ { label:'Fechar cadastro' } ]);
    },

    /* ---- R5-nome (coleta local) ---- */
    'R5-nome': function() {
      statePush('R5-nome',
        'Fechado! Como te chamam?',
        [ { label:'João Silva' }, { label:'Maria Santos' }, { label:'Outro' } ]
      );
    },

    /* ---- R5-telefone (coleta local) ---- */
    'R5-telefone': function() {
      statePush('R5-telefone',
        'Melhor telefone pra gente te chamar?',
        [ { label:'(65) 99999-9999' }, { label:'Outro' } ]
      );
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Handler raiz: tenta/chips → try/finally                          */
  /* ------------------------------------------------------------------ */

  async function handleChip(chipData) {
    if (emTransicao) return;
    emTransicao = true;

    try {
      /* -- N0 direct branches -- */
      if (estadoAtual === 'N0') {
        history.push({ role:'user', text: chipData.label });

        if (chipData.link) { window.open(chipData.link, '_blank', 'noopener'); emTransicao=false; return; }

        var n0map = { 'Quero revender':'R1', 'Comprar pra consumir':'B-Varejo', 'Só dando uma olhada':'B-Olhando' };
        var seg = { 'Quero revender':'revenda_serio', 'Comprar pra consumir':'varejo_curiosidade', 'Só dando uma olhada':'sem_intencao' };
        ctx.segmento = seg[chipData.label] || ctx.segmento;
        ctx.interesse = chipData.label === 'Quero revender' ? 2 : 1;

        await callTurno(chipData.label);
        updatePanel({});
        emitFlagFromSegment();

        if (n0map[chipData.label]) { nodes[n0map[chipData.label]](); return; }
        /* Sem mapeamento → R1 default */
        nodes['R1']({});
        return;
      }

      /* -- B-Olhando branches -- */
      if (estadoAtual === 'B-Olhando') {
        history.push({ role:'user', text: chipData.label });

        if (chipData.label === 'Quero revender agora') {
          ctx.segmento = 'revenda_serio';
          ctx.interesse = Math.max(ctx.interesse, 3);
          await callTurno('Quero revender agora');
          updatePanel({});
          nodes['R1']({});
          return;
        }
        if (chipData.link) { window.open(chipData.link, '_blank', 'noopener'); emTransicao=false; return; }
        /* Ver catálogo varejo → B-Varejo */
        ctx.segmento = 'varejo_curiosidade';
        await flagStatus('varejo');
        nodes['B-Varejo']();
        return;
      }

      /* -- B-Varejo end state: chips só abrem links, nada navega (D5) -- */
      if (estadoAtual === 'B-Varejo') {
        if (chipData.link) { window.open(chipData.link, '_blank', 'noopener'); }
        /* Chips sem link = sem ação (input/disabled pelo opts.end) */
        emTransicao = false;
        return;
      }

      /* -- R1 branches -- */
      if (estadoAtual === 'R1') {
        history.push({ role:'user', text: chipData.label });
        /* Bug fix 1: todo label nao-link dispara turno best-effort */
        if (!chipData.link) { (async function(){ try{ var r = await callTurno(chipData.label); updatePanel(r||{}); emitFlagFromSegment(); }catch(e){} })(); }

        /* Branch especial: Consumir → vai p/ varejo direto */
        if (chipData.label === 'Consumir') {
          ctx.segmento = 'varejo_curiosidade';
          await flagStatus('varejo');
          nodes['B-Varejo']();
          return;
        }
        /* Revender → R2 MENOR-Es: _local.negocio='Revenda de açaí' */
        if (chipData.label === 'Revender') {
          _local.negocio = 'Revenda de açaí';
          nodes['R2']();
          return;
        }

        _local.negocio = chipData.label;
        nodes['R2']();
        return;
      }

      /* -- R2 branches -- */
      if (estadoAtual === 'R2') {
        history.push({ role:'user', text: chipData.label });
        /* Bug fix 1: todo label nao-link dispara turno best-effort */
        if (!chipData.link) { (async function(){ try{ var r = await callTurno(chipData.label); updatePanel(r||{}); emitFlagFromSegment(); }catch(e){} })(); }
        if (chipData.label === 'Cuiabá') {
          _local.bairro = ''; _local.cidade = 'Cuiabá';
          nodes['R3']();
        } else if (chipData.label === 'Várzea Grande') {
          _local.bairro = ''; _local.cidade = 'Várzea Grande';
          nodes['R3']();
        } else {
          /* D4: Outra cidade NÃO avança — aguarda texto livre */
          hideQuick();
        }
        return;
      }

      /* -- R3 branches (preço e mínimo em sequência, sem R4b separado) -- */
      if (estadoAtual === 'R3' || estadoAtual === 'R3-price-min') {
        history.push({ role:'user', text: chipData.label });
        ctx.interesse = 3;
        await callTurno(chipData.label);
        updatePanel({});
        var r3map = {
          'Como funciona o pagamento':'R4c',
          'Quero testar antes':'R4d',
          'Fechar cadastro':'R5-nome'
        };
        /* 'Preço/mínimo' já foi consumido pelo nó R3 (duas bubbles automáticas) */
        var target = r3map[chipData.label];
        if (target && nodes[target]) { nodes[target](); return; }
        /* Se veio de R3-price-min e não reconheceu → mantêm no nó */
        return;
      }

      /* -- R4a/R4b/R4c/R4d branches (CRÍTICO-D1: inclui R4d) -- */
      if (estadoAtual === 'R4a' || estadoAtual === 'R4b' || estadoAtual === 'R4c' || estadoAtual === 'R4d') {
        history.push({ role:'user', text: chipData.label });
        /* Bug fix 1: todo label nao-link dispara turno best-effort */
        if (!chipData.link) { (async function(){ try{ var r = await callTurno(chipData.label); updatePanel(r||{}); emitFlagFromSegment(); }catch(e){} })(); }
        ctx.interesse = 3;
        nodes['R5-nome']();
        return;
      }

      /* -- R5-nome -- */
      if (estadoAtual === 'R5-nome') {
        history.push({ role:'user', text: chipData.label });
        /* Bug fix 1: todo label nao-link dispara turno best-effort */
        if (!chipData.link) { (async function(){ try{ var r = await callTurno(chipData.label); updatePanel(r||{}); emitFlagFromSegment(); }catch(e){} })(); }
        _local.nome = chipData.label;
        nodes['R5-telefone']();
        return;
      }

      /* -- R5-telefone -- */
      if (estadoAtual === 'R5-telefone') {
        history.push({ role:'user', text: chipData.label });
        _local.telefone = chipData.label;
        /* Validar dígitos≥10 antes de gravar */
        var digits = _local.telefone.replace(/\D/g,'');
        if (digits.length < 10) {
          appendBubble('bot', 'Precisa ter pelo menos 10 dígitos. Digita de novo.');
          history.push({ role:'bot', text:'Precisa ter pelo menos 10 dígitos. Digita de novo.' });
          nodes['R5-telefone']();
          return;
        }
        ctx.interesse = 3;
        flagStatus('pronto_cadastro').then(function(){});
        /* Bug fix 2: persistir contato na linha ANTES do reveal */
        _persistContact();
        fillFormAndReveal();
        return;
      }

      /* -- Sair / desistir (qualquer nó) -- */
      var desistir = ['depois falo','sair','não quero','fechar','dar um tchau'];
      if (desistir.indexOf(chipData.label.toLowerCase()) >= 0 || chipData.label === 'Sair') {
        history.push({ role:'user', text: chipData.label });
        appendBubble('bot', 'Sem pressão. Quando quiser começar, é aqui — a partir de 1 caixa.');
        history.push({ role:'bot', text:'Sem pressão. Quando quiser começar, é aqui — a partir de 1 caixa.' });
        var li = ctx.interesse;
        flagStatus(li >= 2 ? 'potencial' : 'sem_acao').then(function(){});
        hideQuick();
        skipLink().style.display = 'none';
        return;
      }

      /* -- Free-text handler (qualquer nó que aceite input) -- */
      handleFreeText(chipData.label);
    } finally {
      emTransicao = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Texto livre                                                       */
  /* ------------------------------------------------------------------ */

  /** Texto livre — async; try/finally liberta trava; avanços locais (CRÍTICO-C+D2). */
  async function handleFreeText(userText) {
    if (emTransicao) return;
    emTransicao = true;
    try {
      history.push({ role:'user', text:userText.substring(0,300)});
      ctx.interesse = Math.max(ctx.interesse, 1);

      /* -- R5-telefone (validação antes de tudo) -- */
      if (estadoAtual === 'R5-telefone') {
        _local.telefone = userText;
        var digits = _local.telefone.replace(/\D/g,'');
        if (digits.length < 10) {
          appendBubble('bot', 'Precisa ter pelo menos 10 dígitos. Digita de novo.');
          history.push({ role:'bot', text:'Precisa ter pelo menos 10 dígitos. Digita de novo.' });
          return;
        }
        ctx.interesse = 3;
        flagStatus('pronto_cadastro').then(function(){});
        /* Bug fix 2: persistir contato na linha ANTES do reveal */
        _persistContact();
        fillFormAndReveal();
        return;
      }

      /* -- R5-nome → avança p/ telefone (CRÍTICO-D2) -- */
      if (estadoAtual === 'R5-nome') {
        _local.nome = userText.substring(0,300);
        nodes['R5-telefone']();
        return;
      }

      /* -- R1 → grava negocio, avança p/ R2 (CRÍTICO-D2) -- */
      if (estadoAtual === 'R1') {
        _local.negocio = userText.substring(0,300);
        hideQuick();
        appendBubble('bot', 'Show! E onde vocês ficam? Bairro e cidade.');
        history.push({ role:'bot', text:'Show! E onde vocês ficam? Bairro e cidade.' });
        nodes['R2']();
        /* callTurno best-effort em paralelo */
        (async function(){ try { var r = await callTurno(userText.substring(0,300)); updatePanel(r||{}); emitFlagFromSegment(); } catch(e){} })();
        return;
      }

      /* -- R2 → parse cidade/bairro, avança p/ R3 (CRÍTICO-D2) -- */
      if (estadoAtual === 'R2') {
        var raw = userText.substring(0,300);
        var commaIdx = raw.indexOf(',');
        if (commaIdx >= 0) {
          _local.bairro = raw.substring(0, commaIdx).trim();
          _local.cidade = raw.substring(commaIdx+1).trim();
        } else {
          _local.cidade = raw;
        }
        /* Verifica se é Cuiabá/Várzea Grande */
        var cityLower = (_local.cidade||'').toLowerCase();
        var outsideCVG = cityLower !== 'cuiabá' && cityLower !== 'várzea grande' && cityLower !== 'varzea grande';
        if (outsideCVG) {
          appendBubble('bot', 'Atendemos fora com caixa fechada e transporte a combinar — te anoto como expansão.');
          history.push({ role:'bot', text:'Atendemos fora com caixa fechada e transporte a combinar — te anoto como expansão.' });
          flagStatus('expansao').then(function(){});
        } else {
          appendBubble('bot', 'Boa! Quem revende trabalha com caixa de 10 L: rende muitos copos e a margem típica passa de 2x. O pedido mínimo é 1 caixa por produto — 50 L no pedido dispensam mínimo. Começa pequeno, repete quando rodar.');
          history.push({ role:'bot', text:'Boa! Quem revende trabalha com caixa de 10 L: rende muitos copos e a margem típica passa de 2x. O pedido mínimo é 1 caixa por produto — 50 L no pedido dispensam mínimo. Começa pequeno, repete quando rodar.' });
        }
        hideQuick();
        nodes['R3']();
        /* callTurno best-effort */
        (async function(){ try { var r = await callTurno(raw); updatePanel(r||{}); emitFlagFromSegment(); } catch(e){} })();
        return;
      }

      /* -- Desistir / sair (free-text normalizado) — MAJOR-D3 -- */
      var txtNorm = userText.toLowerCase();
      var sairKeywords = ['sair','depois eu falo','depois falo','não quero','nao quero'];
      var si;
      for (si = 0; si < sairKeywords.length; si++) {
        if (txtNorm.indexOf(sairKeywords[si]) >= 0) {
          appendBubble('bot', 'Sem pressão. Quando quiser começar, é aqui — a partir de 1 caixa.');
          history.push({ role:'bot', text:'Sem pressão. Quando quiser começar, é aqui — a partir de 1 caixa.' });
          var li = ctx.interesse;
          flagStatus(li >= 2 ? 'potencial' : 'sem_acao').then(function(){});
          hideQuick();
          skipLink().style.display = 'none';
          inputEl().disabled = true;
          sendBtn().disabled = true;
          return;
        }
      }

      /* -- Free-turno genérico (qualquer outro nó) -- */
      callTurno(userText.substring(0,300)).then(function(result) {
        updatePanel(result || {});
        emitFlagFromSegment();
      }).catch(function() { /* Edge silenciosa — node continua ativo */ });
    } finally {
      emTransicao = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers de sinalização                                           */
  /* ------------------------------------------------------------------ */

  /** Bug fix 2: persiste contato na linha antes do reveal */
  function _persistContact() {
    /* Bug fix 2: persiste contato na linha ANTES do reveal */
    /* _local já tem nome e telefone válidos; callTurno monta campos:{...} por ele */
    (async function(){ try{ await callTurno('fechar cadastro'); }catch(e){} })();
  }

  function emitFlagFromSegment() {
    if (ctx.segmento === 'varejo_curiosidade') {
      flagStatus('varejo').then(function(){});
    } else if (ctx.segmento === 'revenda_serio') {
      /* Flag será chamada nos pontos explicitos (R5-done etc.) */
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Preencher form + revelar                                        */
  /* ------------------------------------------------------------------ */

  function fillFormAndReveal() {
    var nomeField  = document.getElementById('nome');
    var empresaFld = document.getElementById('empresa');
    var telField   = document.getElementById('telefone');
    var cidField   = document.getElementById('cidade');

    if (nomeField)           nomeField.value           = _local.nome  || '';
    if (empresaFld)          empresaFld.value           = _local.negocio || '';
    if (telField)            telField.value             = _local.telefone || '';
    if (cidField)            cidField.value             = _local.cidade || '';

    /* Ocultar chat, revelar form */
    chatDiv().setAttribute('hidden', '');
    formWrap().classList.remove('hidden');

    /* Toast hint */
    var toast = document.createElement('div');
    toast.style.cssText = 'background:var(--cream-2);border:2px solid var(--gold);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--roxo-950);font-weight:600;';
    toast.textContent = 'Confere o que dá pra completar: e-mail e senha';
    var h3 = formWrap().querySelector('h3');
    if (h3) h3.parentNode.insertBefore(toast, h3.nextSibling);
    else    formWrap().insertBefore(toast, formWrap().firstChild);
  }

  /* ------------------------------------------------------------------ */
  /*  Skip                                                              */
  /* ------------------------------------------------------------------ */

  function handleSkip() {
    chatDiv().setAttribute('hidden', '');
    formWrap().classList.remove('hidden');
    var toast = document.createElement('div');
    toast.style.cssText = 'background:var(--cream-2);border:2px solid var(--gold);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--roxo-950);font-weight:600;';
    toast.textContent = 'Preenche manualmente seus dados abaixo';
    var h3 = formWrap().querySelector('h3');
    if (h3) h3.parentNode.insertBefore(toast, h3.nextSibling);
    else    formWrap().insertBefore(toast, formWrap().firstChild);
  }

  /* ------------------------------------------------------------------ */
  /*  Falha no iniciar() → alternativa ao formulário                    */
  /* ------------------------------------------------------------------ */

  function handleInitFailure() {
    /* PROIBIDO esconder #rvChat — já está visível */
    /* MAJOR-B: fillFormAndReveal SÍNCRONO, sem setTimeout */
    var msg = 'Não consegui conversar por aqui. Você pode preencher o cadastro direto ou falar comigo no ';
    var html = esc(msg) + '<a href="https://wa.me/5565992888228" target="_blank" rel="noopener">WhatsApp (65) 99288-8228</a>.';
    appendBubble('bot', { html: html });
    hideQuick();
    skipLink().style.display = 'none';
    /* Revela form SINCRONO */
    fillFormAndReveal();
  }

  /* ------------------------------------------------------------------ */
  /*  Init                                                              */
  /* ------------------------------------------------------------------ */

  async function init() {
    var chatDivInst = chatDiv();
    if (!chatDivInst) return;
    chatDivInst.removeAttribute('hidden');

    var started = await iniciar();
    if (!started) {
      handleInitFailure();
      return;
    }

    skipLink().style.display = '';
    renderHistory();
    updatePanel({});
    nodes['N0']();
  }

  /* ------------------------------------------------------------------ */
  /*  Conversão pós-signup                                              */
  /* ------------------------------------------------------------------ */

  function notifyConversion() {
    if (!ctx.token) return;
    converter().then(function(ok) {
      if (ok) console.log('[DupuroChat] conversão registrada');
    }).catch(function(e) { console.warn('[DupuroChat] notifyConversion:', e); });
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  return {
    init: init,
    notifyConversion: notifyConversion,
    _skip: handleSkip,
    _handleChip: handleChip,
    _handleFreeText: handleFreeText
  };

})();

/* ---------------------------------------------------------------------- */
/*  Boot                                                                  */
/* ---------------------------------------------------------------------- */

(function() {
  if (typeof DupuroChat === 'undefined') return;

  function boot() {
    var inputEl = document.getElementById('rvInput');
    var sendBtn = document.getElementById('rvSend');
    var skipLnk = document.getElementById('rvSkip');

    if (sendBtn) {
      sendBtn.addEventListener('click', function() {
        var text = (inputEl.value || '').trim();
        if (!text) return;
        DupuroChat._handleFreeText(text);
        inputEl.value = '';
      });
    }

    if (inputEl) {
      inputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          var text = (inputEl.value || '').trim();
          if (!text) return;
          DupuroChat._handleFreeText(text);
          inputEl.value = '';
        }
      });
    }

    if (skipLnk) {
      skipLnk.addEventListener('click', function(e) {
        e.preventDefault();
        if (DupuroChat._skip) DupuroChat._skip();
      });
    }

    DupuroChat.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
