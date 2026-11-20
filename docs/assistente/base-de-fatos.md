# Base de fatos do assistente — v2 (2026-11-19, respostas do Kayo incorporadas)

Restam **[CONFIRMAR]**: lactose, validade.

Fonte única do que o Haiku pode afirmar. Tudo marcado **[CONFIRMAR]** depende do Kayo. Preço, estoque, sabores disponíveis, taxa de entrega e turnos **não ficam aqui**: são lidos do banco na hora (`products`, `product_flavor_stock`, `delivery_catalogo()`, `delivery_config`).

## Empresa
- Dupuro Açaí — fábrica e distribuidora de açaí e cremes em Cuiabá-MT. "Puro como tem que ser".
- Endereço: Av. das Torres, nº 16, Jardim Imperial II, Cuiabá-MT, 78076-001. Não tem drive-thru.
- WhatsApp: (65) 99288-8228. (O número (65) 99694-9542 que aparece em fotos antigas NÃO é mais usado.)
- Também vende pelo iFood.
- Horário: Loja/fábrica: segunda a sábado, 13h às 19h30 (retirada e visita à fábrica nesse horário).
- Google: 4,8 com 34 avaliações (conferido pelo Kayo em 2026-11-19). O perfil no Google ainda mostra o telefone antigo (65) 99694-9542 e não tem o site cadastrado — o Kayo vai corrigir.

## Produtos
- Açaí e cremes em caixas; tamanhos do catálogo vêm do banco (no código existem 500 ml, 1 L, 2 L, 5 L, 10 L).
- Cremes: Morango, Paçoca, Maracujá, Cupuaçu, Pistache, Ninho, Banana, Doce de Leite. Disponibilidade = estoque do dia.
- Granola e complementos: itens avulsos.
- Composição: o açaí **contém água e açúcar** (não é polpa pura). Lactose: **[CONFIRMAR]**. Armazenar em **freezer ou congelador**; **evitar recongelar** (descongelar e congelar de novo faz o açaí cristalizar). Validade: **[CONFIRMAR]**.
- Site corrigido em 2026-11-19: removidas as afirmações '100% puro/pura'.
- Pergunta de saúde (ex.: "pode dar pra bebê?"): o assistente não orienta, sugere falar com pediatra/nutricionista e oferece o WhatsApp.

## Revenda (atacado)
- **Regra nova (vigente quando a tarefa da regra for publicada)**: pedido de atacado precisa somar **no mínimo 30 L**, misturando caixas de 5 L e 10 L (ex.: 3 de 10 L, ou 6 de 5 L). **Primeiro pedido: sem mínimo**, qualquer quantidade de produtos de 5 L e 10 L.
- Rendimento: 1 caixa de 10 L ≈ 20 copos de 500 ml (conta de volume; com complementos rende um pouco mais). Preço sugerido de venda: R$ 18–20 o copo de 500 ml → R$ 360–400 por caixa de 10 L.
- Cadastro: cria conta (nome, negócio, telefone, e-mail, cidade, senha ≥ 6). Fica **pendente** até o time Dupuro aprovar; só então o painel libera.
- Pedido do revendedor vale na hora (sem confirmação do admin).
- Pagamento: Pode pagar como preferir: pelo site (Pix ou crédito até 3x) ou na entrega/retirada (Pix, dinheiro com troco, débito, crédito). A prazo só para revendedor liberado pelo admin.
- Entrega: **somente em Cuiabá e Várzea Grande** (até 30 km), turnos manhã/tarde. Fora disso não entregamos — retirada na fábrica.
- Taxa de entrega do revendedor: mesma conta do delivery, calculada pelo endereço.
- Margem "passa de 2x": **não usar** (sem fonte). O simulador calcula com o preço real.

## Provar antes (amostra)
- Opção 1: visitar a fábrica e provar (horário da loja: seg–sáb 13h–19h30).
- Opção 2: Visita de um **vendedor da equipe** com amostras, **gratuita**, só em **Cuiabá e Várzea Grande**, seg–sex 8h–17h. Gera aviso interno ao Kayo.

## Delivery (consumidor)
- Cuiabá e Várzea Grande, até 30 km. Taxa calculada pelo endereço (valores lidos do banco), aparece antes de pagar.
- Turnos seg–sáb: manhã 8h–12h (pedido até 7h) e tarde 13h–17h (pedido até 11h). Datas bloqueadas e limite por turno vêm da configuração.
- Pagamento online: Pix ou crédito (Mercado Pago). Na entrega: dinheiro com troco, Pix, débito, crédito. Pedido online só entra na rota depois do pagamento confirmado.
- Acompanhamento por link com etapas (saiu / a caminho / entregue).
- CEP obrigatório e confirmação no mapa. Se o endereço não for aceito → oferecer WhatsApp.
- Pedido mínimo do consumidor (delivery, pelo site): **R$ 20** em produtos, sem contar a taxa de entrega. Confirmado e aplicado em 2026-11-20 (Edge `delivery-checkout` v18).

## Dúvidas reais mais comuns (WhatsApp)
Revender: valor para revender · preço dos baldes de 5 e 10 L · tem pedido mínimo? · entregam em Várzea Grande / Parque do Lago / no MT todo? · como testar antes de comprar? · manda amostra pelo motoboy? · quero consumir e, se gostar, revendo · faz um orçamento? · estão sem estoque? · quero 2 ou 3 caixas (fornecedor sem produto) · quero começar com pouco · tem os cremes / lista de preços? · posso pagar depois / na entrega?
Consumir: é puro, sem água nem açúcar? pode dar pra bebê? · tem sem lactose? · validade e como guardar · até onde entregam, quanto custa, que horas chega, como pagar, dá pra acompanhar?
Outros: horário de funcionamento · o site não aceita meu endereço · não entendi como pedir/receber.

## Pendências de texto no site (para a tarefa da regra nova) — RESOLVIDA em 2026-11-19 (index.html, revenda/index.html, CLAUDE.md e docs atualizados com a regra de 30 L; o texto abaixo é o registro da pendência)
Lista completa dos lugares com "a partir de 1 caixa"/"50 L dispensam" no relatório da Etapa 0 (index.html, revenda/index.html, admin.html, dashboard.html, cliente.js, admin.js, migrações/funções do banco, CLAUDE.md, docs/revenda.md, docs/roteiro-chat-p3.md, docs/pesquisa-ativacao.md). Conflito já existente: revenda/index.html:147 ("1 caixa / 50 L") × :255 ("primeiro pedido sem mínimo").
