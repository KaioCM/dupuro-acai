// ==========================================================================
// Dupuro Açaí — Service Worker (offline do caixa)
// ==========================================================================
// Guarda o "shell" do caixa (HTML/CSS/JS + supabase-js do CDN) pra ele abrir
// mesmo sem internet. NÃO cacheia as chamadas ao Supabase (supabase.co) — essas
// são sempre rede; offline elas falham e o caixa cai na fila local.
//
// Suba o CACHE_VER quando mudar a lista de arquivos abaixo, pra forçar refresh.
// ==========================================================================
var CACHE_VER = 'dupuro-caixa-v18';

var SHELL = [
  '/area-cliente/caixa.html',
  '/assets/css/style.css',
  '/assets/js/supabase-config.js',
  '/assets/js/supabase-client.js',
  '/assets/js/app-ui.js',
  '/assets/js/caixa.js',
  '/assets/js/vendor/qrcode.js',
  '/assets/js/printer.js',
  '/assets/js/offline-queue.js',
  '/assets/img/brand/logo-branco.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_VER).then(function (cache) {
      // addAll falha tudo se um item falhar; então adiciona um a um, tolerante.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* ignora item que falhar */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (chaves) {
      return Promise.all(chaves.map(function (c) { if (c !== CACHE_VER) return caches.delete(c); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // POST/PATCH do Supabase: deixa passar direto

  var url = new URL(req.url);

  // Chamadas ao Supabase (dados/auth): sempre rede, nunca cache.
  if (url.hostname.indexOf('supabase.co') >= 0) return;

  // Navegação (abrir o caixa): rede primeiro, cai pro cache se offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('/area-cliente/caixa.html', { ignoreSearch: true });
      })
    );
    return;
  }

  var mesmaOrigem = url.origin === self.location.origin;

  if (mesmaOrigem) {
    // Assets do site: stale-while-revalidate (serve do cache, atualiza no fundo).
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (cached) {
        var rede = fetch(req).then(function (resp) {
          if (resp && resp.status === 200) {
            var copia = resp.clone();
            caches.open(CACHE_VER).then(function (c) { c.put(req, copia); });
          }
          return resp;
        }).catch(function () { return cached; });
        return cached || rede;
      })
    );
    return;
  }

  // Cross-origin (supabase-js do CDN, fontes): cache-first, guarda no 1º acesso.
  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        if (resp && (resp.status === 200 || resp.type === 'opaque')) {
          var copia = resp.clone();
          caches.open(CACHE_VER).then(function (c) { c.put(req, copia); });
        }
        return resp;
      });
    })
  );
});
