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
  var DB_VERSAO = 2;
  var dbPromise = null;

  function abrir() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NOME, DB_VERSAO);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'client_uuid' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'chave' });
        // v2: pedidos em aberto (slots), fonte de verdade local da UI.
        if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'lid' });
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

  // ---- Pedidos em aberto (slots) — offline-first ----
  // O store local é a FONTE DE VERDADE da tela (online e offline). Cada slot:
  // { lid, server_id, label, atendente_id, sale_target, revendedor_id, carrinho,
  //   entrega, entrega_info, taxa, criado_em, atualizado_em, pending }.
  // pending: null | 'create' | 'update' | 'delete'. Ao reconectar, o motor
  // empurra as pendências pro servidor. (Cenário real = 1 PC de caixa; offline
  // em vários PCs pode divergir até sincronizar — aceitável.)
  function slotSalvarLocal(rec) {
    return tx('slots', 'readwrite', function (s) { s.put(rec); }).then(function () { return rec; });
  }
  function slotLerTodos() {
    return tx('slots', 'readonly', function (s) { return s.getAll(); }).then(function (r) {
      var arr = (r && r.result) || r || [];
      return arr.sort(function (a, b) { return String(a.criado_em).localeCompare(String(b.criado_em)); });
    });
  }
  function slotVisiveis() {
    return slotLerTodos().then(function (arr) { return arr.filter(function (x) { return x.pending !== 'delete'; }); });
  }
  function slotPorId(id) {
    return slotLerTodos().then(function (arr) {
      return arr.filter(function (x) {
        return String(x.lid) === String(id) || (x.server_id != null && String(x.server_id) === String(id));
      })[0] || null;
    });
  }
  function slotRemoverLocal(lid) {
    return tx('slots', 'readwrite', function (s) { s.delete(lid); });
  }
  // Espelha as linhas do servidor no store local, PRESERVANDO pendências que
  // ainda não subiram (create local sem server_id, ou update/delete pendente).
  function slotMergeServidor(rows) {
    return slotLerTodos().then(function (locais) {
      var pendentesPorServer = {};
      var aRemover = [];
      locais.forEach(function (x) {
        if (x.pending) { if (x.server_id != null) pendentesPorServer[String(x.server_id)] = true; }
        else aRemover.push(x.lid); // não-pending: será substituído pela versão do servidor
      });
      return tx('slots', 'readwrite', function (s) {
        aRemover.forEach(function (lid) { s.delete(lid); });
        (rows || []).forEach(function (row) {
          if (pendentesPorServer[String(row.id)]) return; // mantém a versão local pendente
          s.put({
            lid: 'srv-' + row.id, server_id: row.id,
            label: row.label, atendente_id: row.atendente_id || null,
            sale_target: row.sale_target || 'balcao', revendedor_id: row.revendedor_id || null,
            carrinho: row.carrinho || [], entrega: !!row.entrega,
            entrega_info: row.entrega_info || null, taxa: Number(row.taxa) || 0,
            criado_em: row.criado_em, atualizado_em: row.atualizado_em, pending: null
          });
        });
      });
    });
  }

  var sincSlots = false;
  function sincronizarSlots(client) {
    if (sincSlots) return Promise.resolve({ ok: false, jaRodando: true });
    sincSlots = true;
    function campos(rec) {
      return {
        label: rec.label, atendente_id: rec.atendente_id || null,
        sale_target: rec.sale_target || 'balcao', revendedor_id: rec.revendedor_id || null,
        carrinho: rec.carrinho || [], entrega: !!rec.entrega,
        entrega_info: rec.entrega_info || null, taxa: rec.taxa || 0
      };
    }
    return slotLerTodos().then(function (arr) {
      var pend = arr.filter(function (x) { return x.pending; });
      var seq = Promise.resolve();
      pend.forEach(function (rec) {
        seq = seq.then(function () {
          if (rec.pending === 'delete') {
            if (rec.server_id == null) return slotRemoverLocal(rec.lid);
            return client.from('caixa_pedidos_abertos').delete().eq('id', rec.server_id).then(function (r) {
              if (r.error) { if (ehErroDeRede(r.error)) throw { rede: true }; return; }
              return slotRemoverLocal(rec.lid);
            });
          }
          if (rec.server_id == null) { // create
            return client.from('caixa_pedidos_abertos').insert(campos(rec)).select('id').single().then(function (r) {
              if (r.error) { if (ehErroDeRede(r.error)) throw { rede: true }; return; }
              rec.server_id = r.data.id; rec.pending = null; return slotSalvarLocal(rec);
            });
          }
          // update
          return client.from('caixa_pedidos_abertos').update(Object.assign({}, campos(rec), { atualizado_em: new Date().toISOString() })).eq('id', rec.server_id).then(function (r) {
            if (r.error) { if (ehErroDeRede(r.error)) throw { rede: true }; return; }
            rec.pending = null; return slotSalvarLocal(rec);
          });
        });
      });
      return seq;
    }).then(function () { sincSlots = false; return { ok: true }; })
      .catch(function (e) { sincSlots = false; return { ok: false, rede: !!(e && e.rede) }; });
  }
  function slotsPendentes() {
    return slotLerTodos().then(function (arr) { return arr.filter(function (x) { return x.pending; }).length; });
  }

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
    novoUuid: uuid,
    slotSalvarLocal: slotSalvarLocal,
    slotLerTodos: slotLerTodos,
    slotVisiveis: slotVisiveis,
    slotPorId: slotPorId,
    slotRemoverLocal: slotRemoverLocal,
    slotMergeServidor: slotMergeServidor,
    sincronizarSlots: sincronizarSlots,
    slotsPendentes: slotsPendentes
  };
})();
