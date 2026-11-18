# Spec — Chat de qualificação de leads da revenda (P3)

Status real (2026-11-18): o chat NÃO existe; o formulário de cadastro da revenda é e continua sendo a porta de entrada viva. Chat é proposta P3 gated nos achados do P0. A relação chat↔form (substituir / virar etapa / não construir) é DECISÃO ABERTA para a época da construção.
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

## Front (questão aberta — não decidir antes do P0)
Três caminhos legítimos, a escolher quando o P3 entrar em construção, com os achados das 19 conversas na mesa:
a) chat substitui o formulário (form vira etapa pré-preenchida do fluxo; risco: trocar um funil que já converteu 7 por um ineditado);
b) chat como camada de qualificação ANTES do form (form intocado; chat só roteia/qualifica);
c) não construir chat — o P0 mostrou que as objeções se resolvem com conteúdo/preço, não com conversa (resultado perfeitamente válido).
Qualquer que for o escolhido: nunca duas portas paralelas de cadastro sem hierarquia clara (dividem conversão). Fallback de cadastro direto é obrigatório em a) e b).

## Pré-condições para construir (gate)

1. **P0 concluído** (19 conversas) → taxonomia de objeções real, não adivinhada.
2. **P2 pipeline de rótulos** rodando nos CSATs → o mesmo `pick` genérico serve ao chat.
3. **Tráfego**: a página de revenda ter visitas suficientes (hoje: sem analytics — medir antes de automatizar).

## Anti-padrões

- Decidir chat-vs-form antes dos achados do P0 — ou registrar como decisão o que ainda é hipótese.
- Jev não responde cliente (não gera texto).
- Diagramas/visuais = render de dados estruturados, nunca geração de imagem.
- Sem chatbot de atendimento geral (escopo creep).
