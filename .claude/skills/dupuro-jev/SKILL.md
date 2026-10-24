---
name: dupuro-jev
description: Quando e como usar o Jev (TypeSafe) neste projeto, tanto no produto (Edge Functions) quanto como parceiro barato do Claude no desenvolvimento — filtrar trechos de arquivo grande antes de ler, triar log/saída grande, rotular dados em lote, checar regras num diff. Use antes de chamar tools/jev ou de criar uma integração nova com o Jev.
---

# Jev no Dupuro

O Jev **não gera texto**: responde só **Noul** (P de sim), **Choice** (uma de N, com
probabilidades) ou **Score** (posição numa escala de até 10 níveis), cada um com confiança.
Custa US$ 0,042 por milhão de tokens de entrada (~US$ 0,00003 por pergunta pequena) e
responde em ~0,5 s. Limite: 64k tokens por request (32k por pergunta).
Docs: https://docs.typesafe.ai/llms.txt — ler a página do primitivo antes de desenhar uma pergunta nova.

## Regra de ouro: só chame se evitar leitura grande

O Jev é barato, mas **cada chamada custa tokens do Claude** (escrever a pergunta, ~100–300
tokens de saída, e ler a resposta). Vale quando a alternativa é ler algo grande; não vale
pra decidir algo que cabe em ~1k tokens de leitura.

Ordem: **código/regex/grep** (de graça) → **Jev** (centavos) → **Claude lê** (caro).

| Situação | Usar Jev? |
|---|---|
| Pergunta de comportamento num arquivo grande e sem palavra-chave óbvia (`admin.html` 4,3k linhas, `caixa.html`, `dashboard.html`) | **Sim** — `tools/jev trechos` |
| Sei o nome da função/coluna | **Não** — `grep` |
| Log do Supabase, saída de busca, lista longa a descartar | **Sim** — `jev yes`/`pick` por item, num script |
| Rotular centenas de itens (motivos, catálogo, pedidos antigos) | **Sim** — o melhor caso; baixa confiança volta pro Claude |
| Checar diff contra as regras do CLAUDE.md | Só depois do `grep` das regras mecânicas; ganho é consistência, não tokens |
| Classificar um comentário de review que vou ler de qualquer jeito | **Não** |
| Escolher skill (poucas e já descritas no contexto) | **Não** |

## Ferramenta: `tools/jev`

Chave em `$TYPESAFE_API_KEY` (nunca em argumento, arquivo do repo ou navegador).

```bash
tools/jev trechos "where does the cashier cancel a sale with a mandatory reason?" assets/js/caixa.js area-cliente/caixa.html
#  area-cliente/caixa.html:2101-2200  0.95   ← ler só esses blocos (sed -n '2101,2200p')
tools/jev yes "Is this cancellation reason just a test?" --state "era só teste da nfce"
tools/jev pick "Which expense category?" materia_prima="raw ingredients" embalagem="packaging" --outro --state "Pote 10L com tampa"
tools/jev score "How urgent?" "can wait" "today" "right now" --state @arquivo.txt
```

`trechos`: blocos de 100 linhas (`--linhas`), mostra os `--top` acima de `--min`. Medido
(2026-10-23): no `admin.html` o bloco certo ficou em 1º em 4 de 5 perguntas e em 2º na
outra, por ~US$ 0,004 o arquivo inteiro. Leia o bloco vizinho se a resposta parecer cortada.

## Imagens e Box (experimental desde o Jev 1.14)

Header `TypeSafe-Danger-Zone-Images: true` (o `tools/jev` põe sozinho). A foto pode ir no
state, nas instructions ou nas criteria (opção definida por foto de exemplo). **Box** devolve
um retângulo (frações 0–1) e precisa do `jev-1.14.0`. A TypeSafe chama de "dreamer-ready":
**protótipo, não produção** — formato e precisão podem mudar.

```bash
tools/jev pick "Which flavor is the ice cream in `imagem`?" morango="pink" maracuja="yellow" --outro --imagem foto.jpg
tools/jev box "the açaí box in `imagem`" --imagem foto.jpg --recorte caixa.jpg   # junto vai a Noul de presença
```

- Limites: PNG/JPEG, 280–1568 px por lado, rotação **nos pixels** (o EXIF é descartado).
- ~1,5k tokens por foto de 768 px; ~2,4k a 1024 px.
- A **Box sempre devolve uma caixa**: só confie com a Noul "tem X?" alta.
- Confiança alta em imagem **não garante** acerto (sabor errado com 0,99 no teste) — imagem
  serve pra sugerir/triar, com pessoa confirmando.
- Pro Claude: perguntar ao Jev sobre uma foto custa ~2k tokens dele (centavos) contra abrir a
  imagem no próprio contexto — útil pra triar muitas fotos (orientação, "tem produto?") antes de abrir.
- Números em `experimentos/typesafe/README.md` (seção 5).

## Como escrever as perguntas (o que funcionou aqui)

- **Instruções e descrições das opções em inglês**; o dado (nome do produto, texto) fica em português.
- **Dê o contexto da loja** no `state`: sem ele a classificação fiscal caiu de 25/25 para 11/25.
- **Sempre uma saída "nenhuma/outro"** (`--outro`, ou `custom` no fiscal) quando nada pode servir.
- Descrição de opção **genérica** — não cite os exemplos que você vai testar (vaza e infla o acerto).
- Várias perguntas sobre o mesmo `state` vão **num request só** (rodam em paralelo, o state é cobrado uma vez).
- Use a confiança como gatilho: abaixo de ~0,8 → revisão humana/Claude. Calibrar com dados reais.

## No produto

- `supabase/functions/sugerir-fiscal` — perfil fiscal pelo nome (admin, um produto) e
  auditoria do catálogo (`{auditoria:true}`, lista divergências com confiança alta).
- `supabase/functions/delivery-cotacao` — escolhe, entre os candidatos do geocoding, o que
  bate com o endereço digitado (best-effort: sem chave ou erro, segue a ordem do Pelias).
- Secret `TYPESAFE_API_KEY` nas Edge Functions. Experimentos e números em `experimentos/typesafe/`.
- **Dados de cliente (nome, telefone, endereço) vão a um terceiro** ao chamar o Jev — só com
  decisão do Kayo (LGPD). Endereço de entrega no delivery foi aprovado; nome/telefone não vão.
