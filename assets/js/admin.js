// ==========================================================================
// Dupuro Açaí — Painel Admin (backend real via Supabase)
// Aprovação de revendedores, gestão de pedidos e visão geral de cupons.
// Protegido por RLS: só funciona para contas com profiles.role = 'admin'
// (ver supabase/migration_003_admin.sql).
// ==========================================================================

var DupuroAdmin = (function () {

  var client = window.DupuroSupabaseClient;

  async function getSession() {
    var result = await client.auth.getSession();
    return result.data.session;
  }

  // Redireciona pro login se não houver sessão, ou pro painel do revendedor
  // se a conta logada não for admin. Retorna a sessão quando for admin de fato.
  async function requireAdmin(redirectTo) {
    var session = await getSession();
    if (!session) {
      window.location.href = redirectTo || 'login.html';
      return null;
    }
    var result = await client
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();
    if (!result.data || result.data.role !== 'admin') {
      window.location.href = 'dashboard.html';
      return null;
    }
    return session;
  }

  async function logout() {
    await client.auth.signOut();
  }

  function onAuthStateChange(callback) {
    client.auth.onAuthStateChange(function (event, session) {
      callback(event, session);
    });
  }

  // ---------- Aprovações ----------
  async function getPendingProfiles() {
    var result = await client
      .from('profiles')
      .select('id, nome, empresa, email, telefone, cidade, created_at')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true });
    return result.data || [];
  }

  async function setProfileStatus(id, status) {
    var result = await client.from('profiles').update({ status: status }).eq('id', id);
    return { error: result.error };
  }

  // ---------- Revendedores ----------
  async function getResellers() {
    var result = await client
      .from('profiles')
      .select('id, nome, empresa, email, telefone, cidade, created_at')
      .eq('status', 'aprovado')
      .eq('role', 'revendedor')
      .order('nome', { ascending: true });
    return result.data || [];
  }

  async function updateReseller(id, data) {
    var result = await client
      .from('profiles')
      .update({ nome: data.nome, empresa: data.empresa, telefone: data.telefone, cidade: data.cidade })
      .eq('id', id);
    return { error: result.error };
  }

  // Exclusão de verdade da conta (auth.users) via Edge Function — precisa da
  // service role key, que nunca fica no navegador. Ver supabase/functions
  // (deploy feito via MCP). Pedidos/cupons do revendedor NÃO são apagados,
  // só perdem a referência ao dono (ver migration_006).
  async function deleteReseller(userId) {
    var session = await getSession();
    if (!session) return { error: new Error('Sem sessão ativa') };

    var response = await fetch(window.DUPURO_SUPABASE_URL + '/functions/v1/admin-delete-reseller', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({ userId: userId })
    });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) return { error: new Error(body.error || 'Falha ao excluir conta') };
    return { error: null };
  }

  // Troca a senha do admin logado. Mesmo mecanismo do revendedor: exige sessão
  // ativa e o Supabase valida tamanho mínimo e recusa senha igual à atual.
  async function changePassword(novaSenha) {
    var session = await getSession();
    if (!session) return { error: new Error('Sem sessão ativa') };
    var result = await client.auth.updateUser({ password: novaSenha });
    return { error: result.error };
  }

  // ---------- Administradores ----------
  // Lista as contas com papel de admin (acesso total ao painel).
  async function getAdmins() {
    var result = await client
      .from('profiles')
      .select('id, nome, empresa, email, created_at')
      .eq('role', 'admin')
      .order('nome', { ascending: true });
    return result.data || [];
  }

  // Id da conta logada — usado pra impedir que o admin rebaixe a si mesmo.
  async function getCurrentUserId() {
    var session = await getSession();
    return session ? session.user.id : null;
  }

  // Promove/rebaixa uma conta entre 'revendedor' e 'admin'. Ao virar admin, força
  // status 'aprovado' (admin não passa pelo fluxo de aprovação). A policy
  // profiles_update_own_or_admin deixa um admin alterar qualquer perfil.
  async function setProfileRole(id, role) {
    var patch = { role: role };
    if (role === 'admin') patch.status = 'aprovado';
    var result = await client.from('profiles').update(patch).eq('id', id);
    return { error: result.error };
  }

  // ---------- Pedidos ----------
  // Junta orders + profiles no cliente (não há FK direta entre as duas
  // tabelas para o PostgREST embutir automaticamente).
  async function getAllOrders() {
    var ordersResult = await client
      .from('orders')
      .select('id, revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor')
      .order('data', { ascending: false });
    if (ordersResult.error) return [];

    var resellers = await getResellers();
    var byId = {};
    resellers.forEach(function (r) { byId[r.id] = r; });

    // Agrupa por numero: 1 objeto por pedido, reunindo seus itens.
    var byNum = {};
    var order = [];
    (ordersResult.data || []).forEach(function (o) {
      var g = byNum[o.numero];
      if (!g) {
        var reseller = byId[o.revendedor_id];
        g = byNum[o.numero] = {
          id: o.numero, numero: o.numero,
          revendedorId: o.revendedor_id,
          revendedorNome: reseller ? (reseller.empresa || reseller.nome) : (o.revendedor_id ? '—' : 'Revendedor removido'),
          data: o.data, status: o.status, valor: 0, items: []
        };
        order.push(g);
      }
      g.valor += Number(o.valor);
      g.items.push({ id: o.id, produtoId: o.produto_id, quantidade: o.quantidade, sabor: o.sabor, itens: o.itens, valor: Number(o.valor), status: o.status });
    });
    order.forEach(function (g) { g.itens = g.items.map(function (i) { return i.itens; }).join(' · '); });
    return order;
  }

  // Gera o próximo número de pedido no formato PED-XXXX, olhando o maior
  // número já usado (evita ter que digitar/controlar isso manualmente).
  async function getNextOrderNumber() {
    var result = await client.from('orders').select('numero');
    var max = 1000;
    (result.data || []).forEach(function (o) {
      var match = /^PED-(\d+)$/.exec(o.numero || '');
      if (match) {
        var n = parseInt(match[1], 10);
        if (n > max) max = n;
      }
    });
    return 'PED-' + (max + 1);
  }

  async function createOrder(order) {
    return createOrderCart(
      { revendedorId: order.revendedorId, data: order.data, status: order.status },
      [{ produtoId: order.produtoId, quantidade: order.quantidade, itens: order.itens, valor: order.valor, sabor: order.sabor }]
    );
  }

  // Pedido com vários itens ("carrinho"): N linhas com o MESMO numero, para o
  // mesmo revendedor/data/status. Insert de array = atômico (se um item faltar
  // estoque, o pedido inteiro é revertido).
  async function createOrderCart(header, items) {
    if (!items || !items.length) return { error: new Error('Carrinho vazio') };
    var numero = await getNextOrderNumber();
    var rows = items.map(function (it) {
      return {
        revendedor_id: header.revendedorId,
        numero: numero,
        data: header.data,
        itens: it.itens,
        valor: it.valor,
        status: header.status,
        produto_id: it.produtoId || null,
        quantidade: it.quantidade || null,
        sabor: it.sabor || null
      };
    });
    var result = await client.from('orders').insert(rows);
    return { error: result.error, numero: numero };
  }

  async function updateOrderStatus(orderId, status) {
    var result = await client.from('orders').update({ status: status }).eq('id', orderId);
    return { error: result.error };
  }

  async function updateOrder(orderId, order) {
    var result = await client.from('orders').update({
      revendedor_id: order.revendedorId,
      data: order.data,
      itens: order.itens,
      valor: order.valor,
      status: order.status,
      produto_id: order.produtoId || null,
      quantidade: order.quantidade || null,
      sabor: order.sabor || null
    }).eq('id', orderId);
    return { error: result.error };
  }

  async function deleteOrder(orderId) {
    var result = await client.from('orders').delete().eq('id', orderId);
    return { error: result.error };
  }

  // Ações no pedido inteiro (todas as linhas com o mesmo numero).
  async function updateOrderStatusByNumero(numero, status) {
    var result = await client.from('orders').update({ status: status }).eq('numero', numero);
    return { error: result.error };
  }

  async function deleteOrderByNumero(numero) {
    var result = await client.from('orders').delete().eq('numero', numero);
    return { error: result.error };
  }

  // ---------- Produtos ----------
  async function getProducts() {
    var result = await client
      .from('products')
      .select('id, nome, preco, imagem_url, tipo, multissabor, multissabor_incluir_acai, estoque, pedido_minimo, estoque_ref, estoque_ref_sabor, product_flavor_stock(sabor, estoque)')
      .order('nome', { ascending: true });
    if (result.error) return [];
    var raw = result.data || [];
    var byId = {};
    raw.forEach(function (p) { byId[p.id] = p; });

    return raw.map(function (p) {
      var multissabor = !!p.multissabor;
      var incluiAcai = p.multissabor_incluir_acai !== false;
      var shared = !!p.estoque_ref;
      // Fonte do estoque: dono (estoque_ref) ou o próprio produto.
      var source = (shared && byId[p.estoque_ref]) ? byId[p.estoque_ref] : p;
      var donoNome = (shared && byId[p.estoque_ref]) ? byId[p.estoque_ref].nome : null;
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
        estoque: Number(p.estoque) || 0, sabores: sabores, estoqueTotal: estoqueTotal,
        pedidoMinimo: Number(p.pedido_minimo) || 1,
        compartilhado: shared, donoNome: donoNome
      };
    });
  }

  // Salva o estoque por sabor de um produto multissabor: grava os sabores
  // informados e apaga as linhas de sabores que não estão mais na lista (ex:
  // Açaí quando "incluir açaí" é desmarcado). entries: [{sabor, estoque}].
  async function saveFlavorStock(produtoId, entries) {
    var sabores = entries.map(function (e) { return e.sabor; });
    // apaga sabores fora da lista atual
    var del = client.from('product_flavor_stock').delete().eq('produto_id', produtoId);
    if (sabores.length) del = del.not('sabor', 'in', '(' + sabores.map(function (s) { return '"' + s + '"'; }).join(',') + ')');
    await del;
    if (!entries.length) return { error: null };
    var rows = entries.map(function (e) { return { produto_id: produtoId, sabor: e.sabor, estoque: e.estoque }; });
    var result = await client.from('product_flavor_stock').upsert(rows, { onConflict: 'produto_id,sabor' });
    return { error: result.error };
  }

  // Cria um produto; se houver arquivo de imagem, sobe pro bucket 'produtos'
  // (público para leitura, upload restrito ao admin via RLS de storage).
  function createProduct(nome, preco, file, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo) {
    return uploadAndSaveProduct(null, nome, preco, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo, file);
  }

  // Atualiza um produto; se houver novo arquivo de imagem, sobe pro bucket e
  // apaga a imagem antiga (best-effort). Sem arquivo novo, mantém a imagem atual.
  function updateProduct(product, nome, preco, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo, file) {
    return uploadAndSaveProduct(product, nome, preco, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo, file);
  }

  async function uploadAndSaveProduct(product, nome, preco, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo, file) {
    var imagemUrl = product ? product.imagemUrl : null;
    if (file) {
      var path = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var upload = await client.storage.from('produtos').upload(path, file);
      if (upload.error) return { error: upload.error };
      imagemUrl = client.storage.from('produtos').getPublicUrl(path).data.publicUrl;

      if (product && product.imagemUrl) {
        var marker = '/produtos/';
        var idx = product.imagemUrl.indexOf(marker);
        if (idx !== -1) {
          var oldPath = decodeURIComponent(product.imagemUrl.substring(idx + marker.length));
          await client.storage.from('produtos').remove([oldPath]);
        }
      }
    }
    var payload = { nome: nome, preco: preco, imagem_url: imagemUrl, tipo: tipo || 'varejo', multissabor: !!multissabor, multissabor_incluir_acai: !!multissaborIncluirAcai, estoque: estoque, pedido_minimo: pedidoMinimo || 1 };
    var result = product
      ? await client.from('products').update(payload).eq('id', product.id).select('id').single()
      : await client.from('products').insert(payload).select('id').single();
    return { error: result.error, id: result.data ? result.data.id : (product ? product.id : null) };
  }

  async function deleteProduct(product) {
    // Remove a imagem do storage primeiro (best-effort — não bloqueia a exclusão)
    if (product.imagemUrl) {
      var marker = '/produtos/';
      var idx = product.imagemUrl.indexOf(marker);
      if (idx !== -1) {
        var path = decodeURIComponent(product.imagemUrl.substring(idx + marker.length));
        await client.storage.from('produtos').remove([path]);
      }
    }
    var result = await client.from('products').delete().eq('id', product.id);
    return { error: result.error };
  }

  // ---------- Cupons ----------
  // Só o admin gera e apaga cupons (ver migration_004_cupons_admin.sql).
  async function getAllCoupons() {
    var couponsResult = await client
      .from('coupons')
      .select('id, revendedor_id, code, descricao, validade, usado')
      .order('created_at', { ascending: false });
    if (couponsResult.error) return [];

    var resellers = await getResellers();
    var byId = {};
    resellers.forEach(function (r) { byId[r.id] = r; });

    return (couponsResult.data || []).map(function (c) {
      var reseller = byId[c.revendedor_id];
      return {
        id: c.id,
        code: c.code,
        desc: c.descricao,
        validade: c.validade,
        usado: c.usado,
        revendedorNome: reseller ? (reseller.empresa || reseller.nome) : '—'
      };
    });
  }

  async function generateCoupon(revendedorId, desc, discountPercent, validDays) {
    var code = 'DUPURO-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    var validade = new Date();
    validade.setDate(validade.getDate() + (validDays || 30));

    var result = await client.from('coupons').insert({
      revendedor_id: revendedorId,
      code: code,
      descricao: desc || (discountPercent + '% de desconto'),
      desconto_percent: discountPercent,
      validade: validade.toISOString().split('T')[0],
      usado: false
    });
    return { error: result.error };
  }

  async function deleteCoupon(couponId) {
    var result = await client.from('coupons').delete().eq('id', couponId);
    return { error: result.error };
  }

  return {
    requireAdmin: requireAdmin,
    logout: logout,
    onAuthStateChange: onAuthStateChange,
    getPendingProfiles: getPendingProfiles,
    setProfileStatus: setProfileStatus,
    getResellers: getResellers,
    updateReseller: updateReseller,
    deleteReseller: deleteReseller,
    getAdmins: getAdmins,
    getCurrentUserId: getCurrentUserId,
    setProfileRole: setProfileRole,
    changePassword: changePassword,
    getAllOrders: getAllOrders,
    getNextOrderNumber: getNextOrderNumber,
    createOrder: createOrder,
    createOrderCart: createOrderCart,
    updateOrder: updateOrder,
    updateOrderStatus: updateOrderStatus,
    updateOrderStatusByNumero: updateOrderStatusByNumero,
    deleteOrder: deleteOrder,
    deleteOrderByNumero: deleteOrderByNumero,
    getAllCoupons: getAllCoupons,
    generateCoupon: generateCoupon,
    deleteCoupon: deleteCoupon,
    getProducts: getProducts,
    createProduct: createProduct,
    updateProduct: updateProduct,
    deleteProduct: deleteProduct,
    saveFlavorStock: saveFlavorStock
  };

})();
