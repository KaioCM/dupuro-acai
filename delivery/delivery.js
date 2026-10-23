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
        var quando = d === 0 ? 'Hoje' : (d === 1 ? 'Amanhã, ' + NOMES_DIA[dia.getUTCDay()].slice(0, 3).toLowerCase() + ' ' + dataTxt : NOMES_DIA[dia.getUTCDay()] + ' ' + dataTxt);
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

  return {
    brl: brl, esc: esc, getConfig: getConfig, getCatalogo: getCatalogo, getRastreio: getRastreio,
    fn: fn, janelasDisponiveis: janelasDisponiveis,
    corSabor: corSabor, nomeSabor: nomeSabor, idealPra: idealPra, litrosTxt: litrosTxt, fotoProduto: fotoProduto, miniatura: miniatura
  };
})();
