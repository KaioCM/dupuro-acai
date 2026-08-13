// Dupuro Açaí — Edge Function: emitir NFC-e (cupom fiscal) via Focus NFe
// ==========================================================================
// Recebe o número de uma venda de loja (VND-XXXX), lê as linhas e os dados
// fiscais dos produtos NO SERVIDOR (service role — nunca confia em código
// fiscal vindo do cliente), monta o JSON da NFC-e, chama a API do Focus NFe
// (que assina com o certificado A1 e transmite ao SEFAZ-MT) e grava o retorno
// em public.nfce_emissoes.
//
// Segredos (nunca no cliente, nunca no git — configurados como secrets da
// função no painel do Supabase):
//   FOCUS_TOKEN      → token da API do Focus (o de HOMOLOGAÇÃO por enquanto)
//   FOCUS_AMBIENTE   → 'homologacao' (padrão) ou 'producao'
//
// Só atendente (caixa) e admin podem chamar. A emissão da NFC-e é síncrona:
// o SEFAZ responde autorizado/rejeitado no mesmo request.
// ==========================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CNPJ_EMITENTE = '39417218000181' // Dupuro Indústria e Comércio de Açaí LTDA

// Padrão fiscal (Simples Nacional, venda a consumidor dentro de MT). Usado como
// fallback quando o produto não tem o campo preenchido.
const FISCAL_PADRAO = { ncm: '08119000', csosn: '102', cfop: '5102', icms_origem: '0' }

// Forma de pagamento (orders.forma_pagamento) → código tPag da NFC-e.
const TPAG: Record<string, string> = {
  dinheiro: '01',
  credito: '03',
  debito: '04',
  pix: '17',
}

function focusBase(ambiente: string) {
  return ambiente === 'producao'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br'
}

// Horário local de Cuiabá (UTC-4), no formato exigido pela NFC-e.
function dataEmissaoCuiaba() {
  const t = new Date(Date.now() - 4 * 3600 * 1000)
  return t.toISOString().slice(0, 19) + '-04:00'
}

