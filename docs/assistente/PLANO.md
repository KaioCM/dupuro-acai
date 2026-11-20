# Assistente Dupuro (chat LLM + Jev) — plano

Decidido com o Kayo em 2026-11-19. Referência visual/arquitetural: `referencias/jev-maestros-formulario/ANALISE.md` (fora do repo). Substitui o protótipo `revenda-chat.js` (v1 ainda publicado; diff local descartado).

## O que é
Botão flutuante no canto inferior direito, **no lugar do botão do WhatsApp**, nas páginas **home, revenda e delivery** (nunca área do cliente, caixa ou admin). Abre um assistente que:
1. tira dúvidas básicas (só com a base de fatos; se não souber → "falar com uma pessoa" no WhatsApp);
2. **revendedor sério** → qualifica e **cria a conta dentro da conversa** (e-mail e senha no chat);
3. **quer consumir** → encaminha para o delivery;
4. **quer provar** → visita à fábrica **ou** visita de um vendedor com amostras (seg–sex, 8h–17h) → aviso interno ao Kayo (nunca à Dilene).
Os botões "Seja revendedor" do site abrem o assistente direto no fluxo de cadastro. O formulário antigo fica como reserva se o assistente falhar. Nome do assistente: **Puri**.

## Camadas
- **Código**: roteiro/estado de cada fluxo, validações, telas, números. Preço e estoque sempre do banco, nunca do LLM.
- **Jev (decide)**: intenção (dúvida/revender/consumir/provar/humano), "escuta enquanto digita" (já dá pra mandar ao Haiku?), juiz do que o Haiku escreve (pergunta, palpite, rótulos), coerência das respostas, esforço/prioridade do lead, quando passar pra humano.
- **Haiku (escreve)**: respostas de dúvida ancoradas na base de fatos, perguntas de aprofundamento, palpites, resumo do caso, rótulos do diagrama.
- **Privacidade**: nome, telefone, e-mail e senha nunca vão ao Jev nem ao Haiku. Senha mascarada, nunca vira balão.
- Sem "descoberta"/confirmação de CNPJ (muitos revendedores não têm CNPJ).

## Momentos visuais (identidade Dupuro: roxo, dourado, Klinko)
Resumo ao vivo do revendedor · cena neon do ponto de venda montada com as respostas · pixel art "em escala real" · simulador "quanto rende 1 caixa" (10 L = 20 copos de 500 ml; preço sugerido R$ 18–20/copo → R$ 360–400 por caixa; margem pelo preço real da caixa no banco) · diagrama do caso que se monta nó a nó e se refaz em ajustes. Animações de base: "•••", entrada de balões, campo que vira balão, rolagem suave, abrir/fechar do painel; respeitar prefers-reduced-motion.

## Custos e limites
Haiku via **API da Anthropic** (cobrança separada da assinatura Pro). Limite sugerido no console: **US$ 4–5/mês**. No app: **40 conversas/dia** e **25 mensagens/conversa**; passou disso → textos fixos + WhatsApp. Estimativa: ~R$ 0,04 por conversa completa de cadastro (Haiku 5.5 ~US$ 0,10/M entrada, 0,50/M saída — conferir na página oficial). Ação do Kayo antes da Etapa 2: criar a chave, pôr crédito e definir o limite.

## Etapas (cada uma só começa com ok do Kayo)
0. **Fatos e limpeza** — base de fatos (`base-de-fatos.md`) conferida pelo Kayo; diff local do protótipo descartado (feito); memória.
1. **Roteiro e partitura** — cada fluxo tela a tela; para cada tela o que faz código / Jev (pergunta e limiar) / Haiku (prompt) e o que acontece se falhar. Sem código. — **feito** (ROTEIRO.md, aprovado 2026-11-19)
2. **Bastidores** — Edge Function nova do assistente (Jev + Haiku, limites, timeouts, respostas fixas de reserva), migração ampliando `qualificacao_leads` (fluxo, resumo, mapa, prioridade, visita), aviso interno de visita, testes direto na função.
3. **Casca** — botão flutuante, painel (desktop expande no cadastro; mobile tela cheia), motor do chat e animações de base, "falar com uma pessoa". Modo dúvidas funcionando de ponta a ponta.
4. **Fluxos** — cadastro com conta criada no chat; consumir → delivery; provar → fábrica ou vendedor; resumo ao vivo; botões "Seja revendedor" abrindo o fluxo.
5. **Momentos visuais** — cena neon, pixel art, simulador, diagrama.
6. **Fechamento** — tela de leads no admin, docs, teste real (celular e computador), publicação.

## Dependência
A **nova regra de pedido mínimo** (tarefa separada, antes de o assistente ir ao ar): ver `base-de-fatos.md` §Revenda e a memória `dupuro-regra-minimo-30l`.

Acesso ao banco: liberado em 2026-11-19 — executor/pesquisador/revisor herdam as ferramentas MCP do Supabase (pesquisador e revisor só leitura).
