// Fatos CONFIRMADOS (docs/assistente/base-de-fatos.md, v2 2026-11-19). Lactose e validade confirmadas pelo dono em 2026-11-20. O preço sugerido de venda do copo (R$ 17 a R$ 22) foi confirmado pelo Kayo em 2026-11-23.
// Conservação (freezer, evitar recongelar) confirmada pelo dono em 2026-11-20. O mínimo de R$ 20 do delivery foi confirmado em 2026-11-20 (hoje o mínimo do delivery vem do banco, não daqui).
// Preço, estoque, sabores do dia, taxa, turnos e mínimo do delivery, e preços do atacado vêm do banco (contextoBanco em index.ts); sem fato → a Puri diz que não tem confirmado e oferece uma pessoa. Fatos de 2026-11-21 confirmados pelo Kayo.
// Os fatos são divididos por assunto (FATOS_LISTA) para poderem ser editados no admin (tabela puri_fatos). FATOS continua sendo uma string só, com uma linha por assunto, na ordem da lista.
export const FATOS_LISTA: { assunto: string; titulo: string; texto: string; travado?: boolean; aviso?: string }[] = [
  {
    assunto: 'empresa',
    titulo: 'Empresa',
    texto: `Empresa: Dupuro Açaí, fábrica e distribuidora de açaí e cremes em Cuiabá-MT. Slogan: "Puro como tem que ser".`,
    aviso: `O slogan e a cidade também aparecem em outras páginas do site. Mudar aqui não muda lá.`,
  },
  {
    assunto: 'contato_endereco',
    titulo: 'Endereço e contatos',
    texto: `Endereço: Av. das Torres, nº 16, Jardim Imperial II, Cuiabá-MT, CEP 78076-001 (a mesma avenida também aparece como Av. Prof. Edna Maria Albuquerque Affi, nº 16). Não tem drive-thru.
WhatsApp: (65) 99288-8228. Também vende pelo iFood.
Instagram: @dupuroacai.`,
    travado: true,
    aviso: `O endereço, os telefones da fábrica e da loja e o Instagram também estão escritos nas respostas prontas e nas travas de segurança da Puri, e no texto que ela mostra no site. Mudar aqui não muda lá: peça para ajustar também.`,
  },
  {
    assunto: 'horario',
    titulo: 'Horário de funcionamento',
    texto: `Horário da loja/fábrica: segunda a sábado, das 13h às 19h30 (retirada e visita à fábrica nesse horário).
Domingo e feriado: a loja/fábrica e o delivery NÃO funcionam. Fora do horário da loja, o WhatsApp tem autoatendimento por chatbot.`,
    aviso: `O horário da fábrica (13h às 19h30) também está escrito nas respostas prontas da Puri no site. Se mudar, peça para ajustar lá também.`,
  },
  {
    assunto: 'avaliacao',
    titulo: 'Avaliação no Google',
    texto: `Avaliação no Google: 4,8 com 34 avaliações.`,
  },
  {
    assunto: 'produtos',
    titulo: 'Produtos e composição',
    texto: `Produtos: açaí e cremes em caixas; no momento os tamanhos são 500 ml, 1 L, 2 L, 5 L e 10 L. Cremes: Morango, Paçoca, Maracujá, Cupuaçu, Pistache, Ninho, Banana, Doce de Leite (a disponibilidade depende do estoque do dia). Granola Tia Sônia 1 kg: vendida pelo site (delivery) e na revenda.
Composição: o açaí contém água e açúcar (não é polpa pura).`,
  },
  {
    assunto: 'conservacao_validade',
    titulo: 'Conservação e validade',
    texto: `Conservação: guardar no freezer e evitar recongelar (descongelar e congelar de novo faz o açaí cristalizar).
Validade: 6 meses mantido congelado, sem recongelar (derreter e congelar de novo).`,
  },
  {
    assunto: 'leite_gluten',
    titulo: 'Leite, lactose e glúten',
    texto: `Leite e lactose: o açaí é 100% livre de leite (sem lactose); todos os cremes (Morango, Paçoca, Maracujá, Cupuaçu, Pistache, Ninho, Banana, Doce de Leite) têm leite na composição, portanto têm lactose.
Glúten: o açaí é sem glúten; os cremes têm glúten.`,
    travado: true,
  },
  {
    assunto: 'revenda',
    titulo: 'Revenda (atacado)',
    texto: `Revenda (atacado): pedido de atacado soma no mínimo 30 L, misturando caixas de 5 L e 10 L (ex.: 3 de 10 L ou 6 de 5 L). O primeiro pedido não tem mínimo. Não existe mínimo por produto no atacado: vale só a regra dos 30 L (granola e complementos não entram na conta). Os preços de atacado podem ser informados (estão no catálogo). Uma caixa de 10 L rende cerca de 20 copos de 500 ml; preço sugerido de venda do copo de 500 ml (para quem revende): R$ 17 a R$ 22.`,
    aviso: `O mínimo de 30 L e o primeiro pedido sem mínimo também estão escritos nas regras da Puri e nas mensagens do site. O preço sugerido do copo (R$ 17 a R$ 22) e a conta de 20 copos por caixa de 10 L também estão no simulador de revenda. Mudar aqui não muda lá.`,
  },
  {
    assunto: 'cadastro_painel',
    titulo: 'Cadastro de revendedor',
    texto: `Cadastro: o consumidor pode comprar na fábrica sem cadastro; só o revendedor precisa de cadastro. Cadastro de revendedor: cria conta com nome, negócio, telefone, e-mail, cidade e senha. A conta fica pendente até a equipe aprovar; só depois o painel libera. O pedido do revendedor vale na hora, sem confirmação do admin.
Painel do revendedor: acompanhar pedidos, histórico, status de entrega e cupons. A tabela completa de preços de atacado também aparece no painel depois do cadastro aprovado.`,
    aviso: `O fluxo de conta e aprovação também está escrito nas falas da Puri no site.`,
  },
  {
    assunto: 'pagamento',
    titulo: 'Formas de pagamento',
    texto: `Pagamento: pelo site (Pix ou cartão de crédito; revendedor: crédito em até 3x) ou na entrega/retirada (Pix, dinheiro com troco, débito, crédito). Pagamento a prazo só para revendedor liberado pela equipe.
Retirada na fábrica: aceita Pix, dinheiro, débito e crédito.`,
  },
  {
    assunto: 'entrega_delivery',
    titulo: 'Entrega e delivery',
    texto: `Entrega: somente em Cuiabá e Várzea Grande, em turnos de manhã (8h às 12h) e tarde (13h às 17h); dias, taxa e mínimo estão no catálogo. Não existe hora exata de chegada: o pedido chega dentro do turno escolhido. Fora disso não entregamos; dá pra retirar na fábrica. A taxa é calculada pelo endereço e aparece antes de pagar. A taxa de entrega do revendedor é a mesma do delivery.
Os cremes de 1 L, 2 L e 5 L também saem no delivery. Delivery (consumidor): pagamento online por Pix ou crédito; na entrega por dinheiro com troco, Pix, débito ou crédito. O pedido online só entra na rota depois do pagamento confirmado. Dá pra acompanhar a entrega por um link com as etapas (saiu, a caminho, entregue). O CEP é obrigatório e o endereço é confirmado no mapa; se o endereço não for aceito, chamar a equipe no WhatsApp.`,
    aviso: `Os turnos de entrega (manhã 8h às 12h, tarde 13h às 17h) também estão escritos nas respostas prontas e nos botões da Puri no site. Mudar aqui não muda lá.`,
  },
  {
    assunto: 'provar',
    titulo: 'Provar antes de comprar',
    texto: `Provar antes: opção 1, visitar a fábrica e provar (seg a sáb, 13h às 19h30). Opção 2, visita gratuita de um vendedor da equipe com amostras, só em Cuiabá e Várzea Grande, de segunda a sexta, das 8h às 17h.`,
    aviso: `O horário da visita do vendedor (segunda a sexta, 8h às 17h) e o da fábrica também estão escritos nas respostas prontas da Puri no site.`,
  },
  {
    assunto: 'loja_fisica',
    titulo: 'Loja física (balcão)',
    texto: `Loja física (balcão): copos de açaí (180 ml a 700 ml), marmitas e açaí por quilo são só da loja e não são vendidos pelo site. Na loja há self-service e também copo montado pela atendente. Para esses produtos, falar com a loja no WhatsApp (65) 9694-9542.`,
    aviso: `O WhatsApp da loja também está escrito nas regras da Puri. Mudar aqui não muda lá.`,
  },
  {
    assunto: 'festas',
    titulo: 'Festas e eventos',
    texto: `Festas e eventos: atendemos, mas precisa combinar com a equipe.`,
  },
  {
    assunto: 'sem_acucar',
    titulo: 'Opção sem açúcar',
    texto: `Sem açúcar: ainda não temos opção sem açúcar.`,
  },
  {
    assunto: 'o_que_vende',
    titulo: 'O que a Dupuro vende',
    texto: `A Dupuro vende SOMENTE: açaí e cremes em caixas e potes, granola Tia Sônia 1 kg, complementos e os demais produtos que aparecem no CATÁLOGO AO VIVO (pelo site e para revenda); e só na loja física também copos, marmitas e açaí por quilo. Não vende lanches, salgados, pizza, refeições, bebidas alcoólicas nem outros produtos fora disso.`,
  },
]

export const FATOS: string = FATOS_LISTA.map((f) => f.texto).join('\n')
