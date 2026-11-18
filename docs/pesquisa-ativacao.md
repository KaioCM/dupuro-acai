# Pesquisa de ativação — 19 aprovados sem pedido

Objetivo: descobrir POR QUE quem foi aprovado nunca fez o primeiro pedido (win/loss de não-compra). Não é satisfação.

## Regras da abordagem

- **Quem**: pessoa neutra (não o vendedor da conta), idealmente o Kayo com o WhatsApp da loja (65 99288-8228).
- **Formato**: 1 pergunta por mensagem, assíncrona, sem agendar. ~90 s de esforço do revendedor.
- **Volume**: os 26 aprovados menos os 7 que já pediram = 19. Meta: 12-15 respostas estabilizam padrões; 20-30 é defensável.
- **Convites por trimestre** por pessoa: 1.

## Roteiro (copiar/colar)

### 1. Convite

> "Oi, [nome]! Aqui é a Dupuro Açaí. Você criou seu cadastro de revendedor com a gente e a gente queria melhorar o painel — pode me responder 4 perguntinhas por aqui mesmo, no seu tempo? Respondendo, você ganha 10% de desconto no seu primeiro pedido. (Se preferir não participar, é só responder SAIR.)"

LGPD embutida: finalidade (melhorar o painel), controlador (Dupuro), forma (WhatsApp, texto), direitos/resposta "SAIR". Retenção: respostas vivem 18 meses, depois anonimiza.

### 2. Perguntas

| # | Pergunta |
|---|----------|
| 2 | O que te fez parar antes do primeiro pedido? |
| 3 | O que faltou ficar claro no painel? |
| 4 | O mínimo de 1 caixa de 10 L e o preço cabem no seu negócio hoje? |
| 5 | O que te faria pedir ainda esta semana? |
| 6 | (aberta) Alguma outra coisa que a gente deveria saber? |

- Nunca condicionar o cupom à nota/conteúdo da resposta. Cupom: admin gera `pct 10` com origem `pesquisa-ativacao` (coluna `origem` existe desde a migração 065).
- Se **SAIR**: registrar opt-out na planilha e não abordar de novo por 12 meses.

## Registro

- Planilha/aba `pesquisa_ativacao` temporária OU via RPC `pesquisa_registrar(canal='ativacao', ref=<telefone>, nota=null, texto=<resumo>)` pelo admin (a partir do lote backend).
- Depois de 10 respostas: rodar o analisador Jev (lote admin) com taxonomia calibrada por rótulo manual em 20 linhas.

## Taxonomia inicial de objeções (para o Jev `pick`)

- 2026-11-18: mineração das 26 conversas WhatsApp (docs/achados-mining-whatsapp.md) calibrou a taxonomia; o kit das 19 continua válido e a lista P0 contém 8 cadastrados desta amostra.

| Rótulo | Significado |
|---|---|
| `preco_minimo` | Preço/mínimo de 10 L não cabe |
| `duvida_operacional` | Não entendeu como pedir/receber |
| `confianca` | Quer ver/testar antes (produto, entrega) |
| `concorrente` | Já compra de outro fornecedor |
| `sem_demanda` | Negócio não decolou/mudou |
| `outro` | Sempre presente; humano revisa quando confiança baixa (< 0,6) |

## O que não fazer

- Não usar NPS com quem nunca comprou.
- Não mandar as 5 perguntas de uma vez (parece formulário, derruba resposta).
- Não cobrar pedido na mensagem de convite (mata a honestidade da resposta).
