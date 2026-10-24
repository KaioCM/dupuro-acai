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
    L.push({ t: '(65) 99288-8228', center: true });
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
    (venda.descontos || []).forEach(function (d) {
      if (!d || !(Number(d.valor) > 0)) return;
      quebrar(d.label || 'Promoção', LARGURA).forEach(function (linha, idx) {
        // valor do desconto na 1ª linha do rótulo (à direita); continuações à esquerda.
        if (idx === 0) L.push({ t: linhaDupla(linha, '- ' + brl(d.valor)) });
        else L.push({ t: linha });
      });
    });
    L.push({ t: linhaDupla('TOTAL', brl(venda.total)), bold: true, grande: false });
    var FP = { dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito', pix: 'Pix' };
    if (venda.pagamentos && venda.pagamentos.length > 1) {
      // Venda dividida: uma linha por forma, com o valor de cada uma.
      L.push({ t: 'Pagamento (dividido):' });
      venda.pagamentos.forEach(function (p) {
        L.push({ t: linhaDupla('  ' + (FP[p.forma] || p.forma), brl(p.valor)) });
      });
    } else if (venda.formaPagamento) {
      L.push({ t: 'Pagamento: ' + (FP[venda.formaPagamento] || venda.formaPagamento) });
    }
    if (venda.pagamento && venda.pagamento.nsu) L.push({ t: '  NSU: ' + venda.pagamento.nsu });
    if (Number(venda.troco) > 0) L.push({ t: linhaDupla('Troco', brl(venda.troco)) });
    // Entrega/delivery: destaca pra separar do balcão e mostra nome/endereço.
    if (venda.entrega) {
      L.push({ t: '' });
      L.push({ t: '** ENTREGA **', center: true, bold: true });
      var ei = venda.entregaInfo || {};
      if (ei.nome) L.push({ t: 'Cliente: ' + ei.nome });
      if (ei.endereco) L.push({ t: 'Endereço: ' + ei.endereco });
    }
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
  // Feita pra ler de longe na cozinha (queixa da atendente: letra pequena). Antes
  // reusava as linhas de 48 colunas do ESC/POS em Courier 12px: em 74mm só cabem
  // ~38, então o preço caía pra linha de baixo e os acompanhamentos quebravam
  // sem recuo. Agora o HTML monta direto dos itens: número e itens grandes em
  // negrito, cada acompanhamento numa linha, preço à direita sem quebrar.
  function htmlDaComanda(venda) {
    function e(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function dupla(esq, dir, cls) {
      return '<div class="dupla ' + (cls || '') + '"><span>' + esq + '</span><span class="dir">' + dir + '</span></div>';
    }
    var hora = new Date(venda.hora || Date.now())
      .toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var FP = { dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito', pix: 'Pix' };

    var itens = (venda.items || []).map(function (it) {
      var titulo, sub = [];
      if (it.modo === 'peso') {
        titulo = it.nome;
        sub.push(Number(it.pesoKg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' kg x ' + brl(it.precoKg) + '/kg');
      } else {
        titulo = it.quantidade + 'x ' + it.nome;
      }
      if (it.sabor) sub.push('Sabor: ' + it.sabor);
      return '<div class="item">' + dupla('<b>' + e(titulo) + '</b>', e(brl(it.valor)), 'item-l') +
        sub.map(function (s) { return '<div class="sub">' + e(s) + '</div>'; }).join('') +
        (it.acompanhamentos || []).map(function (a) { return '<div class="acomp">+ ' + e(a) + '</div>'; }).join('') +
        '</div>';
    }).join('');

    var descontos = (venda.descontos || []).filter(function (d) { return d && Number(d.valor) > 0; }).map(function (d) {
      return dupla(e(d.label || 'Promoção'), '- ' + e(brl(d.valor)), 'peq');
    }).join('');

    var pagamento = '';
    if (venda.pagamentos && venda.pagamentos.length > 1) {
      pagamento = '<div class="peq">Pagamento (dividido):</div>' + venda.pagamentos.map(function (p) {
        return dupla('&nbsp;&nbsp;' + e(FP[p.forma] || p.forma), e(brl(p.valor)), 'peq');
      }).join('');
    } else if (venda.formaPagamento) {
      pagamento = '<div class="peq">Pagamento: ' + e(FP[venda.formaPagamento] || venda.formaPagamento) + '</div>';
    }
    if (venda.pagamento && venda.pagamento.nsu) pagamento += '<div class="peq">NSU: ' + e(venda.pagamento.nsu) + '</div>';
    if (Number(venda.troco) > 0) pagamento += dupla('Troco', e(brl(venda.troco)), 'peq');

    var entrega = '';
    if (venda.entrega) {
      var ei = venda.entregaInfo || {};
      entrega = '<div class="entrega">** ENTREGA **</div>' +
        (ei.nome ? '<div class="sub">Cliente: ' + e(ei.nome) + '</div>' : '') +
        (ei.endereco ? '<div class="sub">Endereço: ' + e(ei.endereco) + '</div>' : '');
    }

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + e(venda.numero) + '</title><style>' +
      '@page { size: 80mm auto; margin: 0; }' +
      'body { margin: 0; padding: 3mm 3mm 5mm; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.3; color: #000; width: 74mm; }' +
      '.loja { text-align: center; font-size: 13px; }' +
      '.loja b { display: block; font-size: 17px; letter-spacing: 1px; }' +
      '.num { font-size: 24px; font-weight: 800; margin-top: 2px; }' +
      '.meta { font-size: 14px; }' +
      '.hr { border-top: 2px dashed #000; margin: 6px 0; }' +
      '.item { margin: 0 0 7px; }' +
      '.dupla { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }' +
      '.dupla .dir { flex: none; white-space: nowrap; }' +
      '.item-l { font-size: 19px; }' +
      '.item-l .dir { font-size: 15px; }' +
      '.sub { font-size: 16px; padding-left: 4mm; }' +
      '.acomp { font-size: 17px; font-weight: 700; padding-left: 4mm; }' +
      '.peq { font-size: 14px; }' +
      '.total { font-size: 20px; font-weight: 800; margin-top: 2px; }' +
      '.entrega { text-align: center; font-size: 19px; font-weight: 800; margin: 8px 0 2px; }' +
      '.rodape { text-align: center; font-size: 12px; margin-top: 8px; }' +
      '</style></head><body>' +
      '<div class="loja"><b>DUPURO AÇAÍ</b>(65) 99288-8228</div>' +
      '<div class="hr"></div>' +
      '<div class="num">' + e(venda.numero) + '</div>' +
      '<div class="meta">' + e(hora) + ' · ' + e(venda.cliente || 'Balcão') + '</div>' +
      '<div class="hr"></div>' +
      itens +
      '<div class="hr"></div>' +
      descontos +
      dupla('TOTAL', e(brl(venda.total)), 'total') +
      pagamento + entrega +
      '<div class="rodape">Obrigado pela preferência! · Não é documento fiscal</div>' +
      '</body></html>';
  }

  // ---------- Cupom fiscal (DANFE NFC-e) ----------
  // Diferente da comanda (cozinha): este é o cupom fiscal, com QR do SEFAZ e
  // chave de acesso, impresso só quando a NFC-e é autorizada. O QR é gerado da
  // string fiscal (qrcode_url) pela lib vendorizada (window.qrcode) e vira uma
  // <img> data-URL — nada externo, imprime offline.
  function qrDataImg(conteudo, cell, margem) {
    try {
      if (typeof window === 'undefined' || typeof window.qrcode !== 'function') return '';
      var qr = window.qrcode(0, 'M');
      qr.addData(String(conteudo));
      qr.make();
      return qr.createImgTag(cell || 4, margem || 2);
    } catch (e) { return ''; }
  }

  function grupos4(s) {
    return String(s || '').replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
  }

  function par(label, valor, cls) {
    return '<div class="' + (cls || '') + '" style="display:flex;justify-content:space-between;gap:6px;">' +
      '<span>' + label + '</span><span>' + valor + '</span></div>';
  }

  // d = { numero, serie, chave, protocolo, dataEmissao, ambiente, total,
  //   valorPago, troco, formaPagamento, qrcodeUrl, consultaUrl,
  //   items: [{ codigo, descricao, quantidade, unidade, valorUnit, valorTotal }] }
  function htmlDoCupomFiscal(d) {
    var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
    var dt = new Date(d.dataEmissao || Date.now())
      .toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var FP = { dinheiro: 'Dinheiro', debito: 'Cartão de Débito', credito: 'Cartão de Crédito', pix: 'Pix' };
    var homolog = d.ambiente === 'homologacao';

    var linhasItens = (d.items || []).map(function (it) {
      var q = Number(it.quantidade) || 1;
      return '<tr><td>' + esc(it.codigo || '') + '</td><td>' + esc(it.descricao || '') + '</td>' +
        '<td class="r">' + q.toLocaleString('pt-BR') + '</td><td>' + esc(it.unidade || 'UN') + '</td>' +
        '<td class="r">' + brl(it.valorUnit) + '</td><td class="r">' + brl(it.valorTotal) + '</td></tr>';
    }).join('');

    var qr = qrDataImg(d.qrcodeUrl, 4, 2);

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>NFC-e ' + esc(d.numero || '') + '</title><style>' +
      '@page { size: 80mm auto; margin: 0; }' +
      'body { margin:0; padding:4mm 3mm; font-family:"Courier New",monospace; font-size:11px; line-height:1.3; color:#000; width:74mm; }' +
      '.c{text-align:center;} .r{text-align:right;} .b{font-weight:700;}' +
      '.hr{border-top:1px dashed #000;margin:4px 0;}' +
      'table{width:100%;border-collapse:collapse;font-size:10.5px;} th,td{text-align:left;padding:1px 2px;vertical-align:top;} thead th{border-bottom:1px solid #000;}' +
      '.small{font-size:9.5px;} .tot{font-size:12.5px;}' +
      '.qr{text-align:center;margin:6px 0;} .qr img{width:42mm;height:42mm;image-rendering:pixelated;}' +
      '.sv{text-align:center;font-weight:700;border:1px solid #000;padding:3px;margin:4px 0;}' +
      '</style></head><body>' +
      (homolog ? '<div class="sv">HOMOLOGACAO - SEM VALOR FISCAL</div>' : '') +
      '<div class="c b" style="font-size:15px;">NFC-e</div>' +
      '<div class="c b">DUPURO INDUSTRIA E COMERCIO DE ACAI LTDA</div>' +
      '<div class="c small">CNPJ 39.417.218/0001-81 &nbsp; IE 138379688</div>' +
      '<div class="c small">Av. Prof. Edna Maria Albuquerque Affi, 16 - Jardim Imperial - Cuiabá/MT</div>' +
      '<div class="hr"></div>' +
      '<div class="c small">DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>' +
      '<div class="c small">Não permite aproveitamento de crédito de ICMS</div>' +
      '<div class="hr"></div>' +
      '<table><thead><tr><th>Cód</th><th>Descrição</th><th class="r">Qtd</th><th>Un</th><th class="r">Vl Un</th><th class="r">Vl Tot</th></tr></thead><tbody>' +
      linhasItens + '</tbody></table>' +
      '<div class="hr"></div>' +
      par('Qtd. total de itens', String((d.items || []).length)) +
      par('Valor total', brl(d.total), 'b tot') +
      par('Forma de pagamento', FP[d.formaPagamento] || d.formaPagamento || '') +
      par('Valor pago', brl(d.valorPago != null ? d.valorPago : d.total)) +
      (d.troco ? par('Troco', brl(d.troco)) : '') +
      '<div class="hr"></div>' +
      '<div class="c small">Número: ' + esc(d.numero) + ' - Série: ' + esc(d.serie) + ' - ' + dt + '</div>' +
      '<div class="c small b" style="margin-top:3px;">Consulte pela chave de acesso em</div>' +
      '<div class="c small">' + esc(d.consultaUrl || 'www.sefaz.mt.gov.br/nfce/consultanfce') + '</div>' +
      '<div class="c small b" style="word-break:break-all;">' + grupos4(d.chave) + '</div>' +
      '<div class="hr"></div>' +
      (d.docConsumidor
        ? '<div class="c small b">CONSUMIDOR ' + (d.docConsumidor.tipo === 'cnpj'
            ? 'CNPJ ' + esc(String(d.docConsumidor.numero).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'))
            : 'CPF ' + esc(String(d.docConsumidor.numero).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'))) + '</div>'
        : '<div class="c small b">CONSUMIDOR NÃO IDENTIFICADO</div>') +
      '<div class="c small">Consulta via Leitor de QR Code</div>' +
      '<div class="qr">' + (qr || '<div class="small">(QR indisponível — consulte pela chave)</div>') + '</div>' +
      (d.protocolo ? '<div class="c small">Protocolo de autorização: ' + esc(d.protocolo) + '</div>' : '') +
      '<div class="c small">&nbsp;</div>' +
      '</body></html>';
  }

  // Imprime um HTML qualquer (usado pelo cupom fiscal) pelo caminho disponível.
  async function imprimirHtmlNativo(html) {
    try {
      var r = await window.DupuroDesktop.imprimir(html);
      if (r && r.ok) return { error: null };
      return { error: new Error((r && r.error) || 'Falha na impressão do app') };
    } catch (e) { return { error: e }; }
  }
  function imprimirHtmlNavegador(html) {
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(function () { frame.remove(); }, 3000);
    return { error: null };
  }
  async function imprimirCupomFiscal(d) {
    var html = htmlDoCupomFiscal(d);
    if (rodandoNoApp()) return imprimirHtmlNativo(html);
    return imprimirHtmlNavegador(html);
  }

  // Folhinha de FECHAMENTO DE CAIXA (resumo do dia), 80mm. d = { atendente,
  // abertoEm, fechadoEm, qtd, total, porForma:{forma:valor}, fundoTroco,
  // esperado, contado, diferenca }.
  function htmlDoResumoCaixa(d) {
    var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
    var fmtDt = function (x) { return x ? new Date(x).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
    var FP = { dinheiro: 'Dinheiro', debito: 'Cartão de Débito', credito: 'Cartão de Crédito', pix: 'Pix', sem: 'Sem forma' };
    var pf = d.porForma || {};
    var ordem = ['dinheiro', 'debito', 'credito', 'pix', 'sem'];
    var chaves = ordem.filter(function (k) { return pf[k] != null; })
      .concat(Object.keys(pf).filter(function (k) { return ordem.indexOf(k) < 0; }));
    var linhasPf = chaves.length
      ? chaves.map(function (k) { return par(FP[k] || k, brl(Number(pf[k]) || 0)); }).join('')
      : '<div class="c small">(sem vendas no dia)</div>';
    var dif = Number(d.diferenca) || 0;
    var difTxt = Math.abs(dif) < 0.005 ? 'Confere' : (dif > 0 ? 'Sobra ' + brl(dif) : 'Falta ' + brl(-dif));
    // Cada retirada/reforço numa linha pequena (o troco devolvido já sai da conta).
    var linhasMov = (d.movimentos || []).map(function (m) {
      var liq = Number(m.valor) - Number(m.devolvido || 0);
      return '<div class="small">' + (m.tipo === 'reforco' ? '+ ' : '- ') + esc(m.observacao) + ': ' +
        (m.tipo === 'reforco' ? brl(m.valor) : brl(liq) + (Number(m.devolvido) > 0 ? ' (saiu ' + brl(m.valor) + ', voltou ' + brl(m.devolvido) + ')' : '')) + '</div>';
    }).join('');
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fechamento de caixa</title><style>' +
      '@page { size: 80mm auto; margin: 0; }' +
      'body { margin:0; padding:4mm 3mm; font-family:"Courier New",monospace; font-size:12px; line-height:1.35; color:#000; width:74mm; }' +
      '.c{text-align:center;} .b{font-weight:700;}' +
      '.hr{border-top:1px dashed #000;margin:5px 0;}' +
      '.small{font-size:10px;} .tot{font-size:14px;} .big{font-size:16px;letter-spacing:1px;}' +
      '</style></head><body>' +
      '<div class="c b big">DUPURO AÇAÍ</div>' +
      '<div class="c small">Puro como tem que ser</div>' +
      '<div class="hr"></div>' +
      '<div class="c b" style="font-size:14px;">FECHAMENTO DE CAIXA</div>' +
      '<div class="c small">Resumo do dia</div>' +
      '<div class="hr"></div>' +
      par('Atendente', esc(d.atendente || '—')) +
      par('Aberto em', fmtDt(d.abertoEm)) +
      par('Fechado em', fmtDt(d.fechadoEm)) +
      '<div class="hr"></div>' +
      par('Vendas', String(d.qtd || 0)) +
      par('Total do dia', brl(d.total), 'b tot') +
      '<div class="hr"></div>' +
      '<div class="c small b">Por forma de pagamento</div>' +
      linhasPf +
      '<div class="hr"></div>' +
      par('Fundo de troco', brl(d.fundoTroco)) +
      (Number(d.reforcos) > 0 ? par('Dinheiro colocado', '+' + brl(d.reforcos)) : '') +
      (Number(d.retiradas) > 0 ? par('Retiradas', '-' + brl(d.retiradas)) : '') +
      linhasMov +
      par('Esperado em dinheiro', brl(d.esperado), 'b') +
      par('Contado em dinheiro', brl(d.contado), 'b') +
      par('Diferença', difTxt, 'b') +
      '<div class="hr"></div>' +
      '<div class="c small">Conferência interna - não é documento fiscal</div>' +
      '<div class="c small">&nbsp;</div>' +
      '</body></html>';
  }
  // Comprovante de retirada/reforço de dinheiro (vai grampeado com a nota do mercado).
  var CAT_DINHEIRO = { compra_loja: 'Compra pra loja', fornecedor: 'Fornecedor ou entregador', dono: 'Retirada do dono', troco: 'Troco', outro: 'Outro' };
  function htmlDoComprovanteDinheiro(d) {
    var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
    var reforco = d.tipo === 'reforco';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comprovante</title><style>' +
      '@page { size: 80mm auto; margin: 0; }' +
      'body { margin:0; padding:4mm 3mm; font-family:"Courier New",monospace; font-size:12px; line-height:1.35; color:#000; width:74mm; }' +
      '.c{text-align:center;} .b{font-weight:700;} .hr{border-top:1px dashed #000;margin:5px 0;} .small{font-size:10px;} .big{font-size:16px;}' +
      '</style></head><body>' +
      '<div class="c b big">DUPURO AÇAÍ</div>' +
      '<div class="hr"></div>' +
      '<div class="c b" style="font-size:14px;">' + (reforco ? 'DINHEIRO COLOCADO NO CAIXA' : 'RETIRADA DE DINHEIRO') + '</div>' +
      '<div class="hr"></div>' +
      par('Valor', brl(d.valor), 'b big') +
      (Number(d.devolvido) > 0 ? par('Troco devolvido', brl(d.devolvido)) + par('Gasto', brl(Number(d.valor) - Number(d.devolvido)), 'b') : '') +
      (reforco ? '' : par('Pra quê', esc(CAT_DINHEIRO[d.categoria] || d.categoria))) +
      '<div>' + esc(d.observacao) + '</div>' +
      '<div class="hr"></div>' +
      par('Atendente', esc(d.atendente || '—')) +
      par('Data', new Date(d.criado_em || Date.now()).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })) +
      '<div class="hr"></div>' +
      (reforco ? '' : '<div class="small">Grampeie a nota da compra aqui.</div><div>&nbsp;</div><div>Assinatura: ____________________</div>') +
      '<div class="c small">Controle interno - não é documento fiscal</div>' +
      '<div class="c small">&nbsp;</div>' +
      '</body></html>';
  }
  async function imprimirComprovanteDinheiro(d) {
    var html = htmlDoComprovanteDinheiro(d);
    if (rodandoNoApp()) return imprimirHtmlNativo(html);
    return imprimirHtmlNavegador(html);
  }

  async function imprimirResumoCaixa(d) {
    var html = htmlDoResumoCaixa(d);
    if (rodandoNoApp()) return imprimirHtmlNativo(html);
    return imprimirHtmlNavegador(html);
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
    imprimirCupomFiscal: imprimirCupomFiscal,
    imprimirResumoCaixa: imprimirResumoCaixa,
    imprimirComprovanteDinheiro: imprimirComprovanteDinheiro,
    montarLinhas: montarLinhas,
    htmlDaComanda: htmlDaComanda,
    htmlDoCupomFiscal: htmlDoCupomFiscal,
    htmlDoResumoCaixa: htmlDoResumoCaixa
  };

})();