// caminho relativo do Focus (ex.: /arquivos/...) → URL absoluta.
function abs(base: string, caminho: unknown) {
  if (!caminho || typeof caminho !== 'string') return null
  return caminho.startsWith('http') ? caminho : base + caminho
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Sem sessão' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const focusToken = Deno.env.get('FOCUS_TOKEN')
    const ambiente = (Deno.env.get('FOCUS_AMBIENTE') || 'homologacao').toLowerCase()

    if (!focusToken) return json({ error: 'FOCUS_TOKEN não configurado na função' }, 500)

    // Quem chamou? (JWT do usuário)
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'Sessão inválida' }, 401)

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: perfil } = await admin
      .from('profiles').select('role').eq('id', userData.user.id).single()
    if (!perfil || (perfil.role !== 'atendente' && perfil.role !== 'admin')) {
      return json({ error: 'Apenas caixa/admin podem emitir NFC-e' }, 403)
    }

    const { numero } = await req.json()
    if (!numero) return json({ error: 'numero (VND-XXXX) é obrigatório' }, 400)

    // Já existe emissão desta venda?
    const { data: existentes } = await admin
      .from('nfce_emissoes').select('*')
      .eq('venda_numero', numero).eq('ambiente', ambiente)
      .order('id', { ascending: true })
    const jaAutorizada = (existentes || []).find((e) => e.status === 'autorizado')
    if (jaAutorizada) return json({ ja_emitida: true, emissao: jaAutorizada })

    // Linhas da venda + dados fiscais do produto.
    const { data: linhas, error: ordErr } = await admin
      .from('orders')
      .select('numero, quantidade, valor, itens, produto_id, forma_pagamento, ' +
        'products:produto_id (nome, ncm, csosn, cfop, icms_origem)')
      .eq('numero', numero)
    if (ordErr) return json({ error: ordErr.message }, 500)
    if (!linhas || !linhas.length) return json({ error: 'Venda não encontrada' }, 404)

    const items = linhas.map((l: any, i: number) => {
      const p = l.products || {}
      const qtd = Number(l.quantidade) || 1
      const bruto = Number(l.valor) || 0
      const unit = Number((bruto / qtd).toFixed(10))
      const item: Record<string, unknown> = {
        numero_item: String(i + 1),
        codigo_produto: String(l.produto_id ?? 'SEM-CAD'),
        descricao: String(l.itens || p.nome || 'Item').slice(0, 120),
        codigo_ncm: p.ncm || FISCAL_PADRAO.ncm,
        cfop: p.cfop || FISCAL_PADRAO.cfop,
        unidade_comercial: 'UN',
        unidade_tributavel: 'UN',
        quantidade_comercial: qtd,
        quantidade_tributavel: qtd,
        valor_unitario_comercial: unit,
        valor_unitario_tributavel: unit,
        valor_bruto: bruto,
        valor_desconto: 0,
        icms_origem: p.icms_origem || FISCAL_PADRAO.icms_origem,
        icms_situacao_tributaria: p.csosn || FISCAL_PADRAO.csosn,
      }
      // CEST não é enviado: a NFC-e autorizada do legado (inclusive item ST) sai
      // sem CEST, então seguimos igual pra não arriscar rejeição.
      return item
    })

    const total = items.reduce((s, it) => s + Number(it.valor_bruto), 0)
    const forma = linhas[0].forma_pagamento || 'dinheiro'

    const payload = {
      cnpj_emitente: CNPJ_EMITENTE,
      data_emissao: dataEmissaoCuiaba(),
      presenca_comprador: '1',
      modalidade_frete: '9',
      local_destino: '1',
      natureza_operacao: 'VENDA AO CONSUMIDOR',
      indicador_inscricao_estadual_destinatario: '9',
      items,
      formas_pagamento: [
        { forma_pagamento: TPAG[forma] || '99', valor_pagamento: Number(total.toFixed(2)) },
      ],
    }

    // ref idempotente; em retry (emissão anterior deu erro) muda o sufixo, senão
    // o Focus devolveria o mesmo cupom rejeitado.
    const tentativa = (existentes || []).length
    const ref = 'dupuro-' + ambiente + '-' + numero + (tentativa ? '-r' + (tentativa + 1) : '')

    const base = focusBase(ambiente)
    const resp = await fetch(base + '/v2/nfce?ref=' + encodeURIComponent(ref), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // HTTP Basic: usuário = token, senha vazia.
        'Authorization': 'Basic ' + btoa(focusToken + ':'),
      },
      body: JSON.stringify(payload),
    })
    const retorno = await resp.json().catch(() => ({}))

    const st = String(retorno.status || '')
    const status = st === 'autorizado'
      ? 'autorizado'
      : (st.startsWith('erro') || st === 'denegado' ? 'erro' : 'processando')

    // Autorizado: a consulta traz os dados de impressão (qrcode_url, protocolo,
    // caminhos) que o POST nem sempre devolve. Falha aqui não é fatal.
    let consulta: any = {}
    if (status === 'autorizado') {
      try {
        const cr = await fetch(base + '/v2/nfce/' + encodeURIComponent(ref), {
          headers: { 'Authorization': 'Basic ' + btoa(focusToken + ':') },
        })
        consulta = await cr.json().catch(() => ({}))
      } catch (_e) { /* segue com o que veio no POST */ }
    }

    const registro = {
      venda_numero: numero,
      ref,
      ambiente,
      status,
      status_sefaz: retorno.status_sefaz ?? consulta.status_sefaz ?? null,
      mensagem_sefaz: retorno.mensagem_sefaz ?? consulta.mensagem_sefaz ?? null,
      chave: retorno.chave_nfe ?? consulta.chave_nfe ?? null,
      numero_nfce: (retorno.numero ?? consulta.numero) != null ? String(retorno.numero ?? consulta.numero) : null,
      serie: (retorno.serie ?? consulta.serie) != null ? String(retorno.serie ?? consulta.serie) : null,
      protocolo: retorno.protocolo ?? retorno.numero_protocolo ?? consulta.protocolo ?? null,
      url_danfe: abs(base, retorno.caminho_danfe ?? consulta.caminho_danfe) ?? retorno.url ?? null,
      url_xml: abs(base, retorno.caminho_xml_nota_fiscal ?? consulta.caminho_xml_nota_fiscal),
      // qrcode_url = conteúdo do QR fiscal (usado pra gerar o QR na comanda).
      qrcode: consulta.qrcode_url ?? retorno.qrcode_url ?? retorno.qrcode ?? null,
      valor: Number(total.toFixed(2)),
      payload,
      retorno,
      criado_por: userData.user.id,
    }

    const { data: salvo, error: insErr } = await admin
      .from('nfce_emissoes').insert(registro).select().single()
    if (insErr) return json({ error: 'Emitido mas falhou ao salvar: ' + insErr.message, retorno }, 500)

    return json({ status, emissao: salvo }, resp.ok ? 200 : 200)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
