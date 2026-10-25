---
name: analise-de-prompt
description: Regra do projeto — toda mensagem do Kayo passa pelo Jev como "analista de prompt" (hook UserPromptSubmit em .claude/settings.json → tools/jev-prompt). Explica como ler o resumo "[Analista de prompt — Jev]" que chega no contexto e como responder a ele. Use quando esse resumo aparecer, ou pra ajustar/desligar a análise.
---

# Analista de prompt (Jev)

Pedido do Kayo (2026-10-25): cada mensagem dele é analisada pelo Jev antes do Claude
trabalhar, pra melhorar a qualidade das instruções com o tempo.

## Como funciona

- `.claude/settings.json` → hook **UserPromptSubmit** → `python3 tools/jev-prompt`.
- O script manda pro Jev, num request só (~1–2k tokens, ~US$ 0,0001): a mensagem, o fim
  da última resposta do Claude (pra "sim"/"faz tudo" serem lidos no contexto) e uma linha
  sobre o projeto. Perguntas: tipo (Choice), clareza do objetivo (Score 0–2) e 6 Nouls —
  critério de pronto, ambiguidade, falta de informação, várias tarefas, ação irreversível,
  conflito.
- Volta como `additionalContext`: `[Analista de prompt — Jev] tipo … · objetivo x/2 · … Alertas: …`.
- Nunca bloqueia: sem `TYPESAFE_API_KEY`, sem rede ou com erro, não injeta nada.
- Mensagens que começam com `/` (comandos) não são analisadas.

## O que o Claude faz com o resumo (revisado 2026-10-25, depois do criativo reprovado)

O Kayo quer **decidir junto**, não receber trabalho pronto feito em cima de suposições.
Ele prefere gastar tokens montando contexto a gastar refazendo.

1. **Mostre a análise inteira**: cada pergunta do Jev com o número e o que significa
   (o Jev não dá raciocínio, só números — a leitura é sua, deixe claro o que é dele e o que é seu).
2. **Nunca descarte um alerta sozinho.** Se achar que o Jev errou, diga por quê e pergunte.
   Erro de 2026-10-25: o pedido "quero um criativo pra anúncio" veio com objetivo 0,9/2, falta
   info 0,85 — o Claude fez 4 perguntas de múltipla escolha e decidiu o resto (estilo, mensagem,
   fotos, Canva) sozinho. Resultado reprovado.
3. **Pedido vago (objetivo < 1,2, falta info > 0,6, ambíguo > 0,6 ou sem critério de pronto)
   = não executar ainda.** Montar o contexto junto: perguntas abertas sobre intenção, público,
   o que a pessoa deve sentir/fazer, estilo e referências, o que não pode ter, critério de pronto.
   Botões servem pra escolhas fechadas; intenção e estilo pedem conversa.
4. Ao propor algo (briefing, plano, opções), **passe pelo Jev de novo** (ex.: Score de
   completude do briefing, Choice entre direções) e mostre os números antes de executar.
5. Só execute depois que o Kayo confirmar o contexto.

## Respostas rápidas = botões (pedido do Kayo, 2026-10-25)

- Quando a resposta precisa de uma decisão do Kayo, **termine chamando a ferramenta
  `AskUserQuestion`** (opções clicáveis no app), não um bloco de texto. Regras:
  2 a 4 opções curtas, cada uma com descrição de uma linha; a recomendada primeiro, com
  "(Recomendado)" no rótulo; o app já oferece "Outro" pra resposta livre. Até 4 perguntas
  por chamada; `multiSelect: true` quando dá pra escolher mais de uma.
- Escreva a resposta completa **antes** da chamada (o resumo do que foi feito fica visível
  acima dos botões). Não use botões quando não há decisão a tomar.
- O clique volta exato pra mim, então o Jev não precisa interpretar. Se o Kayo responder
  digitando, o `tools/jev-prompt` ainda entende um bloco "Respostas rápidas:" numerado
  (Choice com todas/nenhuma) — use o bloco só se a ferramenta não estiver disponível.
- **Linha visível:** o hook também manda um `systemMessage` ("Jev: pedido claro") que o
  app mostra quando exibe mensagens de hook. Continue abrindo a resposta com
  `Jev (prompt): …` — é a garantia de que o Kayo vê.

## Limiares (em `tools/jev-prompt`)

objetivo < 1,2 · pronto < 0,4 (os dois ignorados quando o tipo é "confirmação") ·
ambíguo > 0,6 · falta info > 0,6 · várias > 0,6 · irreversível > 0,6 · conflito > 0,5.
Calibrar com o uso: se um alerta vive errando, subir o limiar ou mudar a pergunta.

## Privacidade e onde roda

- A mensagem (até 6 mil caracteres) e o fim da última resposta vão pra TypeSafe. Não cole
  senha/token no chat (já não deveria).
- Feito pra sessão na nuvem (Linux, `python3` e a chave no ambiente). No PC com Windows
  sem `python3`/chave, o hook falha sem bloquear; pra desligar, `/hooks` ou apagar o bloco
  `UserPromptSubmit` do `.claude/settings.json`.

## Teste manual

```bash
echo '{"prompt":"arruma o caixa"}' | tools/jev-prompt
```
