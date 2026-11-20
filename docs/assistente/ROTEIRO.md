# Assistente Dupuro — Roteiro e partitura (Etapa 1, aprovado com decisões de 2026-11-19)

Base: `PLANO.md` (decisões) e `base-de-fatos.md` (o que pode ser afirmado). Referência de comportamento/visual: `referencias/jev-maestros-formulario/ANALISE.md`.

## 0. Princípios
- Voz Dupuro: informal e direta ("você", "pra"), frases curtas, **uma pergunta por vez**, sem emoji, sem selo/eyebrow.
- Sempre há saída: chip **"Falar com uma pessoa"** (WhatsApp) em qualquer tela; **"Escrever do meu jeito"** e **"Pular"** nas perguntas abertas.
- **Nunca inventar**: preço, estoque, taxa e turnos vêm do banco; o resto só da base de fatos. Sem fato → passa pra uma pessoa.
- **Privacidade**: nome, telefone, e-mail e senha nunca vão ao Jev nem ao Haiku. Texto livre passa por um **mascarador** (troca telefone, e-mail, CPF/CNPJ por `[contato]` e **nome** — "meu nome é X", "sou o X", "aqui é X" — por `[nome]`) antes de qualquer chamada. A senha é digitada em campo mascarado, nunca vira balão e vai direto do navegador para o Supabase Auth (signUp) — nem a Edge do assistente a vê.
- Animações respeitam `prefers-reduced-motion` (exceção registrada ao design-system: o assistente tem movimento próprio).

## 1. Arquitetura do turno
- Navegador → Edge Function nova **`assistente`** (service_role, pública com token de conversa + rate_check):
  - `iniciar` → cria conversa (linha em `qualificacao_leads` ampliada) e devolve token.
  - `escutar` → chamado com debounce (~700 ms) enquanto a pessoa digita: Jev decide se já dá pra pré-gerar; se sim, Haiku já escreve anotações/cena. O Enter só "revela".
  - `turno` → mensagem enviada; devolve `{mensagens[], chips[], painel{}, cena{}, pixel{}, simulador{}, diagrama{}, proximo}`.
  - `visita` → registra pedido de visita do vendedor.
  - `catalogo` → preço/litros das caixas de atacado 5 L e 10 L e preço "a partir de" do delivery (para simulador e respostas).
  - `converter` → liga a conversa ao `profiles.id` após o signUp.
- **Limites**: 40 conversas/dia (global), 25 mensagens/conversa, rate_check por IP e por token. Passou → modo **roteiro fixo** (sem Jev/Haiku), cadastro continua funcionando.
- **Falhas**: Jev/Haiku com timeout (Jev 5 s, Haiku 8 s) ou erro → texto fixo de reserva da tela; nunca trava o fluxo; nunca "erro silencioso" sem fala.
- Modelo Jev: fixar versão (não `jev-latest`) depois de calibrado. Instruções ao Jev em inglês, dados em português, sempre com opção "other/none".

## 2. Partitura — perguntas do Jev (decide)
| id | tipo | pergunta (resumo) | uso / limiar |
|---|---|---|---|
| J1 intencao | choice | duvida · revender · consumir · provar · humano · outro | ≥ 0,6 segue; abaixo → chips de esclarecimento |
| J2 suficiente | noul | o texto já tem informação concreta suficiente pra rascunhar resposta/anotação? | ≥ 0,7 dispara Haiku em segundo plano |
| J3 respondivel | noul | a dúvida pode ser respondida só com os fatos fornecidos? | < 0,6 → "vou te passar pra uma pessoa" |
| J4 inventou | noul | o rascunho afirma algo que NÃO está nos fatos? | ≥ 0,5 → descarta, usa reserva + humano |
| J5 segmento | choice | delivery de açaí · açaiteria · lanchonete/bar · sorveteria · feira/evento · mercado/varejo · revenda em casa · outro | ordena os 3 chips sugeridos e escolhe a cena |
| J6 melhor_pergunta | choice | entre 3 perguntas do Haiku, qual aprofunda melhor sem repetir? | escolhe 1 |
| J7 palpite_inventa | noul | o palpite inventa algo não dito? | ≥ 0,5 → não mostra palpite |
| J8 rotulo_ruim | noul | os rótulos do diagrama estão vagos/errados? | ≥ 0,62 → refaz 1x; persistindo, diagrama simples só com o código |
| J9 coerente | noul | tipo de negócio × movimento × cidade fazem sentido juntos? | baixo → marca o lead (não bloqueia, não acusa) |
| J10 prioridade | score 0–3 | esforço + interesse + encaixe | ordena leads no admin |
| J11 humano | noul | a pessoa está pedindo/precisando de atendimento humano ou irritada? | ≥ 0,7 → oferece WhatsApp na hora |

