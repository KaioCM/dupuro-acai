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

  // Lista as contas de atendente (caixa/PDV da loja).
  async function getAtendentes() {
    var result = await client
      .from('profiles')
      .select('id, nome, empresa, email, created_at')
      .eq('role', 'atendente')
      .order('nome', { ascending: true });
    return result.data || [];
  }

  // Id da conta logada — usado pra impedir que o admin rebaixe a si mesmo.
  async function getCurrentUserId() {
    var session = await getSession();
    return session ? session.user.id : null;
  }

  // Promove/rebaixa uma conta entre 'revendedor', 'admin' e 'atendente'. Ao virar
  // admin ou atendente, força status 'aprovado' (precisam poder entrar). A policy
  // profiles_update_own_or_admin deixa um admin alterar qualquer perfil.
  async function setProfileRole(id, role) {
    var patch = { role: role };
    if (role === 'admin' || role === 'atendente') patch.status = 'aprovado';
    var result = await client.from('profiles').update(patch).eq('id', id);
    return { error: result.error };
  }

  // ---------- Pedidos ----------
  // Junta orders + profiles no cliente (não há FK direta entre as duas
  // tabelas para o PostgREST embutir automaticamente).
  async function getAllOrders() {
    var ordersResult = await client
      .from('orders')
      .select('id, revendedor_id, numero, data, itens, valor, status, produto_id, quantidade, sabor, usa_estoque, origem')
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
        // Venda de loja (caixa): balcão avulso não tem revendedor; se tiver, é a
        // retirada de um revendedor. Rotula como "loja" para o admin distinguir.
        var nome;
        if (reseller) nome = (reseller.empresa || reseller.nome) + (o.origem === 'loja' ? ' (loja)' : '');
        else if (o.origem === 'loja') nome = o.revendedor_id ? 'Revendedor (loja)' : 'Balcão (loja)';
        else nome = o.revendedor_id ? '—' : 'Revendedor removido';
        g = byNum[o.numero] = {
          id: o.numero, numero: o.numero,
          revendedorId: o.revendedor_id,
          revendedorNome: nome,
          data: o.data, status: o.status, valor: 0, items: [],
          usaEstoque: o.usa_estoque !== false
        };
        order.push(g);
      }
      g.valor += Number(o.valor);
      g.items.push({ id: o.id, produtoId: o.produto_id, quantidade: o.quantidade, sabor: o.sabor, itens: o.itens, valor: Number(o.valor), status: o.status });
    });
    order.forEach(function (g) { g.itens = g.items.map(function (i) { return i.itens; }).join(' · '); });
    return order;
  }

  // Próximo número de pedido (PED-XXXX), calculado no banco por next_pedido_numero
  // (migration_021) — única fonte pros três canais, sem colidir com as vendas de
  // loja (VND-XXXX). A função é `stable`: dá pra chamar só pra pré-visualizar.
  async function getNextOrderNumber() {
    var result = await client.rpc('next_pedido_numero');
    if (result.error || !result.data) return null;
    return result.data;
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
  // header.usaEstoque = false: o pedido não valida nem altera o estoque (usado
  // para lançar pedidos antigos de produtos hoje esgotados). Só o admin pode —
  // a policy orders_insert_self obriga usa_estoque = true para o revendedor.
  async function createOrderCart(header, items) {
    if (!items || !items.length) return { error: new Error('Carrinho vazio') };
    var numero = await getNextOrderNumber();
    if (!numero) return { error: new Error('Não foi possível gerar o número do pedido') };
    var usaEstoque = header.usaEstoque !== false;
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
        sabor: it.sabor || null,
        usa_estoque: usaEstoque
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

  // Trilha de alterações/cancelamentos de venda de loja (migration_022). Só o
  // admin lê (RLS). Resolve o nome de quem fez a ação e resume o estado anterior.
  async function getOrderAudits() {
    var result = await client
      .from('order_audits')
      .select('id, numero, acao, motivo, snapshot, atendente_id, created_at')
      .order('created_at', { ascending: false });
    if (result.error) return [];

    var ids = [];
    (result.data || []).forEach(function (a) { if (a.atendente_id && ids.indexOf(a.atendente_id) === -1) ids.push(a.atendente_id); });
    var nomeById = {};
    if (ids.length) {
      var profs = await client.from('profiles').select('id, nome, email').in('id', ids);
      (profs.data || []).forEach(function (p) { nomeById[p.id] = p.nome || p.email || 'Atendente'; });
    }

    return (result.data || []).map(function (a) {
      var snap = a.snapshot || [];
      var itensAntes = snap.map(function (o) { return o.itens; }).filter(Boolean).join(', ');
      var valorAntes = snap.reduce(function (s, o) { return s + (Number(o.valor) || 0); }, 0);
      return {
        id: a.id, numero: a.numero, acao: a.acao, motivo: a.motivo,
        quem: a.atendente_id ? (nomeById[a.atendente_id] || 'Atendente') : 'Atendente',
        quando: a.created_at,
        itensAntes: itensAntes, valorAntes: valorAntes
      };
    });
  }

  // ---------- Produtos ----------
  async function getProducts() {
    var result = await client
      .from('products')
      .select('id, nome, preco, imagem_url, tipo, multissabor, multissabor_incluir_acai, estoque, pedido_minimo, litros, estoque_ref, estoque_ref_sabor, modo, acomp_gratis, acomp_extra_preco, product_flavor_stock(sabor, estoque)')
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
        compartilhado: shared, donoNome: donoNome,
        estoqueRefId: p.estoque_ref || null, estoqueRefSabor: p.estoque_ref_sabor || null,
        modo: p.modo || 'embalado',
        acompGratis: Number(p.acomp_gratis) || 0,
        acompExtraPreco: Number(p.acomp_extra_preco) || 0,
        litros: Number(p.litros) || 0
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
  function updateProduct(product, nome, preco, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo, file, litros) {
    return uploadAndSaveProduct(product, nome, preco, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo, file, litros);
  }

  async function uploadAndSaveProduct(product, nome, preco, tipo, multissabor, multissaborIncluirAcai, estoque, pedidoMinimo, file, litros) {
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
    if (litros != null) payload.litros = litros;
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

  // Exclui uma linha de produto por id (usado para remover a linha parceira de um
  // par varejo/atacado). Não mexe em imagem (é compartilhada com a linha dona).
  async function deleteProductById(id) {
    var result = await client.from('products').delete().eq('id', id);
    return { error: result.error };
  }

  // ---------- Produto varejo+atacado (estoque compartilhado) ----------
  // Salva um produto que pode existir como varejo, atacado ou AMBOS. Quando é
  // "ambos", vira DUAS linhas em products com o MESMO estoque: uma "dona" (guarda
  // o estoque, estoque_ref null) e uma "parceira" do outro tipo (estoque_ref → dona).
  // Preço e pedido mínimo são próprios de cada tipo; nome/imagem/multissabor são
  // compartilhados. Reconcilia criação, edição e conversões (add/remove um tipo),
  // movendo o estoque de dona quando o tipo que a guardava é desmarcado.
  //
  // spec = {
  //   existing: { ownerId, ownerTipo, partnerId, partnerTipo } | null,
  //   nome, multissabor, incluirAcai, estoque, flavorEntries,
  //   varejo: { on, preco, pedidoMinimo }, atacado: { on, preco, pedidoMinimo },
  //   file, currentImageUrl
  // }
  async function saveDualProduct(spec) {
    var vOn = spec.varejo.on, aOn = spec.atacado.on;
    if (!vOn && !aOn) return { error: new Error('Selecione varejo, atacado ou ambos.') };

    // Imagem: sobe uma vez e usa nas duas linhas; troca a antiga se veio arquivo novo.
    var imagemUrl = spec.currentImageUrl || null;
    if (spec.file) {
      var path = Date.now() + '-' + spec.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var upload = await client.storage.from('produtos').upload(path, spec.file);
      if (upload.error) return { error: upload.error };
      imagemUrl = client.storage.from('produtos').getPublicUrl(path).data.publicUrl;
      if (spec.currentImageUrl) {
        var marker = '/produtos/';
        var idx = spec.currentImageUrl.indexOf(marker);
        if (idx !== -1) await client.storage.from('produtos').remove([decodeURIComponent(spec.currentImageUrl.substring(idx + marker.length))]);
      }
    }

    var ex = spec.existing || {};
    var byTipo = {};
    if (ex.ownerTipo) byTipo[ex.ownerTipo] = ex.ownerId;
    if (ex.partnerTipo) byTipo[ex.partnerTipo] = ex.partnerId;

    // Tipo dono do estoque: mantém o atual se ainda estiver ligado; senão, o que sobrou.
    var ownerTipo;
    if (ex.ownerTipo && ((ex.ownerTipo === 'varejo' && vOn) || (ex.ownerTipo === 'atacado' && aOn))) ownerTipo = ex.ownerTipo;
    else ownerTipo = vOn ? 'varejo' : 'atacado';
    var partnerTipo = ownerTipo === 'varejo' ? 'atacado' : 'varejo';
    var partnerOn = ownerTipo === 'varejo' ? aOn : vOn;
    function td(t) { return t === 'varejo' ? spec.varejo : spec.atacado; }

    // 1) Linha DONA (guarda o estoque). Reaproveita a linha existente do tipo dono
    //    (pode ser a antiga parceira "promovida" a dona — estoque_ref volta a null).
    var od = td(ownerTipo);
    var ownerPayload = {
      nome: spec.nome, preco: od.preco, imagem_url: imagemUrl,
      tipo: ownerTipo, multissabor: !!spec.multissabor, multissabor_incluir_acai: !!spec.incluirAcai,
      estoque: spec.multissabor ? 0 : spec.estoque, pedido_minimo: od.pedidoMinimo || 1,
      estoque_ref: null, estoque_ref_sabor: null,
      modo: 'embalado', acomp_gratis: 0, acomp_extra_preco: 0,
      litros: spec.litros || 0
    };
    var ownerId = byTipo[ownerTipo] || null;
    var res;
    if (ownerId) res = await client.from('products').update(ownerPayload).eq('id', ownerId).select('id').single();
    else res = await client.from('products').insert(ownerPayload).select('id').single();
    if (res.error) return { error: res.error };
    ownerId = res.data.id;
    var fs = await saveFlavorStock(ownerId, spec.multissabor ? spec.flavorEntries : []);
    if (fs.error) return { error: fs.error };

    // 2) Linha PARCEIRA (outro tipo), se ligado — divide o estoque (estoque_ref → dona).
    var partnerId = byTipo[partnerTipo] || null;
    if (partnerOn) {
      var pd = td(partnerTipo);
      var partnerPayload = {
        nome: spec.nome, preco: pd.preco, imagem_url: imagemUrl,
        tipo: partnerTipo, multissabor: !!spec.multissabor, multissabor_incluir_acai: !!spec.incluirAcai,
        estoque: 0, pedido_minimo: pd.pedidoMinimo || 1,
        estoque_ref: ownerId, estoque_ref_sabor: null,
        modo: 'embalado', acomp_gratis: 0, acomp_extra_preco: 0,
        litros: spec.litros || 0
      };
      var pres;
      if (partnerId) pres = await client.from('products').update(partnerPayload).eq('id', partnerId).select('id').single();
      else pres = await client.from('products').insert(partnerPayload).select('id').single();
      if (pres.error) return { error: pres.error };
      // Parceira nunca guarda estoque próprio (lê o da dona).
      if (spec.multissabor) { var pfs = await saveFlavorStock(pres.data.id, []); if (pfs.error) return { error: pfs.error }; }
    } else if (partnerId) {
      // Tipo parceiro foi desmarcado: remove a linha dele.
      await client.from('products').delete().eq('id', partnerId);
    }

    return { error: null, ownerId: ownerId };
  }

  // ---------- Produto da loja: copo e self-service (migration_019) ----------
  // Copo e self-service são vendidos só no balcão (caixa): uma única linha em
  // products, sem tipo atacado/varejo duplo, sem multissabor e sem estoque por
  // unidade. No 'copo', preco = valor do copo + regra de acompanhamentos; no
  // 'peso', preco = R$/kg.
  //
  // spec = { existing: { ownerId, partnerId } | null, modo: 'copo'|'peso',
  //          nome, preco, acompGratis, acompExtraPreco, file, currentImageUrl }
  async function saveStoreProduct(spec) {
    var imagemUrl = spec.currentImageUrl || null;
    if (spec.file) {
      var path = Date.now() + '-' + spec.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var upload = await client.storage.from('produtos').upload(path, spec.file);
      if (upload.error) return { error: upload.error };
      imagemUrl = client.storage.from('produtos').getPublicUrl(path).data.publicUrl;
      if (spec.currentImageUrl) {
        var marker = '/produtos/';
        var idx = spec.currentImageUrl.indexOf(marker);
        if (idx !== -1) await client.storage.from('produtos').remove([decodeURIComponent(spec.currentImageUrl.substring(idx + marker.length))]);
      }
    }

    var ex = spec.existing || {};
    var payload = {
      nome: spec.nome, preco: spec.preco, imagem_url: imagemUrl,
      tipo: 'varejo', multissabor: false, multissabor_incluir_acai: true,
      estoque: 0, pedido_minimo: 1, estoque_ref: null, estoque_ref_sabor: null,
      modo: spec.modo,
      acomp_gratis: spec.modo === 'copo' ? (spec.acompGratis || 0) : 0,
      acomp_extra_preco: spec.modo === 'copo' ? (spec.acompExtraPreco || 0) : 0
    };

    var res = ex.ownerId
      ? await client.from('products').update(payload).eq('id', ex.ownerId).select('id').single()
      : await client.from('products').insert(payload).select('id').single();
    if (res.error) return { error: res.error };

    // Virou produto de loja: some com o que só fazia sentido no modo embalado
    // (linha parceira varejo/atacado e estoque por sabor).
    if (ex.partnerId) await client.from('products').delete().eq('id', ex.partnerId);
    if (ex.ownerId) await saveFlavorStock(res.data.id, []);

    return { error: null, ownerId: res.data.id };
  }

  // ---------- Configurações (migration_023) ----------
  // Litros no pedido que dispensam o pedido mínimo dos itens.
  async function getLitrosDispensaMinimo() {
    var result = await client.from('app_settings').select('valor').eq('chave', 'litros_dispensa_minimo').maybeSingle();
    if (result.error || !result.data) return 50;
    return Number(result.data.valor);
  }

  async function setLitrosDispensaMinimo(litros) {
    var result = await client.from('app_settings')
      .upsert({ chave: 'litros_dispensa_minimo', valor: litros, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
    return { error: result.error };
  }

  // ---------- Acompanhamentos (migration_019) ----------
  async function getAcompanhamentos() {
    var result = await client
      .from('acompanhamentos')
      .select('id, nome, tipo, preco, ativo, ordem')
      .order('ordem', { ascending: true })
      .order('nome', { ascending: true });
    if (result.error) return [];
    return (result.data || []).map(function (a) {
      return {
        id: a.id, nome: a.nome, tipo: a.tipo || 'gratuito',
        preco: Number(a.preco) || 0, ativo: a.ativo !== false, ordem: Number(a.ordem) || 0
      };
    });
  }

  async function saveAcompanhamento(spec) {
    var payload = {
      nome: spec.nome, tipo: spec.tipo,
      preco: spec.tipo === 'pago' ? (spec.preco || 0) : 0,
      ativo: spec.ativo !== false, ordem: spec.ordem || 0
    };
    var result = spec.id
      ? await client.from('acompanhamentos').update(payload).eq('id', spec.id)
      : await client.from('acompanhamentos').insert(payload);
    return { error: result.error };
  }

  async function setAcompanhamentoAtivo(id, ativo) {
    var result = await client.from('acompanhamentos').update({ ativo: !!ativo }).eq('id', id);
    return { error: result.error };
  }

  async function deleteAcompanhamento(id) {
    var result = await client.from('acompanhamentos').delete().eq('id', id);
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

  // ---------- Custos de produção (por leva) ----------
  // Tabelas admin-only (migration_024). Cada leva tem gastos (linhas por
  // categoria) e itens (produtos que saíram). O custo por litro é o gasto
  // total dividido pelo total de litros produzidos; o custo de cada produto é
  // rateado por volume. Os totais são calculados aqui na leitura, não gravados.
  async function getProducoes() {
    var prodResult = await client
      .from('producoes')
      .select('id, data, rotulo, observacao, created_at')
      .order('data', { ascending: false })
      .order('id', { ascending: false });
    if (prodResult.error) return [];
    var levas = prodResult.data || [];
    if (!levas.length) return [];

    var ids = levas.map(function (l) { return l.id; });
    var gastosResult = await client
      .from('producao_gastos')
      .select('id, producao_id, descricao, categoria, valor')
      .in('producao_id', ids);
    var itensResult = await client
      .from('producao_itens')
      .select('id, producao_id, produto_id, produto_nome, quantidade, litros_unit')
      .in('producao_id', ids);

    var gastosBy = {};
    (gastosResult.data || []).forEach(function (g) {
      (gastosBy[g.producao_id] = gastosBy[g.producao_id] || []).push({
        id: g.id, descricao: g.descricao, categoria: g.categoria, valor: Number(g.valor) || 0
      });
    });
    var itensBy = {};
    (itensResult.data || []).forEach(function (it) {
      var qtd = Number(it.quantidade) || 0;
      var lu = Number(it.litros_unit) || 0;
      (itensBy[it.producao_id] = itensBy[it.producao_id] || []).push({
        id: it.id, produtoId: it.produto_id, nome: it.produto_nome,
        quantidade: qtd, litrosUnit: lu, litrosTotal: qtd * lu
      });
    });

    return levas.map(function (l) {
      var gastos = gastosBy[l.id] || [];
      var itens = itensBy[l.id] || [];
      var gastoTotal = gastos.reduce(function (s, g) { return s + g.valor; }, 0);
      var porCategoria = { materia_prima: 0, embalagem: 0, mao_de_obra: 0, contas_fixos: 0 };
      gastos.forEach(function (g) { if (porCategoria[g.categoria] !== undefined) porCategoria[g.categoria] += g.valor; });
      var litrosTotal = itens.reduce(function (s, it) { return s + it.litrosTotal; }, 0);
      var custoPorLitro = litrosTotal > 0 ? gastoTotal / litrosTotal : null;
      return {
        id: l.id, data: l.data, rotulo: l.rotulo, observacao: l.observacao,
        gastos: gastos, itens: itens,
        gastoTotal: gastoTotal, porCategoria: porCategoria,
        litrosTotal: litrosTotal, custoPorLitro: custoPorLitro
      };
    });
  }

  // header = { data, rotulo, observacao }
  // gastos = [{ descricao, categoria, valor }]
  // itens  = [{ produtoId, nome, quantidade, litrosUnit }]
  async function createProducao(header, gastos, itens) {
    var ins = await client.from('producoes').insert({
      data: header.data || null,
      rotulo: header.rotulo || null,
      observacao: header.observacao || null
    }).select('id').single();
    if (ins.error) return { error: ins.error };
    var id = ins.data.id;
    var filhosErro = await inserirFilhosProducao(id, gastos, itens);
    return { error: filhosErro, id: id };
  }

  async function updateProducao(id, header, gastos, itens) {
    var upd = await client.from('producoes').update({
      data: header.data || null,
      rotulo: header.rotulo || null,
      observacao: header.observacao || null
    }).eq('id', id);
    if (upd.error) return { error: upd.error };
    // Recria os filhos: tabela só-admin, então apagar e reinserir é seguro.
    await client.from('producao_gastos').delete().eq('producao_id', id);
    await client.from('producao_itens').delete().eq('producao_id', id);
    var filhosErro = await inserirFilhosProducao(id, gastos, itens);
    return { error: filhosErro };
  }

  async function inserirFilhosProducao(id, gastos, itens) {
    var gRows = (gastos || []).map(function (g) {
      return { producao_id: id, descricao: g.descricao || null, categoria: g.categoria, valor: g.valor || 0 };
    });
    var iRows = (itens || []).map(function (it) {
      return {
        producao_id: id, produto_id: it.produtoId || null, produto_nome: it.nome || null,
        quantidade: it.quantidade || 0, litros_unit: it.litrosUnit || 0
      };
    });
    if (gRows.length) { var gr = await client.from('producao_gastos').insert(gRows); if (gr.error) return gr.error; }
    if (iRows.length) { var ir = await client.from('producao_itens').insert(iRows); if (ir.error) return ir.error; }
    return null;
  }

  async function deleteProducao(id) {
    var result = await client.from('producoes').delete().eq('id', id);
    return { error: result.error };
  }

  // ---------- Fechamentos de caixa (admin lê tudo) ----------
  async function getCaixaFechamentos() {
    var r = await client
      .from('caixa_sessoes')
      .select('id, atendente_id, status, fundo_troco, aberta_em, fechada_em, dinheiro_contado, dinheiro_esperado, diferenca, resumo')
      .order('aberta_em', { ascending: false })
      .limit(120);
    if (r.error) return [];
    var sessoes = r.data || [];
    var ids = [];
    sessoes.forEach(function (s) { if (s.atendente_id && ids.indexOf(s.atendente_id) === -1) ids.push(s.atendente_id); });
    var nomeById = {};
    if (ids.length) {
      var profs = await client.from('profiles').select('id, nome, email').in('id', ids);
      (profs.data || []).forEach(function (p) { nomeById[p.id] = p.nome || p.email || 'Atendente'; });
    }
    return sessoes.map(function (s) {
      return {
        id: s.id, status: s.status,
        atendente: s.atendente_id ? (nomeById[s.atendente_id] || 'Atendente') : 'Atendente',
        fundoTroco: Number(s.fundo_troco) || 0,
        abertaEm: s.aberta_em, fechadaEm: s.fechada_em,
        dinheiroContado: s.dinheiro_contado != null ? Number(s.dinheiro_contado) : null,
        dinheiroEsperado: s.dinheiro_esperado != null ? Number(s.dinheiro_esperado) : null,
        diferenca: s.diferenca != null ? Number(s.diferenca) : null,
        resumo: s.resumo || null
      };
    });
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
    getAtendentes: getAtendentes,
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
    getOrderAudits: getOrderAudits,
    getAllCoupons: getAllCoupons,
    generateCoupon: generateCoupon,
    deleteCoupon: deleteCoupon,
    getProducts: getProducts,
    createProduct: createProduct,
    updateProduct: updateProduct,
    saveDualProduct: saveDualProduct,
    saveStoreProduct: saveStoreProduct,
    deleteProduct: deleteProduct,
    deleteProductById: deleteProductById,
    saveFlavorStock: saveFlavorStock,
    getLitrosDispensaMinimo: getLitrosDispensaMinimo,
    setLitrosDispensaMinimo: setLitrosDispensaMinimo,
    getAcompanhamentos: getAcompanhamentos,
    saveAcompanhamento: saveAcompanhamento,
    setAcompanhamentoAtivo: setAcompanhamentoAtivo,
    deleteAcompanhamento: deleteAcompanhamento,
    getProducoes: getProducoes,
    createProducao: createProducao,
    updateProducao: updateProducao,
    deleteProducao: deleteProducao,
    getCaixaFechamentos: getCaixaFechamentos
  };

})();
