# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Revendedores** (sorveterias, lanchonetes, açaiterias de Cuiabá e Várzea Grande): compram açaí no atacado direto da fábrica pelo painel do revendedor (`area-cliente/dashboard.html`).
- **Clientes de casa**: compram caixas de 1 L a 10 L e granola pelo Dupuro Delivery (`/delivery`), com entrega das 13h às 17h.
- **Atendente da loja da fábrica**: vende no balcão pelo caixa (`area-cliente/caixa.html`), muitas vezes no app desktop (Electron).
- **Admins**: o Kayo (dono, que montou o sistema) e a sócia, que não montou e precisa achar tudo sem explicação. Usam o admin meio a meio no celular e no computador. As tarefas diárias têm o mesmo peso: confirmar pedidos, cuidar da produção e do estoque, ver os números e manter os cadastros (revendedores, produtos, cupons).

## Product Purpose
Site e sistema da Dupuro Açaí, fábrica de açaí em Cuiabá-MT. A meta central é tirar os pedidos do WhatsApp. Hoje o revendedor ainda avisa no WhatsApp que fez o pedido; o painel precisa ficar bom o bastante para que esse aviso deixe de ser necessário. Sucesso é cada pedido chegar, ser confirmado e baixar o estoque sem conversa paralela.

## Positioning
Açaí direto da fábrica, sem pedido mínimo para revender. A mesma fábrica atende três canais: atacado (revenda), balcão da loja e delivery para casa. Estoque é por sabor.

## Operating Context
- Pedido de revendedor nasce com status `enviado` e **não reserva estoque**. Na criação o sistema só valida se há estoque disponível. O estoque baixa somente quando o admin confirma (`processando`/`entregue`), via trigger `adjust_stock_on_order_change`.
- Venda de balcão já nasce `entregue` e baixa estoque na hora. A loja tem cerca de 10 vendas por dia, contra cerca de 3 pedidos de revenda por semana no painel.
- Delivery: tabela `delivery_pedidos`, com status próprio e pagamento Mercado Pago (pendente de cadastro). Ainda sem pedidos.
- Produção é registrada em levas (`producoes`, `producao_gastos`, `producao_itens`) para calcular o custo por litro.
- Fiscal: NFC-e via gateway, Simples Nacional, CFOP 5102, NCM 08119000.

## Capabilities and Constraints
- Site estático no GitHub Pages (`git push` publica) + Supabase (Postgres, RLS, Edge Functions). Sem build step; HTML com JS inline.
- Valores de status no banco são fixos (CHECK): `processando`, `enviado`, `entregue`, `cancelado`. Nomes na tela podem mudar sem migração.
- O estoque nunca fica negativo (CHECK `estoque >= 0`).
- Dados de produção: nunca emitir NFC-e real, registrar venda real ou fechar caixa real em teste.

## Brand Commitments
- Nome "Dupuro Açaí"; logo em `assets/img/`. Fala em português do Brasil, informal e direto ("você", "pra").
- Para o admin, o dono liberou mudar tudo, inclusive a aparência.

## Evidence on Hand
- Dados reais no banco: cerca de 1.000 vendas de balcão, 42 pedidos de revenda, 5 revendedores aprovados e 10 cadastros pendentes (o mais antigo de 83 dias).
- Avaliações Google exibidas na home.
- Nenhum pedido de delivery ainda. Não inventar números, depoimentos ou clientes.

## Product Principles
1. **O que precisa de você primeiro.** Toda tela operacional abre pela fila de ações, não pelo formulário de cadastro.
2. **Óbvio pra quem não montou.** Os nomes seguem o dia de trabalho, não as tabelas do banco.
3. **Estoque é sagrado.** Toda ação que mexe no estoque diz o que vai acontecer, confirma o resultado e permite desfazer.
4. **Celular e computador valem igual.** A ação principal fica sempre visível nos dois.
5. **Três canais, um lugar.** Atacado, balcão e delivery convivem com etiqueta de canal, sem telas duplicadas.
