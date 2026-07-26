// ==========================================================================
// Dupuro Açaí — Fila offline do caixa (IndexedDB) + motor de sincronização
// ==========================================================================
// Quando a internet cai, a venda é gravada aqui e impressa na hora. Quando a
// conexão volta (evento 'online' ou ao abrir o app), o motor esvazia a fila
// chamando a RPC `sincronizar_venda_offline` — que numera com o VND real e é
// idempotente pelo client_uuid (reenvio não duplica).
//
// Também guarda um cache do catálogo/acompanhamentos pra montar venda mesmo se o
// app abrir já offline.
// ==========================================================================
var DupuroOffline = (function () {
  var DB_NOME = 'dupuro-caixa';
  var DB_VERSAO = 1;
  var dbPromise = null;

  function abrir() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NOME, DB_VERSAO);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'client_uuid' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'chave' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, modo, fn) {
    return abrir().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, modo);
        var s = t.objectStore(store);
        var out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
    });
  }

  // ---- Cache de leitura (catálogo, acompanhamentos, etc.) ----
  function salvarCache(chave, dados) {
    return tx('cache', 'readwrite', function (s) { s.put({ chave: chave, dados: dados, quando: Date.now() }); });
  }
  function lerCache(chave) {
    return tx('cache', 'readonly', function (s) { return s.get(chave); }).then(function (r) { return r ? r.dados : null; });
  }

  // ---- Fila de vendas ----
  // Cada item: { client_uuid, rows, header, criado_em }. rows já no formato que a
  // RPC espera (itens, valor, produto_id, quantidade, sabor, usa_estoque, detalhes).
  function enfileirar(rows, header) {
    var item = { client_uuid: uuid(), rows: rows, header: header || {}, criado_em: Date.now() };
    return tx('fila', 'readwrite', function (s) { s.put(item); }).then(function () { return item; });
  }
  function listarFila() {
    return tx('fila', 'readonly', function (s) { return s.getAll(); }).then(function (r) {
      var arr = (r && r.result) || r || [];
      return arr.sort(function (a, b) { return a.criado_em - b.criado_em; });
    });
  }
  function removerDaFila(client_uuid) {
    return tx('fila', 'readwrite', function (s) { s.delete(client_uuid); });
  }
  function tamanhoFila() { return listarFila().then(function (a) { return a.length; }); }

  // ---- Motor de sincronização ----
  // client = instância Supabase. Envia cada venda pendente pela RPC. Sucesso →
  // remove da fila. Erro de rede → para (tenta de novo depois). Erro de dados →
  // deixa na fila e segue (não trava a fila inteira por causa de uma venda ruim).
  var sincronizando = false;
  function sincronizar(client) {
    if (sincronizando) return Promise.resolve({ enviadas: 0, pendentes: null, jaRodando: true });
    sincronizando = true;
    var enviadas = 0;
    return listarFila().then(function (fila) {
      var seq = Promise.resolve();
      fila.forEach(function (item) {
        seq = seq.then(function () {
          return client.rpc('sincronizar_venda_offline', { p_rows: item.rows, p_client_uuid: item.client_uuid })
            .then(function (res) {
              if (res.error) {
                // Rede/serviço fora: aborta o resto pra tentar tudo de novo depois.
                if (ehErroDeRede(res.error)) throw { rede: true };
                // Erro de dados (raro): registra e segue (não some com a venda).
                console.warn('[offline] venda não sincronizou (dados):', item.client_uuid, res.error.message);
                return;
              }
              enviadas++;
              return removerDaFila(item.client_uuid);
            });
        });
      });
      return seq;
    }).then(function () {
      return tamanhoFila();
    }).then(function (pendentes) {
      sincronizando = false;
      return { enviadas: enviadas, pendentes: pendentes };
    }).catch(function (e) {
      sincronizando = false;
      if (e && e.rede) return tamanhoFila().then(function (p) { return { enviadas: enviadas, pendentes: p, rede: true }; });
      return { enviadas: enviadas, pendentes: null, erro: e };
    });
  }

  function ehErroDeRede(err) {
    var m = (err && (err.message || '')).toLowerCase();
    return !navigator.onLine || m.indexOf('failed to fetch') >= 0 || m.indexOf('networkerror') >= 0 || m.indexOf('fetch') >= 0;
  }

  function estaOnline() { return navigator.onLine !== false; }

  return {
    enfileirar: enfileirar,
    listarFila: listarFila,
    removerDaFila: removerDaFila,
    tamanhoFila: tamanhoFila,
    sincronizar: sincronizar,
    salvarCache: salvarCache,
    lerCache: lerCache,
    estaOnline: estaOnline,
    ehErroDeRede: ehErroDeRede,
    novoUuid: uuid
  };
})();
