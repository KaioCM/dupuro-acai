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
    var result = await client
      .from('products')
      .select('id, nome, preco, imagem_url, tipo, multissabor, multissabor_incluir_acai, estoque, estoque_ref, estoque_ref_sabor, product_flavor_stock(sabor, estoque)')
      .order('nome', { ascending: true });
    if (result.error) return [];
    var raw = result.data || [];
    var byId = {};
    raw.forEach(function (p) { byId[p.id] = p; });

    return raw.map(function (p) {
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
        tipo: p.tipo || 'varejo', multissabor: multissabor,
        multissaborIncluirAcai: incluiAcai,
        sabores: sabores, estoqueTotal: estoqueTotal,
        compartilhado: shared
      };
    });
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

  async function getNextOrderNumber() {
    var result = await client.from('orders').select('numero');
    var max = 1000;
    (result.data || []).forEach(function (o) {
      var match = /^PED-(\d+)$/.exec(o.numero || '');
      if (match) { var n = parseInt(match[1], 10); if (n > max) max = n; }
    });
    return 'PED-' + (max + 1);
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
    if (!session) return { error: new Error('Sem sessão ativa') };
    var numero = await getNextOrderNumber();
    var rows = items.map(function (it) {
      return {
        revendedor_id: header.revendedorId || null,
        numero: numero,
        data: hojeISO(),
        itens: it.itens,
        valor: it.valor,
        status: 'entregue',
        produto_id: it.produtoId || null,
        quantidade: it.quantidade || null,
        sabor: it.sabor || null,
        usa_estoque: true,
        origem: 'loja',
        atendente_id: session.user.id
      };
    });
    var result = await client.from('orders').insert(rows);
    return { error: result.error, numero: numero };
  }

  // Vendas de loja de hoje (fechamento de caixa), agrupadas por numero.
  async function getTodaySales() {
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var result = await client
      .from('orders')
      .select('numero, revendedor_id, itens, valor, quantidade, sabor, created_at')
      .eq('origem', 'loja')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: false });
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
          cliente: o.revendedor_id ? (nomeById[o.revendedor_id] || 'Revendedor') : 'Balcão',
          valor: 0, items: []
        };
        ordem.push(g);
      }
      g.valor += Number(o.valor) || 0;
      g.items.push({ quantidade: o.quantidade, sabor: o.sabor, itens: o.itens, valor: Number(o.valor) || 0 });
    });
    var total = ordem.reduce(function (t, g) { return t + g.valor; }, 0);
    return { sales: ordem, total: total };
  }

  return {
    getSession: getSession,
    logout: logout,
    requireCaixa: requireCaixa,
    getProducts: getProducts,
    getResellers: getResellers,
    registerSale: registerSale,
    getTodaySales: getTodaySales
  };

})();
