// ==========================================================================
// Dupuro Açaí — Caixa / PDV da loja (atendente)
// Camada de dados da atendente: registra vendas presenciais que baixam o
// estoque na hora, lista as vendas do dia e lê o estoque. Papel 'atendente'
// (ou admin) — protegido por RLS (ver supabase/migration_018_atendente_caixa.sql).
// ==========================================================================

var DupuroCaixa = (function () {

  var client = window.DupuroSupabaseClient;

  async function getSession() {
    var result = await client.auth.getSession();
    return result.data.session;
  }

  async function logout() {
    await client.auth.signOut();
  }

  // Garante sessão E papel de caixa (atendente ou admin). Redireciona caso falhe.
  async function requireCaixa(redirectTo) {
    var session = await getSession();
    if (!session) { window.location.href = redirectTo || 'login.html'; return null; }
    var prof = await client.from('profiles').select('nome, role, status').eq('id', session.user.id).single();
    var p = prof.data || {};
    var ok = p.role === 'admin' || (p.role === 'atendente' && p.status === 'aprovado');
    if (!ok) {
      await client.auth.signOut();
      window.location.href = redirectTo || 'login.html';
      return null;
    }
    return { session: session, nome: p.nome, role: p.role };
  }

  // Catálogo com estoque numérico por sabor (a atendente é equipe: pode ver o
  // número). Mesma resolução de estoque compartilhado (estoque_ref) do admin.
  async function getProducts() {
    // Offline: usa o último catálogo que baixou (pra conseguir montar a venda).
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) {
      var cacheOff = await DupuroOffline.lerCache('produtos');
      if (cacheOff) return cacheOff;
    }
    var result = await client
      .from('products')
      .select('id, nome, preco, imagem_url, tipo, multissabor, multissabor_incluir_acai, estoque, estoque_ref, estoque_ref_sabor, modo, acomp_gratis, acomp_extra_preco, product_flavor_stock(sabor, estoque)')
      .order('nome', { ascending: true });
    if (result.error) {
      if (window.DupuroOffline) { var c = await DupuroOffline.lerCache('produtos'); if (c) return c; }
      return [];
    }
    var raw = result.data || [];
    var byId = {};
    raw.forEach(function (p) { byId[p.id] = p; });

    var mapped = raw.map(function (p) {
      var modo = p.modo || 'embalado';
      // Copo e self-service não têm estoque por unidade: sempre vendáveis.
      if (modo !== 'embalado') {
        return {
          id: p.id, nome: p.nome, preco: Number(p.preco), imagemUrl: p.imagem_url,
          tipo: p.tipo || 'varejo', modo: modo,
          multissabor: false, multissaborIncluirAcai: true,
          sabores: [], estoqueTotal: null, compartilhado: false,
          acompGratis: Number(p.acomp_gratis) || 0,
          acompExtraPreco: Number(p.acomp_extra_preco) || 0
        };
      }
      var multissabor = !!p.multissabor;
      var incluiAcai = p.multissabor_incluir_acai !== false;
      var shared = !!p.estoque_ref;
      var source = (shared && byId[p.estoque_ref]) ? byId[p.estoque_ref] : p;
      var sourceFlavors = (source.product_flavor_stock || []).map(function (s) {
        return { sabor: s.sabor, estoque: Number(s.estoque) || 0 };
      });

      var sabores = sourceFlavors;
      var estoqueTotal;
      if (p.estoque_ref_sabor) {
        var row = sourceFlavors.filter(function (s) { return s.sabor === p.estoque_ref_sabor; })[0];
        estoqueTotal = row ? row.estoque : 0;
        sabores = [];
      } else if (multissabor) {
        if (!incluiAcai) sabores = sourceFlavors.filter(function (s) { return s.sabor !== 'Açaí'; });
        estoqueTotal = sabores.reduce(function (sum, s) { return sum + s.estoque; }, 0);
      } else {
        estoqueTotal = Number(source.estoque) || 0;
      }

      return {
        id: p.id, nome: p.nome, preco: Number(p.preco), imagemUrl: p.imagem_url,
        tipo: p.tipo || 'varejo', modo: modo, multissabor: multissabor,
        multissaborIncluirAcai: incluiAcai,
        sabores: sabores, estoqueTotal: estoqueTotal,
        compartilhado: shared,
        acompGratis: 0, acompExtraPreco: 0
      };
    });
    if (window.DupuroOffline) DupuroOffline.salvarCache('produtos', mapped);
    return mapped;
  }

  // Acompanhamentos ativos (lista da loja, usada na montagem do copo).
  async function getAcompanhamentos() {
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) {
      var co = await DupuroOffline.lerCache('acompanhamentos'); if (co) return co;
    }
    var result = await client
      .from('acompanhamentos')
      .select('id, nome, tipo, preco, ordem')
      .eq('ativo', true)
      .order('ordem', { ascending: true })
      .order('nome', { ascending: true });
    if (result.error) {
      if (window.DupuroOffline) { var c = await DupuroOffline.lerCache('acompanhamentos'); if (c) return c; }
      return [];
    }
    var mapped = (result.data || []).map(function (a) {
      return { id: a.id, nome: a.nome, tipo: a.tipo || 'gratuito', preco: Number(a.preco) || 0 };
    });
    if (window.DupuroOffline) DupuroOffline.salvarCache('acompanhamentos', mapped);
    return mapped;
  }

  // ---------- Promoções do dia (só balcão/loja) ----------
  // Até 3 unitárias + 3 combos por dia; a trava é no banco. Filtra por dia=hoje
  // (fuso de Cuiabá, o mesmo do PC da loja); no dia seguinte some sozinha.
  async function getPromocoesHoje() {
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) {
      return (await DupuroOffline.lerCache('promocoes')) || [];
    }
    var result = await client
      .from('caixa_promocoes')
      .select('id, produto_id, tipo, preco_promo, combo_qtd, dia')
      .eq('dia', hojeLocal())
      .order('id', { ascending: true });
    if (result.error) {
      if (window.DupuroOffline) { var c = await DupuroOffline.lerCache('promocoes'); if (c) return c; }
      return [];
    }
    var mapped = (result.data || []).map(function (p) {
      return {
        id: p.id, produtoId: p.produto_id, tipo: p.tipo,
        precoPromo: Number(p.preco_promo),
        comboQtd: p.combo_qtd != null ? Number(p.combo_qtd) : null, dia: p.dia
      };
    });
    if (window.DupuroOffline) DupuroOffline.salvarCache('promocoes', mapped);
    return mapped;
  }
  // Cria uma promoção (criar/editar promo exige internet). O `dia` vem do default
  // do banco (hoje/Cuiabá). A trava de 3-por-tipo e a coerência do combo são do banco.
  async function definirPromocao(promo) {
    var session = await getSession();
    var row = {
      produto_id: promo.produtoId,
      tipo: promo.tipo,
      preco_promo: promo.precoPromo,
      combo_qtd: promo.tipo === 'combo' ? promo.comboQtd : null,
      criado_por: session ? session.user.id : null
    };
    var result = await client.from('caixa_promocoes').insert(row).select('id').single();
    return { error: result.error, id: result.data ? result.data.id : null };
  }
  async function removerPromocao(id) {
    var result = await client.from('caixa_promocoes').delete().eq('id', id);
    return { error: result.error };
  }

  // Revendedores aprovados (para vincular uma venda de balcão a um revendedor).
  async function getResellers() {
    var result = await client
      .from('profiles')
      .select('id, nome, empresa')
      .eq('role', 'revendedor')
      .eq('status', 'aprovado')
      .order('empresa', { ascending: true });
    if (result.error) return [];
    return (result.data || []).map(function (r) {
      return { id: r.id, nome: r.empresa || r.nome || 'Revendedor' };
    });
  }

  // Número da venda de loja (VND-XXXX). Vem do banco (next_venda_numero), que
  // enxerga TODAS as linhas: a atendente só enxerga origem='loja' pelo RLS e
  // calcularia um número que colide com pedido de revendedor (ver migration_021).
  async function getNextOrderNumber() {
    var result = await client.rpc('next_venda_numero');
    if (result.error || !result.data) return null;
    return result.data;
  }

  function hojeISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // Registra uma venda de loja: N linhas com o mesmo numero, origem 'loja',
  // status 'entregue' (baixa estoque na hora). Insert de array = atômico: se um
  // item faltar estoque, a venda inteira é revertida. revendedorId = null → balcão.
  async function registerSale(header, items) {
    if (!items || !items.length) return { error: new Error('Nenhum item na venda') };
    var session = await getSession();

    // Linhas "base" (sem numero/status/origem/atendente): é o formato que a RPC
    // de sync espera. Só produto embalado baixa estoque; copo/self-service não
    // têm estoque por unidade (a policy orders_insert_atendente exige coerência).
    var base = items.map(function (it) {
      return {
        revendedor_id: header.revendedorId || null,
        data: hojeISO(),
        itens: it.itens,
        valor: it.valor,
        produto_id: it.produtoId || null,
        quantidade: it.quantidade || null,
        sabor: it.sabor || null,
        usa_estoque: (it.modo || 'embalado') === 'embalado',
        detalhes: it.detalhes || null,
        forma_pagamento: header.formaPagamento || null,
        pagamentos: header.pagamentos || null,
        entrega: !!header.entrega,
        entrega_info: header.entregaInfo || null,
        caixa_sessao_id: header.caixaSessaoId || null
      };
    });

    // Sem sessão ou offline → enfileira e devolve provisório (a comanda imprime
    // igual; o VND real é atribuído no sync quando a internet voltar).
    var offline = window.DupuroOffline && !DupuroOffline.estaOnline();
    if (offline || !session) {
      if (window.DupuroOffline) {
        var it2 = await DupuroOffline.enfileirar(base, header);
        return { error: null, numero: 'PENDENTE', offline: true, client_uuid: it2.client_uuid };
      }
      return { error: new Error('Sem sessão ativa') };
    }

    // Online: numera e insere direto (fluxo estrito de hoje — bloqueia se faltar
    // estoque). Se a rede cair no meio, cai pra fila.
    var numero = await getNextOrderNumber();
    if (!numero) {
      if (window.DupuroOffline) {
        var itq = await DupuroOffline.enfileirar(base, header);
        return { error: null, numero: 'PENDENTE', offline: true, client_uuid: itq.client_uuid };
      }
      return { error: new Error('Não foi possível gerar o número da venda') };
    }
    var rows = base.map(function (r) {
      var row = Object.assign({}, r);
      row.numero = numero; row.status = 'entregue'; row.origem = 'loja'; row.atendente_id = session.user.id;
      return row;
    });
    var result = await client.from('orders').insert(rows);
    if (result.error && window.DupuroOffline && DupuroOffline.ehErroDeRede(result.error)) {
      var itr = await DupuroOffline.enfileirar(base, header);
      return { error: null, numero: 'PENDENTE', offline: true, client_uuid: itr.client_uuid };
    }
    return { error: result.error, numero: numero };
  }

  // ---------- Sessão de caixa (abrir/fechar) ----------
  // A sessão aberta é cacheada localmente pra funcionar offline: abrir/fechar
  // precisam de internet, mas vender com o caixa já aberto funciona offline.
  async function getCaixaAberto() {
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) {
      return (await DupuroOffline.lerCache('caixa_sessao')) || null;
    }
    var r = await client.rpc('caixa_sessao_aberta');
    if (r.error) {
      return window.DupuroOffline ? ((await DupuroOffline.lerCache('caixa_sessao')) || null) : null;
    }
    var s = (r.data && r.data[0]) || null;
    if (window.DupuroOffline) await DupuroOffline.salvarCache('caixa_sessao', s);
    return s;
  }
  async function abrirCaixa(fundo) {
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) return { error: new Error('Abrir o caixa precisa de internet.') };
    var r = await client.rpc('abrir_caixa', { p_fundo: fundo });
    if (r.error) return { error: r.error };
    return { error: null, sessao: await getCaixaAberto() };
  }
  async function resumoCaixa(sessaoId) {
    var r = await client.rpc('resumo_caixa', { p_sessao_id: sessaoId });
    return { error: r.error, resumo: r.data || null };
  }
  async function fecharCaixa(sessaoId, contado) {
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) return { error: new Error('Fechar o caixa precisa de internet.') };
    var r = await client.rpc('fechar_caixa', { p_sessao_id: sessaoId, p_dinheiro_contado: contado });
    if (r.error) return { error: r.error };
    if (window.DupuroOffline) await DupuroOffline.salvarCache('caixa_sessao', null);
    return { error: null, resumo: r.data };
  }

  // Sincroniza as vendas que ficaram na fila offline. Chamado ao voltar a
  // conexão e ao abrir o caixa.
  async function sincronizarOffline() {
    if (!window.DupuroOffline) return { enviadas: 0, pendentes: 0 };
    return DupuroOffline.sincronizar(client);
  }
  function filaPendente() {
    return window.DupuroOffline ? DupuroOffline.tamanhoFila() : Promise.resolve(0);
  }

  // Vendas de loja num intervalo, agrupadas por numero. O RLS
  // (orders_select_atendente) libera a atendente a LER qualquer venda de loja,
  // de qualquer data — quem barra editar/cancelar fora do dia é a funcao
  // caixa_pode_mexer, no banco.
  async function getSalesBetween(startDate, endDate) {
    var query = client
      .from('orders')
      .select('numero, revendedor_id, produto_id, itens, valor, quantidade, sabor, detalhes, status, cancel_motivo, forma_pagamento, pagamentos, entrega, entrega_info, created_at, products(nome, modo)')
      .eq('origem', 'loja')
      .gte('created_at', startDate.toISOString());
    if (endDate) query = query.lt('created_at', endDate.toISOString());
    var result = await query.order('created_at', { ascending: false });
    if (result.error) return { sales: [], total: 0 };

    var resellers = await getResellers();
    var nomeById = {};
    resellers.forEach(function (r) { nomeById[r.id] = r.nome; });

    var byNum = {};
    var ordem = [];
    (result.data || []).forEach(function (o) {
      var g = byNum[o.numero];
      if (!g) {
        g = byNum[o.numero] = {
          numero: o.numero,
          hora: o.created_at,
          dia: diaLocal(o.created_at),
          revendedorId: o.revendedor_id || null,
          cliente: o.revendedor_id ? (nomeById[o.revendedor_id] || 'Revendedor') : 'Balcão',
          valor: 0, items: [],
          formaPagamento: o.forma_pagamento || null,
          pagamentos: o.pagamentos || null,
          entrega: !!o.entrega, entregaInfo: o.entrega_info || null, taxa: 0,
          cancelada: true, motivo: o.cancel_motivo || null
        };
        ordem.push(g);
      }
      if (o.forma_pagamento && !g.formaPagamento) g.formaPagamento = o.forma_pagamento;
      if (o.pagamentos && !g.pagamentos) g.pagamentos = o.pagamentos;
      if (o.entrega) g.entrega = true;
      if (o.entrega_info && !g.entregaInfo) g.entregaInfo = o.entrega_info;
      // A venda só conta como cancelada se TODAS as linhas estiverem canceladas.
      if (o.status !== 'cancelado') g.cancelada = false;
      if (o.cancel_motivo && !g.motivo) g.motivo = o.cancel_motivo;
      g.valor += Number(o.valor) || 0;
      // Linha de taxa de entrega: sem produto. Some no total da taxa e vai como
      // item (isTaxa) — a comanda imprime, a edição a exclui do carrinho.
      var ehTaxa = !o.produto_id;
      if (ehTaxa) g.taxa += Number(o.valor) || 0;
      // Item já no formato que a comanda e a edição esperam.
      var prod = o.products || {};
      var det = o.detalhes || {};
      g.items.push({
        produtoId: o.produto_id || null,
        quantidade: o.quantidade, sabor: o.sabor, itens: o.itens, valor: Number(o.valor) || 0,
        nome: prod.nome || o.itens,
        modo: ehTaxa ? 'servico' : (prod.modo || 'embalado'),
        isTaxa: ehTaxa,
        detalhes: o.detalhes || null,
        acompanhamentos: (det.acompanhamentos || []).map(function (a) { return a.nome; }),
        pesoKg: det.peso_kg || null,
        precoKg: det.preco_kg || null
      });
    });
    // `total` é o nome que a comanda (DupuroPrinter) espera na reimpressão.
    ordem.forEach(function (g) { g.total = g.valor; });
    // Vendas canceladas não entram no total do dia.
    var total = ordem.reduce(function (t, g) { return t + (g.cancelada ? 0 : g.valor); }, 0);
    return { sales: ordem, total: total };
  }

  // Data local no formato AAAA-MM-DD (o computador da loja roda no fuso de
  // Cuiabá, mesmo fuso que o banco usa pra decidir o que é "hoje").
  function diaLocal(iso) {
    var d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function hojeLocal() { return diaLocal(new Date().toISOString()); }

  // Vendas de hoje (fechamento de caixa).
  async function getTodaySales() {
    var start = new Date(); start.setHours(0, 0, 0, 0);
    return getSalesBetween(start, null);
  }

  // Vendas de um mês inteiro, já agrupadas por dia (mais recente primeiro).
  // `mesISO` = 'AAAA-MM'; sem argumento, o mês corrente.
  async function getMonthSales(mesISO) {
    var base = mesISO ? new Date(mesISO + '-01T00:00:00') : new Date();
    var inicio = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
    var fim = new Date(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0);
    var data = await getSalesBetween(inicio, fim);
    var hoje = hojeLocal();
    var porDia = {};
    var dias = [];
    data.sales.forEach(function (v) {
      var d = porDia[v.dia];
      if (!d) {
        d = porDia[v.dia] = { dia: v.dia, ehHoje: v.dia === hoje, sales: [], total: 0, count: 0, validas: 0 };
        dias.push(d);
      }
      d.sales.push(v);
      // `count` conta TODAS as vendas do dia (é o que aparece ao expandir, e uma
      // cancelada some da faixa se não contar); `validas`/`total` ignoram as
      // canceladas — é o dinheiro que de fato entrou.
      d.count++;
      if (!v.cancelada) { d.total += v.valor; d.validas++; }
    });
    dias.sort(function (a, b) { return a.dia < b.dia ? 1 : -1; });
    return { mes: inicio.getFullYear() + '-' + String(inicio.getMonth() + 1).padStart(2, '0'), dias: dias, total: data.total };
  }

  // Cancela a venda (mantém o registro como 'cancelado' + motivo). Estoque volta.
  async function cancelSale(numero, motivo) {
    var result = await client.rpc('caixa_cancelar_venda', { p_numero: numero, p_motivo: motivo });
    return { error: result.error };
  }

  // Substitui os itens da venda (edição), mantendo o mesmo número. rows no mesmo
  // formato de registerSale (produtoId/quantidade/sabor/itens/valor/modo/detalhes).
  async function updateSale(numero, header, items, motivo) {
    if (!items || !items.length) return { error: new Error('Nenhum item na venda') };
    var rows = items.map(function (it) {
      return {
        revendedor_id: header.revendedorId || null,
        data: null,
        itens: it.itens,
        valor: it.valor,
        produto_id: it.produtoId || null,
        quantidade: it.quantidade || null,
        sabor: it.sabor || null,
        usa_estoque: (it.modo || 'embalado') === 'embalado',
        detalhes: it.detalhes || null,
        forma_pagamento: header.formaPagamento || null,
        pagamentos: header.pagamentos || null,
        entrega: !!header.entrega,
        entrega_info: header.entregaInfo || null
      };
    });
    var result = await client.rpc('caixa_substituir_venda', { p_numero: numero, p_motivo: motivo, p_rows: rows });
    return { error: result.error };
  }

  // Emite a NFC-e (cupom fiscal) de uma venda já registrada, via a Edge Function
  // `emitir-nfce` (que fala com o gateway Focus NFe). O token do Focus é secret
  // do servidor — o navegador só manda o número da venda. Precisa de internet.
  // documento (opcional) = CPF/CNPJ do consumidor (só dígitos) pra sair na nota.
  async function emitirNfce(numero, documento) {
    var session = await getSession();
    if (!session) return { error: new Error('Sem sessão ativa') };
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) {
      return { error: new Error('Emitir NFC-e precisa de internet.') };
    }
    try {
      var response = await fetch(window.DUPURO_SUPABASE_URL + '/functions/v1/emitir-nfce', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ numero: numero, documento: documento || null })
      });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) return { error: new Error(body.error || 'Falha ao emitir NFC-e') };
      // body: { status, emissao } ou { ja_emitida, emissao }
      return { error: null, status: body.status || (body.emissao && body.emissao.status), emissao: body.emissao || null };
    } catch (e) {
      return { error: e };
    }
  }

  // Emissão de NFC-e autorizada de uma venda (ou null). Usado pra saber, ao
  // cancelar, se há um cupom fiscal que também precisa ser cancelado.
  async function getEmissaoAutorizada(numero) {
    var result = await client
      .from('nfce_emissoes')
      .select('id, numero_nfce, ref, criado_em')
      .eq('venda_numero', numero).eq('status', 'autorizado')
      .order('id', { ascending: false }).limit(1);
    if (result.error || !result.data || !result.data.length) return null;
    return result.data[0];
  }

  // Cancela a NFC-e da venda no SEFAZ (via Edge Function). justificativa 15–255.
  // Retorna { error, cancelado, mensagem, emissao }.
  async function cancelarNfce(numero, justificativa) {
    var session = await getSession();
    if (!session) return { error: new Error('Sem sessão ativa') };
    if (window.DupuroOffline && !DupuroOffline.estaOnline()) {
      return { error: new Error('Cancelar NFC-e precisa de internet.') };
    }
    try {
      var response = await fetch(window.DUPURO_SUPABASE_URL + '/functions/v1/cancelar-nfce', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ numero: numero, justificativa: justificativa })
      });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) return { error: new Error(body.error || 'Falha ao cancelar NFC-e') };
      return { error: null, cancelado: !!body.cancelado, mensagem: body.mensagem || null, emissao: body.emissao || null };
    } catch (e) {
      return { error: e };
    }
  }

  return {
    getSession: getSession,
    logout: logout,
    requireCaixa: requireCaixa,
    getProducts: getProducts,
    getAcompanhamentos: getAcompanhamentos,
    getPromocoesHoje: getPromocoesHoje,
    definirPromocao: definirPromocao,
    removerPromocao: removerPromocao,
    getResellers: getResellers,
    registerSale: registerSale,
    getTodaySales: getTodaySales,
    getMonthSales: getMonthSales,
    getCaixaAberto: getCaixaAberto,
    abrirCaixa: abrirCaixa,
    resumoCaixa: resumoCaixa,
    fecharCaixa: fecharCaixa,
    sincronizarOffline: sincronizarOffline,
    filaPendente: filaPendente,
    cancelSale: cancelSale,
    updateSale: updateSale,
    emitirNfce: emitirNfce,
    getEmissaoAutorizada: getEmissaoAutorizada,
    cancelarNfce: cancelarNfce
  };

})();
