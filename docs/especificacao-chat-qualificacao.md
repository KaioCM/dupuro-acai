# Spec — Chat de qualificação de leads da revenda (P3)

Status (2026-11-18): DECISÃO DO DONO — o chat de qualificação VAI substituir o formulário de cadastro da revenda. Ainda NÃO construído (P3 em fila); a construção usa o desenho "Front" abaixo. Gates de aprendizado (P0) refinam as perguntas, não reabrem a decisão.
Blueprint: vídeo "JEV: Fazer dinheiro com IA..." (Maestros da IA, 2026-10) — formulário-chat com Jev como roteador em tempo real. Não é atendimento: qualifica quem chega na página de revenda e roteia (demo/agendamento/vendedor/autosserviço).

## Arquitetura (6 passos por turno)

1. **Código**: estado da conversa, pergunta seguinte (máquina de estados simples, 5-7 nós).
2. **Jev** (sempre, <1 s): `pick` segmento pelo nome da empresa; `pick` intenção; `score` urgência/fit; `yes` coerência resposta×estado (barra inventada).
3. **Roteamento por confiança**: >= 0,85 segue automático; 0,60-0,85 LLM faz 1 pergunta de esclarecimento; < 0,60 humano.
4. **LLM**: redige SOMENTE a próxima frase, condicionada ao estado estruturado (nunca decide).
5. **Código**: painel "o que entendemos de você" renderiza ao vivo os campos estruturados (dados, não geração).
6. **Fim**: lead qualificado → agenda (link) / vendedor (WhatsApp) / cadastro direto com pré-preenchimento.

## Implementação Dupuro

### Edge Function

Nome: `qualificar-turno`. Padrão delivery-checkout (anon). Rate check por IP + telefone. Secrets: `TYPESAFE_API_KEY` + provider LLM a definir.

### Banco

Tabela `qualificacao_leads`:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid / bigserial | PK |
| `telefone_hash` | text | SHA-256 do telefone |
| `estado` | jsonb | Máquina de estados completa |
| `segmento` | text | Classe do Jev (`pick`) |
| `intenção` | text | Intent detectada |
| `fit` | float | Score de encaixe |
| `criado_em` | timestamptz | Timestamp |

NUNCA em `norte_leads` (banco compartilhado, projeto do outro produto).

## Front (desenho aprovado — chat substitui o formulário)
- O chat é a porta única da seção #revenda; o formulário atual (`revenda/index.html:346`) vira ETAPA FINAL do fluxo, pré-preenchida pelas respostas (nome, empresa, telefone, cidade, e-mail) — reutilizando o signup existente (`main.js:117-150` → `cliente.js:25`), sem caminho paralelo de cadastro.
- Fallback obrigatório: link 'pular e preencher manualmente' abre o formulário atual para quem rejeita conversa.
- Lead sem intenção: o chat encerra com gentileza e roteia para WhatsApp — não chega ao signup.
- MVP SEM LLM: as falas do chat são roteiro fixo (copy escrita, 5-7 nós); o Jev faz o que sabe (segmento pelo nome, intenção, coerência, roteamento por confiança). LLM generativo nas falas é polimento futuro, não pré-requisito.

## Inputs do roteiro (2026-11-18)
A mineração das 26 conversas reais (docs/achados-mining-whatsapp.md) calibrou a taxonomia do classificador e o roteiro (docs/roteiro-chat-p3.md). Gate de construção restante: decisão do dono sobre a política de amostra (R4).

## Pré-condições para construir (gate)

1. **P0 concluído** (19 conversas) → taxonomia de objeções real, não adivinhada.
2. **P2 pipeline de rótulos** rodando nos CSATs → o mesmo `pick` genérico serve ao chat.
3. **Tráfego**: a página de revenda ter visitas suficientes (hoje: sem analytics — medir antes de automatizar).

## Anti-padrões

- Reabrir como dúvida o que o dono já decidiu; registrar como decisão o que ainda é pergunta (os dois erros ocorreram 2026-11-18 — ver histórico de commits).
- Jev não responde cliente (não gera texto).
- Diagramas/visuais = render de dados estruturados, nunca geração de imagem.
- Sem chatbot de atendimento geral (escopo creep).
