# Roteiro P3 — chat de qualificação da revenda (v1, calibrado nos achados 2026-11-18)

Regras: sem LLM generativo (falas fixas; Jev só classifica turno a turno), o chat É a porta da seção #revenda (decisão do dono), form vira etapa final pré-preenchida, fallback "pular e preencher" sempre visível. Classificador por turno: pick(objeção) + score(interesse 0–3) com as 3 zonas de confiança (≥0,85 segue auto; cinzenta pergunta de esclarecimento fixa; <0,60 humaniza — botão "falar com humano" leva ao WhatsApp).

**N0 — Abertura (1 pergunta, sem formulário)**
"Fala! Aqui é a Dupuro Açaí, fábrica em Cuiabá. Em 1 minuto eu te digo se a revenda cabe no seu negócio. Como você está chegando?"
[Quero revender] · [Comprar pra consumir] · [Só dando uma olhada]

**B-Varejo** — "Fechado! Varejo a gente entrega direto na sua casa — catálogo completo aqui: dupuroacai.com/delivery. Retirada: Av. das Torres, 16, Jd. Imperial II."
(fecha com selo `varejo`; sem pitch de revenda — achado 1)

**B-Olhando** — "Sem problema. Se a ideia virar negociozinho com açaí, a gente monta condição; o primeiro pedido é sem mínimo. Te chamo quando quiser?" [Quero revender agora] [Ver catálogo varejo]

**R1 — Negócio** — "Show. Que tipo de negócio é (ou vai ser)? Delivery de açaí, açaiteria, lanchonete, feira… me diz do seu jeito." → Jev segmenta (padrão `sugerir-fiscal`, reuso de critério já vivo).

**R2 — Cidade/bairro** — "Onde vocês ficam?" → regra fixa: Cuiabá/VG = rota de entrega; outra cidade MT = "Atendemos fora com caixa fechada e transporte a combinar — me deixa anotado como expansão" + selo `expansão` (achado 4).

**R3 — Pitch por segmento (3 variantes fixas)** — estrutura: rendimento (caixa 10 L ≈ X copos), preço por litro, margem 2×+, "primeiro pedido sem mínimo". Nºs lidos da tabela de produtos do admin no runtime — nunca hardcoded.

**R4 — Ramo de objeção (dispara pelo classificador, uma fala fixa cada)**
- preco/margem: faz a conta na tela (custo/L → copo → lucro), nunca "depende".
- minimo: "Primeiro pedido sem mínimo. Depois, pedidos a partir de 30 L (3 caixas de 10 L ou 6 de 5 L)" (regra real do revenda).
- amostra: **[DECISÃO ABERTA DO DONO — 3 opções no doc: (a) pote-teste pago que vira crédito no 1º pedido; (b) amostra grátis só na 1ª entrega de teste em VG/Cba; (c) degustação no endereço da loja. Escolher antes do nó ir ao ar.]**
Status: transitória (c) implementada no MVP; política final aguarda time.
- pagamento/confiança: "a partir do 2º pedido você paga como quiser; o 1º pode ser com entrega" (regra real).

**R5 — Fechamento** — "Já deixei teu cadastro meio pronto: [negócio], [telefone], [bairro]. Confere e completa em 2 minutos." → abre form atual PRÉ-PREENCHIDO (signup existente, caminho único; fallback manual sempre visível).

**R6 — Morno que não fechou** — "Sem pressão. Quando quiser começar, retomo daqui — o primeiro pedido é sem mínimo." → marca follow-up humano de 7 dias no painel. **Nunca terminar com "fico no aguardo" órfão** (achado 5).

**Painel lateral (estilo vídeo)** — monta em tempo real a partir dos campos estruturados: segmento | cidade | interesse 0–3 | status (varejo/expansão/potencial/pronto-cadastro). Visual = dados, não texto gerado.

**Anti-padrões**: nada de "posso te chamar de?" antes de utilidade; zero emoji em botão; perguntas uma por vez; toda fala com próximo passo concreto; o chat não repete o bot atual (link + abandono — documentado no achado das conversas +33).
