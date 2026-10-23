# Experimentos com o Jev (TypeSafe) — 2026-10-23

API `POST https://api.typesafe.ai/v1/systemone` (Bearer, modelo `jev-latest`; os dois
modelos responderam como `jev-1.14.0`). Docs: https://docs.typesafe.ai/llms.txt.
Rodar: `export TYPESAFE_API_KEY=...` e `python3 -I exp1_fiscal.py [jev-latest|jev-preview]`
(idem `exp1b_holdout.py`, `exp2_motivos.py`; `analise1.py` resume a rodada 1).
As respostas brutas ficam em `resultados/`. A chave nunca vai pro git nem pro navegador.

## 1. Classificação fiscal do produto (virou a Edge Function `sugerir-fiscal`)

Pergunta Choice com os perfis de `FISCAL_PERFIS` (admin.html), só pelo nome + modo.
Descrições das opções em inglês (língua principal do Jev); nome do produto em português.

| Variante | Gabarito (25 do banco) | Inventados (22–27) | Observação |
|---|---|---|---|
| A — contexto da loja | 25/25 | 21/22 | fora-do-conjunto caem em `adicional` com conf. alta |
| B — A com opções invertidas | 25/25 | 22/22 | só casos limítrofes mudam (viés de 1ª opção pequeno) |
| C — A + opção `custom` | 25/25 | 26/27 | descrição de `custom` citava os exemplos testados (vazava) |
| D — sem contexto da loja | **11/25** | 18/22 | "Caixa de 2 Litros" → refri, "Copo de 300ml" → adicional |
| **C2 — final** (custom genérico + "Creme de <sabor>") | 25/25 | 27/27 | **holdout 23/23** (nomes fora de qualquer descrição) |

Na C2, confiança média 0,96; abaixo de 0,8 só os ambíguos de verdade (Chocoball porção
0,45, Paçoca ~0,5, Água de coco ~0,5). Os 30 acompanhamentos deram 30/30 como `adicional`
(sem contexto, "Granola" e "Sucrilhos" viram `granola`).
Ressalva: as descrições foram escritas conhecendo o catálogo — o número honesto é o holdout.
O enquadramento "fora dos perfis" (energético, chá gelado, gelo, suco) é leitura nossa:
confirmar NCM com o contador.

## 2. Motivos de cancelamento (`orders.cancel_motivo`)

O Jev não inventa categorias (não gera texto) — escolhe numa taxonomia dada (9 categorias
em `exp2_motivos.py`). Reais: 13/13, mas são só 4 textos ("teste" ×10, teste de NFC-e,
"desistiu", "troca"). Sintéticos realistas: 18/19 (erro: "a pedido do Kayo" → desistência,
conf. 0,49 — cairia em revisão). Conclusão: hoje não vale — com 77% "teste" não há o que
agrupar; melhor um seletor de categoria no modal de cancelar do caixa (texto livre como
complemento) e o Jev, se um dia, só pro texto livre antigo.
