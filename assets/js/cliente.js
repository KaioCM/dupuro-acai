// ==========================================================================
// Dupuro Açaí — Área do Cliente (backend real via Supabase)
// Autenticação, perfil, pedidos e cupons vivem no Postgres do Supabase,
// protegidos por Row Level Security (cada revendedor só acessa os próprios dados).
// Ver supabase/schema.sql para o esquema e as políticas.
// ==========================================================================

var DupuroCliente = (function () {

  var client = window.DupuroSupabaseClient;

  // Cadastro de um novo revendedor. Cria a conta de autenticação (o trigger do
  // banco cria a linha em profiles com status 'pendente' automaticamente,
  // usando os dados extras passados em options.data).
  async function signup(data) {
    var result = await client.auth.signUp({
      email: data.email,
      password: data.senha,
      options: {
        data: {
          nome: data.nome,
          empresa: data.empresa || '',
          telefone: data.telefone,
          cidade: data.cidade || ''
        }
      }
    });
    return { error: result.error };
  }

  // Faz login e verifica se o cadastro já foi aprovado pelo admin (ou se é
  // uma conta admin, que não passa pelo fluxo de aprovação de revendedor).
  // Retorna { error } em caso de credenciais inválidas, ou
  // { error: null, status: 'pendente' | 'rejeitado' | 'aprovado', role: 'revendedor' | 'admin' }.
  async function login(email, password) {
    var result = await client.auth.signInWithPassword({ email: email, password: password });
    if (result.error) return { error: result.error };

    var profileResult = await client
      .from('profiles')
      .select('status, role')
      .eq('id', result.data.user.id)
      .single();
    var profile = profileResult.data || {};

    if (profile.role === 'admin') {
      return { error: null, status: 'aprovado', role: 'admin' };
    }

    // Revendedor e atendente exigem status 'aprovado' para entrar.
    if (profile.status !== 'aprovado') {
      await client.auth.signOut();
      return { error: null, status: profile.status || 'pendente', role: profile.role || 'revendedor' };
    }
    return { error: null, status: 'aprovado', role: profile.role || 'revendedor' };
  }

  async function logout() {
    await client.auth.signOut();
  }

  async function getSession() {
    var result = await client.auth.getSession();
    return result.data.session;
  }

  // Redireciona para o login se não houver sessão ativa. Retorna a sessão quando houver.
  async function requireAuth(redirectTo) {
    var session = await getSession();
    if (!session) {
      window.location.href = redirectTo || 'login.html';
      return null;
    }
    return session;
  }

  async function getProfile() {
    var session = await getSession();
    if (!session) return {};
    var result = await client
      .from('profiles')
      .select('nome, empresa, email, telefone, cidade, status, role')
      .eq('id', session.user.id)
      .single();
    if (result.error) return { email: session.user.email };
    return result.data || {};
  }

  async function saveProfile(profile) {
    var session = await getSession();
    if (!session) return { error: new Error('Sem sessão ativa') };
    var result = await client
      .from('profiles')
      .update({
        nome: profile.nome,
        empresa: profile.empresa,
        telefone: profile.telefone,
        cidade: profile.cidade
      })
      .eq('id', session.user.id);
    return { error: result.error };
  }

  // Dispara o e-mail de recuperação de senha. O link do e-mail leva o usuário
  // para redefinir-senha.html (mesma origem), onde ele cria a nova senha. Por
  // segurança, o Supabase não revela se o e-mail existe — resposta sem erro
  // mesmo quando não há conta. O redirectTo precisa estar na lista de "Redirect
  // URLs" do projeto Supabase (ex.: https://www.dupuroacai.com/**).
  async function requestPasswordReset(email) {
    var redirectTo = new URL('redefinir-senha.html', window.location.href).href;
    var result = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    return { error: result.error };
  }

  // Troca a senha da conta logada. Exige sessão ativa; o Supabase valida o
  // tamanho mínimo (6 caracteres na config padrão) e recusa senha igual à atual.
  async function changePassword(novaSenha) {
    var session = await getSession();
    if (!session) return { error: new Error('Sem sessão ativa') };
    var result = await client.auth.updateUser({ password: novaSenha });
    return { error: result.error };
  }

  // Não exponha o número de estoque pro revendedor — só se o produto/sabor ainda
  // pode ser pedido. O número em si é informação exclusiva do admin.
  // - Produto comum: emEstoque = products.estoque > 0.
  // - Produto multissabor: saboresDisponiveis = sabores com estoque > 0, e
  //   emEstoque = existe ao menos um sabor disponível.
  async function getProducts() {
    var result = await client
      .from('products')
      .select('id, nome, preco, imagem_url, tipo, multissabor, multissabor_incluir_acai, estoque, pedido_minimo, estoque_ref, estoque_ref_sabor, product_flavor_stock(sabor, estoque)')
      // Copo e self-service são exclusivos da loja física — o revendedor não os vê.
      .eq('modo', 'embalado')
      .order('nome', { ascending: true });
    if (result.error) return [];
    var raw = result.data || [];
    // Mapa por id para resolver estoque compartilhado (produto que "puxa" de outro).
    var byId = {};
    raw.forEach(function (p) { byId[p.id] = p; });

    return raw.map(function (p) {
      var multissabor = !!p.multissabor;
      var incluiAcai = p.multissabor_incluir_acai !== false;
      // Fonte do estoque: o dono (estoque_ref) ou o próprio produto.
      var source = (p.estoque_ref && byId[p.estoque_ref]) ? byId[p.estoque_ref] : p;
      var sourceFlavors = source.product_flavor_stock || [];
      var emEstoque, saboresDisponiveis = [], sabores = [];

      if (p.estoque_ref_sabor) {
        // Não-multissabor que consome um sabor fixo do dono (ex: Açaí 10L atacado).
        var row = sourceFlavors.filter(function (s) { return s.sabor === p.estoque_ref_sabor; })[0];
        emEstoque = !!row && Number(row.estoque) > 0;
      } else if (multissabor) {
        // TODOS os sabores do produto, cada um com um booleano de disponibilidade:
        // o revendedor vê os esgotados (sem poder escolhê-los), mas nunca vê o
        // número do estoque — esse continua sendo informação só do admin.
        sabores = sourceFlavors
          .filter(function (s) { return incluiAcai || s.sabor !== 'Açaí'; })
          .map(function (s) { return { sabor: s.sabor, disponivel: Number(s.estoque) > 0 }; });
        saboresDisponiveis = sabores
          .filter(function (s) { return s.disponivel; })
          .map(function (s) { return s.sabor; });
        emEstoque = saboresDisponiveis.length > 0;
      } else {
        emEstoque = Number(source.estoque) > 0;
      }

      return {
        id: p.id, nome: p.nome, preco: Number(p.preco), imagemUrl: p.imagem_url,
        tipo: p.tipo || 'varejo', multissabor: multissabor,
        multissaborIncluirAcai: incluiAcai,
        emEstoque: emEstoque, saboresDisponiveis: saboresDisponiveis, sabores: sabores,
        pedidoMinimo: Number(p.pedido_minimo) || 1
      };
    });
  }

  // Gera o próximo número de pedido no formato PED-XXXX (mesmo esquema do painel admin).
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

  // Pedido lançado pelo próprio revendedor. Status sempre 'enviado'
  // ("Pedido Enviado") — a policy orders_insert_self trava isso no banco,
  // então o revendedor não consegue lançar já 'processando'/'entregue'.
  // Só o admin muda o status depois, pelo painel dele.
  async function createOrder(productId, quantidade, itens, valor, sabor) {
    return createOrderCart([{ productId: productId, quantidade: quantidade, itens: itens, valor: valor, sabor: sabor }]);
  }

  // Pedido com vários itens ("carrinho"): grava N linhas com o MESMO numero.
  // O insert do array é atômico — se um item ficar sem estoque, o pedido inteiro
  // é revertido (nenhuma linha criada). Status sempre 'enviado' (trava na RLS).
  async function createOrderCart(items) {
    var session = await getSession();
    if (!session) return { error: new Error('Sem sessão ativa') };
    if (!items || !items.length) return { error: new Error('Carrinho vazio') };
    var numero = await getNextOrderNumber();
    var data = new Date().toISOString().split('T')[0];
    var rows = items.map(function (it) {
      return {
        revendedor_id: session.user.id,
        numero: numero,
        data: data,
        itens: it.itens,
        valor: it.valor,
        status: 'enviado',
        produto_id: it.productId,
        quantidade: it.quantidade,
        sabor: it.sabor || null
      };
    });
    var result = await client.from('orders').insert(rows);
    return { error: result.error, numero: numero };
  }

  // Agrupa linhas de orders por numero. Retorna 1 objeto por pedido, com a lista
  // de itens, valor somado e itens concatenados num texto.
  function groupOrders(rows) {
    var byNum = {};
    var order = [];
    rows.forEach(function (o) {
      var g = byNum[o.numero];
      if (!g) {
        g = byNum[o.numero] = { id: o.numero, numero: o.numero, data: o.data, status: o.status, valor: 0, items: [] };
        order.push(g);
      }
      g.valor += Number(o.valor);
      g.items.push({ id: o.id, produtoId: o.produto_id, quantidade: o.quantidade, sabor: o.sabor, itens: o.itens, valor: Number(o.valor), status: o.status });
    });
    order.forEach(function (g) { g.itens = g.items.map(function (i) { return i.itens; }).join(' · '); });
    return order;
  }

  // Agrupa as linhas por numero: cada "pedido" reúne seus itens (id = numero).
  async function getOrders() {
    var session = await getSession();
    if (!session) return [];
    var result = await client
      .from('orders')
      .select('numero, data, itens, valor, status, produto_id, quantidade, sabor')
      .eq('revendedor_id', session.user.id)
      .order('data', { ascending: false });
    if (result.error) return [];
    return groupOrders(result.data || []);
  }

  async function getCoupons() {
    var session = await getSession();
    if (!session) return [];
    var result = await client
      .from('coupons')
      .select('code, descricao, validade, usado')
      .eq('revendedor_id', session.user.id)
      .order('created_at', { ascending: false });
    if (result.error) return [];
    return (result.data || []).map(function (c) {
      return { code: c.code, desc: c.descricao, validade: c.validade, usado: c.usado };
    });
  }

  // Avisa quando a sessão termina (logout em outra aba, token expirado etc.)
  function onAuthStateChange(callback) {
    client.auth.onAuthStateChange(function (event, session) {
      callback(event, session);
    });
  }

  return {
    signup: signup,
    login: login,
    logout: logout,
    onAuthStateChange: onAuthStateChange,
    getSession: getSession,
    requireAuth: requireAuth,
    getProfile: getProfile,
    saveProfile: saveProfile,
    getProducts: getProducts,
    changePassword: changePassword,
    requestPasswordReset: requestPasswordReset,
    createOrder: createOrder,
    createOrderCart: createOrderCart,
    getOrders: getOrders,
    getCoupons: getCoupons
  };

})();
