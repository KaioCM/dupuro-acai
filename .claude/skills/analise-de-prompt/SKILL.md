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

## O que o Claude faz com o resumo

1. **Abre a resposta com uma linha** `Jev (prompt): …`:
   - sem alerta → `Jev (prompt): ok`;
   - com alerta → os alertas com que concorda + **uma sugestão concreta** de como o pedido
     ficaria mais claro (ex.: "dizer qual tela do caixa", "dizer o que conta como pronto").
2. **Filtra o ruído.** O Jev vê só a mensagem e o fim da última resposta. Se a conversa
   mostra que ele errou, diga isso em poucas palavras em vez de repetir o alerta.
   "Várias tarefas" num "faz tudo" que aprova uma lista é esperado, não defeito.
3. **Age conforme o peso:**
   - falta informação ou ambiguidade que **muda o trabalho** → perguntar antes de fazer;
   - ação irreversível → seguir as regras de publicação/confirmação de sempre;
   - o resto → seguir normalmente; o alerta é só aprendizado.
4. Não transformar a análise em sermão: uma linha, no máximo duas.

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