## 3. Partitura — o que o Haiku escreve
Saída sempre **JSON estrito**, curta, temperatura baixa. Nunca recebe dados pessoais.
- **H1 resposta**: responde a dúvida em até 2 frases **só com os fatos** recebidos; se faltar fato, devolve `sem_fato`.
- **H2 anotações**: 2–4 tópicos de até 8 palavras do que a pessoa escreveu ("O que já anotamos").
- **H3 perguntas**: 3 candidatas de aprofundamento (com 3–4 respostas rápidas cada).
- **H4 palpite**: "Meu palpite: … Acertei?" sobre a causa do problema.
- **H5 resumo**: 1 frase "O que ficou do que você contou" + nome curto do problema em pílula.
- **H6 diagrama**: nós e ligações (empresa → problema → causa/autonomia → onde quer chegar → primeiro passo).
- **H7 ajuste**: refaz o diagrama com o pedido de ajuste.

## 4. Fluxos tela a tela
### F0 — Abertura
Botão flutuante (no lugar do WhatsApp) → painel abre. Fala fixa: "Oi! Eu sou a Puri, assistente da Dupuro. Posso tirar uma dúvida ou te ajudar a começar." Chips: **Quero revender** · **Comprar pra consumir** · **Quero provar antes** · **Tirar uma dúvida**. Campo livre → J1 (+ J11).
O botão flutuante mostra o nome **Puri** (ex.: tooltip/rótulo "Fala com a Puri").
Botões "Seja revendedor" do site abrem direto em F4.

### F1 — Dúvida
Pergunta → mascarador → J3 → H1 (com o trecho certo da base + dados do banco quando for preço/entrega) → J4 → resposta + chips do contexto (ex.: "Ver o delivery", "Quero revender", "Falar com uma pessoa"). Sem fato → humano. Pergunta de saúde → resposta fixa (procure pediatra/nutricionista) + humano.

### F2 — Comprar pra consumir
Fixo + dados ao vivo: "Pra consumir em casa é pelo nosso delivery: caixas a partir de R$ X, entrega em Cuiabá e Várzea Grande, pedido mínimo R$ 20 [conferir se o sistema já aplica]." Chip **Abrir o delivery** (`/delivery/`; se citou produto → `pedido.html?p=ID`). Chips extra: "Como funciona a entrega?" (F1), "Na verdade quero revender" (F4).

### F3 — Quero provar antes
Chips **Visitar a fábrica** · **Receber um vendedor com amostras**.
- Fábrica: endereço, horário (seg–sáb 13h–19h30), link do mapa. Fim com "Quando quiser revender, é só chamar aqui" (chip F4).
- Vendedor: cidade (Cuiabá/VG — normalizada sem acento; fora → "a visita é só em Cuiabá e Várzea Grande", oferece fábrica) → bairro → melhor dia/período (seg–sex, 8h–17h, manhã/tarde) → nome → telefone → confirma resumo → `visita` grava → "Pronto! Nosso vendedor vai te chamar pra combinar." Aviso: pendência no admin (o WhatsApp automático está desligado — ver §7).

