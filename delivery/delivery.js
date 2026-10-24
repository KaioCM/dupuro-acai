// ==========================================================================
// Dupuro Delivery — utilitários compartilhados (anúncio, pedido, acompanhar)
// ==========================================================================
// Fala com o Supabase direto por fetch (sem supabase-js, mais leve no celular).
// Cliente é anônimo: só lê o catálogo/config (RPC pública) e chama as Edge
// Functions do delivery; nunca escreve no banco direto.
// ==========================================================================
var DupuroDelivery = (function () {
  var URL_BASE = window.DUPURO_SUPABASE_URL;
  var KEY = window.DUPURO_SUPABASE_ANON_KEY;
  var HEAD = { apikey: KEY, 'Content-Type': 'application/json' };

  function brl(v) { return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  async function rpc(nome, args) {
    var r = await fetch(URL_BASE + '/rest/v1/rpc/' + nome, { method: 'POST', headers: HEAD, body: JSON.stringify(args || {}) });
    if (!r.ok) throw new Error('Falha ao carregar (' + r.status + ')');
    return r.json();
  }
  async function getConfig() {
    var r = await fetch(URL_BASE + '/rest/v1/delivery_config?id=eq.1&select=config', { headers: HEAD });
    if (!r.ok) throw new Error('Falha ao carregar a configuração');
    var rows = await r.json();
    return rows.length ? rows[0].config : null;
  }
  // Caixas (multissabor) primeiro, por preço; complementos (granola) por último.
  function getCatalogo() {
    return rpc('delivery_catalogo').then(function (l) {
      return (l || []).slice().sort(function (a, b) { return (b.multissabor - a.multissabor) || (a.preco - b.preco); });
    });
  }
  function getRastreio(token) { return rpc('delivery_rastreio', { p_token: token }); }

  // Edge Function do delivery. Devolve o JSON; erro vira exceção com a mensagem.
  async function fn(nome, body) {
    var r = await fetch(URL_BASE + '/functions/v1/' + nome, { method: 'POST', headers: HEAD, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || j.error) throw new Error(j.error || ('Falha (' + r.status + ')'));
    return j;
  }

  // ---- Janelas de entrega ----
  // Cuiabá é UTC-4 fixo (MT não tem horário de verão): "agora" local = UTC-4h,
  // lido com getUTC*. Mesma regra usada na Edge Function (servidor é quem vale).
  function agoraCuiaba() { return new Date(Date.now() - 4 * 3600e3); }
  function hhmmMin(s) { var p = String(s || '0:0').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function isoData(d) { return d.toISOString().slice(0, 10); }
  var NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  function hLabel(s) { var p = String(s).split(':'); return (+p[0]) + 'h' + (p[1] && p[1] !== '00' ? p[1] : ''); }

  // Próximos períodos disponíveis (respeita dias de entrega e horário de corte).
  function janelasDisponiveis(cfg, quantas) {
    var out = [], agora = agoraCuiaba();
    var minAgora = agora.getUTCHours() * 60 + agora.getUTCMinutes();
    var dias = (cfg && cfg.dias) || [1, 2, 3, 4, 5, 6];
    var jan = (cfg && cfg.janelas) || {};
    for (var d = 0; d < 10 && out.length < (quantas || 6); d++) {
      var dia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + d));
      if (dias.indexOf(dia.getUTCDay()) < 0) continue;
      ['manha', 'tarde'].forEach(function (per) {
        var j = jan[per]; if (!j || out.length >= (quantas || 6)) return;
        if (d === 0 && minAgora >= hhmmMin(j.corte)) return; // passou do corte de hoje
        var dataTxt = String(dia.getUTCDate()).padStart(2, '0') + '/' + String(dia.getUTCMonth() + 1).padStart(2, '0');
        // "Amanhã" com a data (antes não dizia o dia)
        var quando = d === 0 ? 'Hoje, ' + NOMES_DIA[dia.getUTCDay()].slice(0, 3).toLowerCase() + ' ' + dataTxt : (d === 1 ? 'Amanhã, ' + NOMES_DIA[dia.getUTCDay()].slice(0, 3).toLowerCase() + ' ' + dataTxt : NOMES_DIA[dia.getUTCDay()] + ' ' + dataTxt);
        out.push({
          data: isoData(dia), periodo: per,
          titulo: quando + ' · ' + (per === 'manha' ? 'Manhã' : 'Tarde'),
          faixa: hLabel(j.inicio) + ' às ' + hLabel(j.fim)
        });
      });
    }
    return out;
  }

  // Cor de cada sabor (bolinha dos chips).
  var CORES = { 'açaí': '#5B1450', 'morango': '#E8607A', 'ninho': '#F3E9CF', 'cupuaçu': '#E6C36A', 'maracujá': '#F2C230',
    'doce de leite': '#C98A4B', 'banana': '#F1D86A', 'paçoca': '#B88457', 'pistache': '#9DBF6B', 'chocolate': '#5A3221', 'coco': '#F6F1E6' };
  function corSabor(nome) {
    var n = String(nome || '').toLowerCase().replace(/^creme de\s+/, '');
    return CORES[n] || '#A94E8C';
  }
  function nomeSabor(nome) { return String(nome || '').replace(/^Creme de\s+/i, ''); }
  // Pra quem é cada tamanho (texto de venda), pelo volume.
  function idealPra(p) {
    var l = Number(p.litros) || 0;
    if (!p.multissabor) return 'Crocante pra completar o açaí';
    if (l <= 1) return 'Pra matar a vontade ou provar um creme novo';
    if (l <= 2) return 'Sobremesa do casal a semana toda';
    if (l <= 5) return 'A família toda no fim de semana';
    return 'Festa, aniversário ou pra não faltar nunca';
  }
  // Foto do produto: a cadastrada no admin ou, sem ela, uma foto real de reserva.
  function fotoProduto(p) {
    if (p.imagem_url) return p.imagem_url;
    if (p.multissabor) return '../assets/img/delivery/caixa-na-mao.jpg';
    return null;
  }
  // Foto do Storage no tamanho em que aparece (as originais têm 1,5-2 MB).
  function miniatura(url, px) {
    if (!url || url.indexOf('/storage/v1/object/public/') === -1) return url;
    var lado = Math.round((px || 160) * 2);
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
      (url.indexOf('?') === -1 ? '?' : '&') + 'width=' + lado + '&height=' + lado + '&resize=contain&quality=75';
  }
  function litrosTxt(p) { var l = Number(p.litros) || 0; return l ? (String(l).replace('.', ',') + ' L') : ''; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- "Seu pedido": o aparelho lembra os pedidos feitos aqui ----
  // Só o token (o link secreto do acompanhamento) fica no navegador. A faixa
  // aparece enquanto o pedido está pago ou a caminho; entregue/cancelado some.
  var LS_MEUS = 'dupuro-delivery-meus';
  function lerMeus() { try { return JSON.parse(localStorage.getItem(LS_MEUS) || '[]') || []; } catch (e) { return []; } }
  function gravarMeus(l) { try { localStorage.setItem(LS_MEUS, JSON.stringify(l.slice(0, 5))); } catch (e) {} }
  function lembrarPedido(token, codigo) {
    if (!token) return;
    gravarMeus([{ t: token, c: codigo || '' }].concat(lerMeus().filter(function (x) { return x.t !== token; })));
  }
  function esquecerPedido(token) { gravarMeus(lerMeus().filter(function (x) { return x.t !== token; })); }
  function quandoEntrega(p) {
    var d = new Date(p.data_entrega + 'T12:00:00Z');
    return NOMES_DIA[d.getUTCDay()].toLowerCase() + ' ' + String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') +
      (p.periodo === 'manha' ? ' de manhã' : ' à tarde');
  }
  // alvo = elemento antes do qual a faixa entra; base = caminho até /delivery/.
  async function faixaSeuPedido(alvo, base) {
    if (!alvo) return;
    var lista = lerMeus().slice(0, 3);
    for (var i = 0; i < lista.length; i++) {
      var p = null;
      try { p = await getRastreio(lista[i].t); } catch (e) { return; } // sem internet: tenta na próxima visita
      if (!p || ['entregue', 'cancelado', 'expirado'].indexOf(p.status) !== -1) { esquecerPedido(lista[i].t); continue; }
      if (p.status !== 'pago' && p.status !== 'em_rota') continue;
      var a = document.createElement('a');
      a.className = 'dl-faixa';
      a.href = (base || '') + 'acompanhar.html?t=' + encodeURIComponent(lista[i].t);
      a.innerHTML = '<span class="dl-faixa-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="5.5" cy="17" r="2.5"/><circle cx="18.5" cy="17" r="2.5"/><path d="M8 17h7.5l-2.5-7h-3M13 10l1.5-4H18M3.5 13.5H9l2 3.5"/></svg></span>' +
        '<span class="dl-faixa-txt"><strong>Seu pedido ' + esc(p.codigo) + '</strong><span>' +
        (p.status === 'em_rota' ? 'Saiu pra entrega · chega ainda ' + (p.periodo === 'manha' ? 'nesta manhã' : 'nesta tarde') : 'Pago · chega ' + esc(quandoEntrega(p))) +
        '</span></span><span class="dl-faixa-ac">Acompanhar</span>';
      alvo.parentNode.insertBefore(a, alvo);
      return;
    }
  }

  return {
    lembrarPedido: lembrarPedido, esquecerPedido: esquecerPedido, faixaSeuPedido: faixaSeuPedido, quandoEntrega: quandoEntrega,
    brl: brl, esc: esc, getConfig: getConfig, getCatalogo: getCatalogo, getRastreio: getRastreio,
    fn: fn, janelasDisponiveis: janelasDisponiveis,
    corSabor: corSabor, nomeSabor: nomeSabor, idealPra: idealPra, litrosTxt: litrosTxt, fotoProduto: fotoProduto, miniatura: miniatura
  };
})();
