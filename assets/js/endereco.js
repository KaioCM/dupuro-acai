// =========================================================================
// Endereço com mapa (igual ao do delivery) — painel do revendedor
// -------------------------------------------------------------------------
// DupuroEndereco.criar(raiz, prefixo) monta dentro de `raiz`:
//   "Marque no mapa" (Leaflet + OpenStreetMap, carregado só ao abrir; o ponto
//   vira rua/número/bairro pelo Nominatim) · CEP opcional (ViaCEP preenche e
//   trava o que trouxe) · cidade (Cuiabá/Várzea Grande) · rua · número ·
//   bairro · complemento.
// Devolve { valor, texto, validar, preencher, mudou }.
//   valor()  → { cep, rua, numero, bairro, cidade, complemento, lat, lng }
//              (vai em profiles.endereco_detalhe; lat/lng também no pedido —
//              migration_055, e a rota usa o ponto direto).
//   texto()  → "Rua X, 120 - Bairro, Cuiabá - MT, 78000-000 · complemento"
//              (profiles.endereco / entrega_info.endereco, o que o admin lê).
// O mapa é um só pra página (gaveta criada no primeiro uso).
// =========================================================================
var DupuroEndereco = (function () {
  var CIDADES = { 'cuiabá': 'Cuiabá', 'cuiaba': 'Cuiabá', 'várzea grande': 'Várzea Grande', 'varzea grande': 'Várzea Grande' };
  var FABRICA = { lat: -15.6149619, lng: -56.0244949 };
  var AREA = { minLat: -15.85, maxLat: -15.40, minLng: -56.32, maxLng: -55.85 }; // mesma caixa do banco
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(x) { return String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function naArea(p) { return p && p.lat >= AREA.minLat && p.lat <= AREA.maxLat && p.lng >= AREA.minLng && p.lng <= AREA.maxLng; }

  // ---- Mapa compartilhado ----
  var gaveta = null, mapa = null, aoUsar = null, focoAntes = null;
  function carregarLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise(function (ok, falha) {
      var css = document.createElement('link'); css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
      var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      s.onload = ok; s.onerror = falha; document.head.appendChild(s);
    });
  }
  function msgMapa(txt) { gaveta.querySelector('.end-mapa-msg').innerHTML = txt ? '<p class="end-msg erro">' + esc(txt) + '</p>' : ''; }
  function criarGaveta() {
    gaveta = document.createElement('div');
    gaveta.className = 'end-mapa hidden';
    gaveta.innerHTML = '<div class="end-mapa-fundo" data-fechar></div>' +
      '<div class="end-mapa-in" role="dialog" aria-modal="true" aria-labelledby="endMapaTit">' +
        '<div class="end-mapa-topo"><h2 id="endMapaTit">Onde fica o seu ponto?</h2><button type="button" class="end-mapa-x" data-fechar aria-label="Fechar">×</button></div>' +
        '<p class="end-mapa-dica">Arraste o mapa até o pino ficar bem em cima do lugar da entrega.</p>' +
        '<div class="end-mapa-box"><div class="end-mapa-el"></div><span class="end-mapa-pino" aria-hidden="true"><svg viewBox="0 0 24 30" width="38" height="48"><path d="M12 29s10-9.2 10-17A10 10 0 0 0 2 12c0 7.8 10 17 10 17z" fill="#601050" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="#F5B301"/></svg></span></div>' +
        '<button type="button" class="btn btn-dark-outline btn-block end-gps">Estou no local: usar minha localização</button>' +
        '<div class="end-mapa-msg" role="alert"></div>' +
        '<button type="button" class="btn btn-primary btn-block end-usar">Usar este local</button>' +
      '</div>';
    document.body.appendChild(gaveta);
    gaveta.addEventListener('click', function (e) { if (e.target.closest('[data-fechar]')) fecharMapa(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !gaveta.classList.contains('hidden')) fecharMapa(); });
    gaveta.querySelector('.end-gps').addEventListener('click', function () {
      var b = this;
      if (!navigator.geolocation || !mapa) { msgMapa('Seu navegador não liberou a localização.'); return; }
      b.disabled = true; b.textContent = 'Localizando…';
      navigator.geolocation.getCurrentPosition(function (p) {
        mapa.setView([p.coords.latitude, p.coords.longitude], 18);
        b.disabled = false; b.textContent = 'Estou no local: usar minha localização';
      }, function () {
        msgMapa('Não conseguimos sua localização. Arraste o mapa até o lugar.');
        b.disabled = false; b.textContent = 'Estou no local: usar minha localização';
      }, { enableHighAccuracy: true, timeout: 12000 });
    });
    gaveta.querySelector('.end-usar').addEventListener('click', async function () {
      if (!mapa || !aoUsar) return;
      var c = mapa.getCenter(), b = this;
      if (!naArea({ lat: c.lat, lng: c.lng })) { msgMapa('Esse ponto fica fora de Cuiabá e Várzea Grande. Pra outras cidades, escolha Retirada.'); return; }
      b.disabled = true; b.textContent = 'Buscando o endereço…';
      var a = null;
      try {
        var j = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=' + c.lat + '&lon=' + c.lng)
          .then(function (x) { return x.ok ? x.json() : null; });
        a = j && j.address;
      } catch (e) { a = null; }
      b.disabled = false; b.textContent = 'Usar este local';
      var cid = a && CIDADES[String(a.city || a.town || a.municipality || '').toLowerCase()];
      if (a && !cid) { msgMapa('Esse ponto fica fora de Cuiabá e Várzea Grande. Pra outras cidades, escolha Retirada.'); return; }
      aoUsar({ lat: c.lat, lng: c.lng }, a ? {
        cidade: cid, rua: a.road || a.pedestrian || a.residential || '', numero: a.house_number || '',
        bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || '', cep: String(a.postcode || '').replace(/\D/g, '')
      } : null);
      fecharMapa();
    });
  }
  async function abrirMapa(centro, botao, usar) {
    if (!gaveta) criarGaveta();
    aoUsar = usar; focoAntes = botao;
    msgMapa('');
    gaveta.classList.remove('hidden'); document.body.classList.add('end-travado');
    setTimeout(function () { gaveta.querySelector('.end-mapa-x').focus(); }, 30);
    try { await carregarLeaflet(); } catch (e) { msgMapa('Não conseguimos abrir o mapa agora.'); return; }
    var c = centro || FABRICA, zoom = centro ? 17 : 13;
    if (!mapa) {
      mapa = L.map(gaveta.querySelector('.end-mapa-el'), { zoomControl: true }).setView([c.lat, c.lng], zoom);
      mapa.attributionControl.setPrefix(false);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    } else mapa.setView([c.lat, c.lng], zoom);
    setTimeout(function () { mapa.invalidateSize(); }, 60);
  }
  function fecharMapa() {
    gaveta.classList.add('hidden'); document.body.classList.remove('end-travado');
    if (focoAntes) focoAntes.focus({ preventScroll: true });
  }

  // ---- Um formulário de endereço ----
  function criar(raiz, px) {
    raiz.classList.add('end-form');
    raiz.innerHTML =
      '<button type="button" class="end-mapa-btn" data-e="btnMapa"><span class="end-mapa-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg></span>' +
        '<span class="end-mapa-tx"><strong data-e="mapaTit">Marque o ponto no mapa</strong><small data-e="mapaSub">Mais fácil e a entrega chega certinho</small></span></button>' +
      '<div class="end-ou"><span>ou preencha</span></div>' +
      '<p class="end-msg info hidden" data-e="antigo"></p>' +
      '<div class="end-linha">' +
        '<div class="field"><label for="' + px + 'Cep">CEP <span class="opcional">(opcional)</span></label><input type="text" id="' + px + 'Cep" data-e="cep" inputmode="numeric" autocomplete="postal-code" placeholder="78000-000" maxlength="9"></div>' +
        '<div class="field"><label for="' + px + 'Cidade">Cidade</label><select id="' + px + 'Cidade" data-e="cidade" autocomplete="address-level2"><option value="Cuiabá">Cuiabá</option><option value="Várzea Grande">Várzea Grande</option></select></div>' +
      '</div>' +
      '<div class="field"><label for="' + px + 'Rua">Rua / avenida</label><input type="text" id="' + px + 'Rua" data-e="rua" maxlength="80" autocomplete="address-line1" placeholder="Ex.: Rua das Flores"></div>' +
      '<div class="end-linha num">' +
        '<div class="field"><label for="' + px + 'Numero">Número</label><input type="text" id="' + px + 'Numero" data-e="numero" maxlength="10" autocomplete="off" placeholder="120 ou s/n"></div>' +
        '<div class="field"><label for="' + px + 'Bairro">Bairro</label><input type="text" id="' + px + 'Bairro" data-e="bairro" maxlength="60" autocomplete="address-level3" placeholder="Ex.: Jardim Imperial"></div>' +
      '</div>' +
      '<div class="field"><label for="' + px + 'Comp">Complemento <span class="opcional">(opcional)</span></label><input type="text" id="' + px + 'Comp" data-e="comp" maxlength="60" placeholder="Sala, bloco, ponto de referência"></div>' +
      '<div data-e="msg" role="alert"></div>';
    function $e(n) { return raiz.querySelector('[data-e="' + n + '"]'); }
    var pino = null, cepBuscado = '', cepPonto = null, mexeu = false;

    function msg(txt, tipo, html) { $e('msg').innerHTML = txt ? '<p class="end-msg ' + (tipo || 'info') + '">' + (html ? txt : esc(txt)) + '</p>' : ''; }
    function travar(n, sim) { var el = $e(n); if (el.tagName === 'SELECT') el.disabled = sim; else el.readOnly = sim; el.classList.toggle('travado', sim); }
    function destravar() { travar('rua', false); travar('bairro', false); travar('cidade', false); }
    function marcarPino(p) {
      pino = p;
      $e('btnMapa').classList.toggle('ok', !!p);
      $e('mapaTit').textContent = p ? 'Ponto marcado no mapa' : 'Marque o ponto no mapa';
      $e('mapaSub').textContent = p ? 'Toque pra ajustar' : 'Mais fácil e a entrega chega certinho';
    }
    raiz.addEventListener('input', function (e) { mexeu = true; if (e.target.getAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid'); });

    $e('cep').addEventListener('input', function () {
      var el = this, d = el.value.replace(/\D/g, '').slice(0, 8);
      el.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
      if (d.length === 8 && d !== cepBuscado) buscarCep(d);
      if (d.length < 8 && cepBuscado) { cepBuscado = ''; cepPonto = null; msg(''); destravar(); }
    });
    async function buscarCep(d) {
      cepBuscado = d; cepPonto = null; destravar();
      msg('Buscando o CEP…');
      try {
        var r = await fetch('https://viacep.com.br/ws/' + d + '/json/').then(function (x) { return x.json(); });
        if (cepBuscado !== d) return;
        if (r.erro) { msg('CEP não encontrado. Confira os números ou preencha sem ele.', 'erro'); return; }
        var cid = CIDADES[String(r.localidade || '').toLowerCase()];
        if (!cid) { msg('Esse CEP é de ' + r.localidade + ' - ' + r.uf + '. A entrega é só em Cuiabá e Várzea Grande; pra outras cidades, escolha Retirada.', 'erro'); return; }
        if (pino) marcarPino(null); // o ponto era de outro endereço: o CEP novo manda
        $e('cidade').value = cid; travar('cidade', true);
        if (r.logradouro) { $e('rua').value = r.logradouro; travar('rua', true); }
        if (r.bairro) { $e('bairro').value = r.bairro; travar('bairro', true); }
        msg('');
        fetch('https://cep.awesomeapi.com.br/json/' + d).then(function (x) { return x.ok ? x.json() : null; }).then(function (g) {
          if (g && cepBuscado === d && g.lat && g.lng) cepPonto = { lat: Number(g.lat), lng: Number(g.lng) };
        }).catch(function () {});
        (r.logradouro ? $e('numero') : $e('rua')).focus();
      } catch (e) {
        if (cepBuscado === d) msg('Não conseguimos consultar o CEP agora. Preencha o endereço abaixo.');
      }
    }

    $e('btnMapa').addEventListener('click', function () {
      abrirMapa(pino || cepPonto, $e('btnMapa'), function (p, a) {
        mexeu = true;
        msg('');
        if (a) {
          var difere = ['rua', 'bairro'].some(function (n) { return a[n] && $e(n).value.trim() && norm($e(n).value) !== norm(a[n]); });
          var aplicar = function () {
            cepBuscado = ''; cepPonto = null; destravar();
            $e('cidade').value = a.cidade; $e('rua').value = a.rua; $e('numero').value = a.numero || $e('numero').value; $e('bairro').value = a.bairro;
            $e('cep').value = a.cep.length === 8 ? a.cep.slice(0, 5) + '-' + a.cep.slice(5) : '';
          };
          if (difere) {
            msg('O ponto marcado fica em <strong>' + esc([a.rua, a.bairro].filter(Boolean).join(', ')) + '</strong>. Mantivemos o endereço que você digitou; a entrega vai no ponto do mapa. ' +
              '<button type="button" class="btn-link-acao" data-e="usarMapa">Usar o endereço do mapa</button>', 'info', true);
            $e('usarMapa').addEventListener('click', function () { aplicar(); msg(''); });
          } else aplicar();
        }
        marcarPino(p);
        var vazio = ['rua', 'numero', 'bairro'].filter(function (n) { return !$e(n).value.trim(); });
        if (vazio.length && !$e('msg').innerHTML) {
          msg('Ponto marcado! Agora só confira e complete: ' + vazio.map(function (n) { return n === 'numero' ? 'número (ou s/n)' : n; }).join(', ') + '.');
          $e(vazio[0]).focus();
        }
      });
    });

    return {
      valor: function () {
        var cep = $e('cep').value.replace(/\D/g, '');
        return { cep: cep.length === 8 ? cep : '', rua: $e('rua').value.trim(), numero: $e('numero').value.trim(), bairro: $e('bairro').value.trim(),
          cidade: $e('cidade').value, complemento: $e('comp').value.trim(), lat: pino ? Math.round(pino.lat * 1e6) / 1e6 : null, lng: pino ? Math.round(pino.lng * 1e6) / 1e6 : null };
      },
      vazio: function () { var v = this.valor(); return !v.rua && !v.numero && !v.bairro && !v.cep && !v.complemento && !pino; },
      texto: function () {
        var v = this.valor();
        if (!v.rua) return '';
        return v.rua + ', ' + v.numero + ' - ' + v.bairro + ', ' + v.cidade + ' - MT' + (v.cep ? ', ' + v.cep.slice(0, 5) + '-' + v.cep.slice(5) : '') +
          (v.complemento ? ' · ' + v.complemento : '');
      },
      // Mensagem do que falta (e marca os campos) ou null.
      validar: function () {
        var falta = [];
        if ($e('rua').value.trim().length < 3) falta.push('rua');
        if (!$e('numero').value.trim()) falta.push('numero');
        if ($e('bairro').value.trim().length < 2) falta.push('bairro');
        falta.forEach(function (n) { $e(n).setAttribute('aria-invalid', 'true'); });
        if (falta.length) { $e(falta[0]).focus(); return 'Preencha ' + falta.map(function (n) { return n === 'numero' ? 'o número (ou "s/n")' : n === 'rua' ? 'a rua' : 'o bairro'; }).join(', ') + ' do endereço.'; }
        if (/[<>]/.test(this.texto())) return 'Tire os sinais < e > do endereço.';
        if (this.texto().length > 200) return 'O endereço ficou muito longo. Encurte o complemento.';
        return null;
      },
      // Preenche com o que está salvo. Endereço antigo (só texto) aparece como lembrete.
      preencher: function (d, textoAntigo) {
        mexeu = false; destravar(); msg('');
        d = d || {};
        $e('cep').value = d.cep && d.cep.length === 8 ? d.cep.slice(0, 5) + '-' + d.cep.slice(5) : '';
        cepBuscado = d.cep || '';
        $e('cidade').value = d.cidade === 'Várzea Grande' ? 'Várzea Grande' : 'Cuiabá';
        $e('rua').value = d.rua || ''; $e('numero').value = d.numero || ''; $e('bairro').value = d.bairro || ''; $e('comp').value = d.complemento || '';
        marcarPino(d.lat != null && d.lng != null && naArea(d) ? { lat: Number(d.lat), lng: Number(d.lng) } : null);
        var antigo = !d.rua && textoAntigo ? textoAntigo : '';
        $e('antigo').classList.toggle('hidden', !antigo);
        $e('antigo').textContent = antigo ? 'Endereço que estava salvo: ' + antigo + '. Marque no mapa ou preencha nos campos.' : '';
      },
      mexeu: function () { return mexeu; }
    };
  }

  return { criar: criar };
})();