### F4 — Quero revender (fluxo principal, com os momentos visuais)
1. **Tipo de negócio** — chips (3 sugeridos pelo J5 a partir do texto, se houver) + livre. → **cena neon** começa a se montar (base do segmento).
2. **Cidade e bairro** — código normaliza; fora de Cuiabá/VG → explica (entrega só lá, retirada na fábrica) e segue.
3. **O que você quer com a revenda?** (livre) — escuta ao vivo: J2 → H2 (anotações) + elementos da cena; Enter revela na hora.
4. **Movimento** — "Quantos copos você imagina vender por dia?" chips (até 20 · 20–50 · 50–100 · 100+) → **pixel art em escala real** (clientes por dia; neon pixeliza → explode → remonta; contador sobe).
5. **Simulador "quanto rende 1 caixa"** — 1 caixa de 10 L ≈ 20 copos de 500 ml; preço de venda ajustável (R$ 18–20, padrão R$ 18); custo = preço real da caixa (banco) → mostra venda, custo e sobra por caixa e por semana (pelo movimento do passo 4). Tudo código.
6. **Aprofundamento** — H3 gera 3 → J6 escolhe 1 → mostra com respostas rápidas + "Escrever do meu jeito" + "Pular".
7. **Palpite** — H4 → J7 → "Na mosca / Em parte / Não, é outra coisa" (correção livre).
8. **O especialista + resumo** — H5 ("O que ficou do que você contou" + pílula do problema).
9. **Mapa do caso** — H6 → J8 → diagrama se monta nó a nó → "Está certo" / "Quero ajustar" (H7 → J8; até 2 ajustes; nós novos com "Ajustado").
10. **Regras** (fixo + banco): mínimo 30 L por pedido (soma de caixas de 5 e 10 L; granola e complementos não contam), **primeiro pedido sem mínimo**; pague como preferir (site ou entrega); entrega em Cuiabá/VG.
11. **Conta** — nome → telefone (WhatsApp) → e-mail → senha (mascarada, com confirmação) → aceite de avisos no WhatsApp → **signUp no navegador** → `converter`.
   - E-mail já existe → "Você já tem conta" + link "Entrar" e "Esqueci a senha".
   - Sucesso → "Conta criada! Ela fica pendente até o time aprovar; a gente te avisa." + resumo final + chips "Ver o painel" (login) / "Falar com uma pessoa".
   - J10 grava a prioridade do lead.

### F5 — Falar com uma pessoa
Qualquer tela: abre `wa.me/5565992888228` com texto pronto curto ("Oi! Vim do assistente do site: [intenção] — [resumo sem dados pessoais]").

### F6 — Limites e falhas
Edge fora / limite diário → roteiro fixo (mesmas telas, falas fixas, sem anotações/palpite/diagrama gerados; cena, pixel e simulador continuam por código). 25 mensagens → "Pra seguir, melhor com uma pessoa" + WhatsApp.

## 5. Resumo ao vivo (coluna/aba "Seu caso")
Negócio · Cidade/bairro · O que quer (resumo H5) · Movimento · Simulação (sobra/semana) · Etapa. Mobile: aba recolhível no topo do painel.

## 6. Movimento (base, medido na referência)
"•••" 0,3–1 s · balão entra com fade ~150 ms · campo vira balão em 1–2 quadros · rolagem suave ~300 ms · cena neon desenha em ~2,5 s (traço se desenhando, esquerda→direita, cards um a um) · pixel art ~2,5 s · diagrama ~1,1 s (setas-esqueleto primeiro, nós com ~100 ms de intervalo) · painel do assistente abre/fecha com escala+fade ~200 ms.

## 7. Dados e admin
- `qualificacao_leads` ganha: `fluxo`, `resumo`, `mapa jsonb`, `prioridade smallint`, `coerente boolean`, `visita_status` (`pedida`/`agendada`/`feita`/`cancelada`), `visita_cidade`, `visita_bairro`, `visita_periodo`, `simulacao jsonb`. Status ganha valores novos se preciso.
- **Aviso de visita**: como o WhatsApp automático está desligado, a visita aparece como **pendência no admin** (Início + seção nova "Leads do assistente" em Cadastros), com botão manual "Avisar vendedor" (wa.me). Se o automático voltar, liga também o `wa_aviso_interno`.
- Tela de leads no admin (Etapa 6): lista por prioridade, resumo, mapa, visita.

## 8. Decisões pendentes (Kayo)
1. Aviso da visita: pendência no admin + botão manual 'Avisar vendedor' — **nome/WhatsApp do vendedor: o Kayo informa depois**.

Decididos em 2026-11-19: nome do assistente **Puri**; faixas de movimento aprovadas (até 20 · 20–50 · 50–100 · 100+); preço padrão do simulador **R$ 18**.
