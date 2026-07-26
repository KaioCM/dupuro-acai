// ==========================================================================
// Dupuro Açaí — Impressão da comanda (impressora térmica Sweda, ESC/POS)
// ==========================================================================
// Dois caminhos, na ordem de preferência:
//
//  1) Web Serial (Chrome/Edge no Windows): fala ESC/POS direto com a impressora.
//     A atendente autoriza a porta UMA vez; nas próximas aberturas do caixa o
//     navegador já lembra dela (navigator.serial.getPorts()) e a comanda sai
//     sozinha, sem diálogo nenhum. Exige HTTPS ou localhost (temos os dois).
//
//  2) Impressão pelo Windows (fallback): monta a MESMA comanda em HTML de 80mm
//     e chama o diálogo de impressão do navegador. Usado quando a Sweda está
//     instalada só como impressora do Windows (sem porta COM) ou quando o
//     navegador não tem Web Serial.
//
// Acentos: a impressora não entende UTF-8 — o texto é convertido para a página
// de código CP850 (Latin-1 ocidental), que é a que a Sweda usa por padrão.
// ==========================================================================

var DupuroPrinter = (function () {

  var LARGURA = 48;          // colunas do papel 80mm (fonte A)
  var port = null;           // porta serial conectada
  var writer = null;

  // ---------- ESC/POS ----------
  var ESC = 0x1B, GS = 0x1D;
  var CMD = {
    init: [ESC, 0x40],
    cp850: [ESC, 0x74, 0x02],       // seleciona a página de código CP850
    alignLeft: [ESC, 0x61, 0x00],
    alignCenter: [ESC, 0x61, 0x01],
    boldOn: [ESC, 0x45, 0x01],
    boldOff: [ESC, 0x45, 0x00],
    grande: [GS, 0x21, 0x11],       // dobro de largura e altura
    normal: [GS, 0x21, 0x00],
    cortar: [GS, 0x56, 0x41, 0x10]  // corte parcial, com avanço do papel
  };

  // Unicode → byte CP850 (só o que aparece em português).
  var CP850 = {
    'á': 0xA0, 'à': 0x85, 'â': 0x83, 'ã': 0xC6, 'ä': 0x84,
    'é': 0x82, 'è': 0x8A, 'ê': 0x88, 'ë': 0x89,
    'í': 0xA1, 'ì': 0x8D, 'î': 0x8C, 'ï': 0x8B,
    'ó': 0xA2, 'ò': 0x95, 'ô': 0x93, 'õ': 0xE4, 'ö': 0x94,
    'ú': 0xA3, 'ù': 0x97, 'û': 0x96, 'ü': 0x81,
    'ç': 0x87, 'ñ': 0xA4,
    'Á': 0xB5, 'À': 0xB7, 'Â': 0xB6, 'Ã': 0xC7, 'Ä': 0x8E,
    'É': 0x90, 'Ê': 0xD2, 'Ë': 0xD3,
    'Í': 0xD6, 'Ó': 0xE0, 'Ô': 0xE2, 'Õ': 0xE5, 'Ö': 0x99,
    'Ú': 0xE9, 'Ü': 0x9A, 'Ç': 0x80, 'Ñ': 0xA5,
    'º': 0xA7, 'ª': 0xA6, '°': 0xF8, '²': 0xFD
  };

  function bytesDoTexto(texto) {
    var out = [];
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      var code = ch.charCodeAt(0);
      if (code < 128) out.push(code);
      else if (CP850[ch] !== undefined) out.push(CP850[ch]);
      else out.push(0x3F); // '?' para o que a impressora não conhece
    }
    return out;
  }

  // ---------- Conteúdo da comanda (compartilhado pelos dois caminhos) ----------
  function brl(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  // "Coca x2" à esquerda e "R$ 12,00" à direita, na mesma linha de 48 colunas.
  function linhaDupla(esquerda, direita, largura) {
    largura = largura || LARGURA;
    var espaco = largura - esquerda.length - direita.length;
    if (espaco < 1) {
      // Nome longo: quebra e joga o valor sozinho na linha de baixo, alinhado.
      var corte = largura - direita.length - 1;
      return esquerda.slice(0, corte) + ' ' + direita;
    }
    return esquerda + new Array(espaco + 1).join(' ') + direita;
  }

  function quebrar(texto, largura) {
    largura = largura || LARGURA;
    var linhas = [];
    var palavras = String(texto).split(' ');
    var atual = '';
    palavras.forEach(function (p) {
      if (!atual.length) atual = p;
      else if ((atual + ' ' + p).length <= largura) atual += ' ' + p;
      else { linhas.push(atual); atual = p; }
    });
    if (atual.length) linhas.push(atual);
    return linhas;
  }

  // venda = { numero, cliente, hora, total, items: [{ nome, quantidade, sabor,
  //           modo, valor, acompanhamentos: [nomes], pesoKg, precoKg }] }
  // Retorna as linhas da comanda (texto puro, largura fixa) + marcações simples.
  function montarLinhas(venda) {
    var L = [];
    var hora = new Date(venda.hora || Date.now())
      .toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    L.push({ t: 'DUPURO AÇAÍ', center: true, grande: true });
    L.push({ t: 'Puro como tem que ser', center: true });
    L.push({ t: 'Av. das Torres, 16 - Jardim Imperial II', center: true });
    L.push({ t: '(66) 99654-9545', center: true });
    L.push({ t: '-' });
    L.push({ t: venda.numero, bold: true });
    L.push({ t: hora });
    L.push({ t: 'Cliente: ' + (venda.cliente || 'Balcão') });
    L.push({ t: '-' });

    (venda.items || []).forEach(function (it) {
      if (it.modo === 'peso') {
        var peso = Number(it.pesoKg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 });
        L.push({ t: linhaDupla(it.nome, brl(it.valor)), bold: true });
        L.push({ t: '  ' + peso + ' kg x ' + brl(it.precoKg) + '/kg' });
      } else {
        L.push({ t: linhaDupla(it.quantidade + 'x ' + it.nome, brl(it.valor)), bold: true });
        if (it.sabor) L.push({ t: '  Sabor: ' + it.sabor });
        if (it.acompanhamentos && it.acompanhamentos.length) {
          // Recua também as linhas de continuação, pra lista ficar sob o item.
          quebrar('+ ' + it.acompanhamentos.join(', '), LARGURA - 2).forEach(function (linha) {
            L.push({ t: '  ' + linha });
          });
        }
      }
    });

    L.push({ t: '-' });
    L.push({ t: linhaDupla('TOTAL', brl(venda.total)), bold: true, grande: false });
    L.push({ t: '' });
    L.push({ t: 'Obrigado pela preferência!', center: true });
    L.push({ t: 'Não é documento fiscal', center: true });
    return L;
  }

  // ---------- Caminho 1: Web Serial (ESC/POS direto) ----------
  function suportaSerial() {
    return typeof navigator !== 'undefined' && !!navigator.serial;
  }

  function conectado() { return !!port && !!writer; }

  async function abrirPorta(p) {
    await p.open({ baudRate: 9600 });
    port = p;
    writer = p.writable.getWriter();
    return true;
  }

  // Reaproveita uma porta já autorizada antes (sem pedir nada à atendente).
  async function autoConectar() {
    if (!suportaSerial() || conectado()) return conectado();
    try {
      var portas = await navigator.serial.getPorts();
      if (!portas.length) return false;
      await abrirPorta(portas[0]);
      return true;
    } catch (e) { return false; }
  }

  // Pede a porta à atendente (só pode ser chamado a partir de um clique dela).
  async function conectar() {
    if (!suportaSerial()) return { error: new Error('Este navegador não tem Web Serial. Use o Chrome ou o Edge.') };
    try {
      if (conectado()) return { error: null };
      var p = await navigator.serial.requestPort();
      await abrirPorta(p);
      return { error: null };
    } catch (e) {
      return { error: e };
    }
  }

  async function desconectar() {
    try {
      if (writer) { writer.releaseLock(); writer = null; }
      if (port) { await port.close(); port = null; }
    } catch (e) { /* já estava fechada */ }
  }

  async function imprimirSerial(venda) {
    if (!conectado()) return { error: new Error('Impressora não conectada') };
    var bytes = [];
    function push(arr) { bytes = bytes.concat(arr); }

    push(CMD.init);
    push(CMD.cp850);

    montarLinhas(venda).forEach(function (l) {
      if (l.t === '-') {
        push(CMD.alignLeft);
        push(bytesDoTexto(new Array(LARGURA + 1).join('-')));
        push([0x0A]);
        return;
      }
      push(l.center ? CMD.alignCenter : CMD.alignLeft);
      if (l.grande) push(CMD.grande);
      if (l.bold) push(CMD.boldOn);
      push(bytesDoTexto(l.t));
      push([0x0A]);
      if (l.bold) push(CMD.boldOff);
      if (l.grande) push(CMD.normal);
    });

    push([0x0A, 0x0A, 0x0A]);
    push(CMD.cortar);

    try {
      await writer.write(new Uint8Array(bytes));
      return { error: null };
    } catch (e) {
      // Cabo tirado / impressora desligada: derruba a conexão pra permitir religar.
      await desconectar();
      return { error: e };
    }
  }

  // HTML da comanda (80mm) — compartilhado pela impressão do navegador (iframe)
  // e pela impressão nativa do app (Electron manda esse HTML pra impressora).
  function htmlDaComanda(venda) {
    var linhas = montarLinhas(venda).map(function (l) {
      if (l.t === '-') return '<div class="hr"></div>';
      var cls = (l.center ? ' center' : '') + (l.bold ? ' bold' : '') + (l.grande ? ' grande' : '');
      return '<div class="l' + cls + '">' + (l.t === '' ? '&nbsp;' : l.t.replace(/&/g, '&amp;').replace(/</g, '&lt;')) + '</div>';
    }).join('');

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + venda.numero + '</title><style>' +
      '@page { size: 80mm auto; margin: 0; }' +
      'body { margin: 0; padding: 4mm 3mm; font-family: "Courier New", monospace; font-size: 12px; line-height: 1.35; color: #000; width: 74mm; }' +
      '.l { white-space: pre-wrap; }' +
      '.center { text-align: center; }' +
      '.bold { font-weight: 700; }' +
      '.grande { font-size: 19px; font-weight: 700; letter-spacing: 1px; }' +
      '.hr { border-top: 1px dashed #000; margin: 4px 0; }' +
      '</style></head><body>' + linhas + '</body></html>';
  }

  // ---------- Caminho 0: app nativo (Electron) — SEM janela ----------
  // Quando o caixa roda dentro do app da loja, window.DupuroDesktop existe e
  // imprime o HTML direto na impressora, sem diálogo nenhum. É o preferido.
  function rodandoNoApp() {
    return typeof window !== 'undefined' && window.DupuroDesktop && typeof window.DupuroDesktop.imprimir === 'function';
  }
  async function imprimirNativo(venda) {
    try {
      var r = await window.DupuroDesktop.imprimir(htmlDaComanda(venda));
      if (r && r.ok) return { error: null };
      return { error: new Error((r && r.error) || 'Falha na impressão do app') };
    } catch (e) {
      return { error: e };
    }
  }

  // ---------- Caminho 2: impressão pelo Windows (fallback) ----------
  // Mesma comanda, em HTML de 80mm, pelo diálogo de impressão do navegador.
  function imprimirNavegador(venda) {
    var html = htmlDaComanda(venda);

    var frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(function () { frame.remove(); }, 2000);
    return { error: null };
  }

  // Imprime pelo melhor caminho disponível: app nativo (sem janela) > serial >
  // diálogo do Windows.
  async function imprimir(venda) {
    if (rodandoNoApp()) {
      var rn = await imprimirNativo(venda);
      return { error: rn.error, via: 'app' };
    }
    if (conectado()) {
      var r = await imprimirSerial(venda);
      if (!r.error) return { error: null, via: 'serial' };
      return { error: r.error, via: 'serial' };
    }
    imprimirNavegador(venda);
    return { error: null, via: 'navegador' };
  }

  return {
    suportaSerial: suportaSerial,
    rodandoNoApp: rodandoNoApp,
    conectado: conectado,
    autoConectar: autoConectar,
    conectar: conectar,
    desconectar: desconectar,
    imprimir: imprimir,
    imprimirNavegador: imprimirNavegador,
    montarLinhas: montarLinhas,
    htmlDaComanda: htmlDaComanda
  };

})();
