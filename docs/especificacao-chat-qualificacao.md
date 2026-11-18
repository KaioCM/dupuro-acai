# Spec — Chat de qualificação de leads da revenda (P3)

Status do produto: chat substitui o formulário de revenda (decisão Kayo, 2026-11-18); gates de construção abaixo permanecem.
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

### Front (decisão do dono — 2026-11-18)
O chat É a porta da seção #revenda: substitui o formulário estático atual (`revenda/index.html:346`), não roda ao lado dele (duas portas para o mesmo cadastro dividem conversão). O formulário não desaparece — vira ETAPA do fluxo: tela final com campos pré-preenchidos pelas respostas do chat (nome, empresa, telefone, cidade, e-mail), reutilizando o signup existente (`main.js:117-150` → `cliente.js:25`) sem criar caminho de cadastro paralelo.
- Fallback: se o chat falhar/carregar lento, a página ainda precisa permitir cadastro direto (link 'pular e preencher manualmente' → formulário atual, escondido por padrão).
- Quem o chat qualifica como 'sem intenção' roteia para WhatsApp/fechamento gentil SEM chegar ao signup.

## Pré-condições para construir (gate)

1. **P0 concluído** (19 conversas) → taxonomia de objeções real, não adivinhada.
2. **P2 pipeline de rótulos** rodando nos CSATs → o mesmo `pick` genérico serve ao chat.
3. **Tráfego**: a página de revenda ter visitas suficientes (hoje: sem analytics — medir antes de automatizar).

## Anti-padrões

- Não manter form + chat como duas portas paralelas para o mesmo cadastro (decisão do dono acima).
- Jev não responde cliente (não gera texto).
- Diagramas/visuais = render de dados estruturados, nunca geração de imagem.
- Sem chatbot de atendimento geral (escopo creep).
