# Briefing do anúncio do delivery (em construção com o Kayo, desde 2026-10-25)

Método: skill `ad-creative-brief` (entrevista uma pergunta por vez → 2–3 direções → aprovação).
A cada resposta o Jev dá nota de completude (`avaliar_jev.py brief.json`). Só produz com o
briefing aprovado. As versões A/B de `../delivery-2026-10/` foram **reprovadas** (feitas sem briefing).

## Decidido até agora
- **Objetivo:** pedidos do delivery entregues com sucesso.
- **Meta:** ~12 entregues/dia (metade da capacidade de 24/dia; limite do site subiu de 10 pra 12 por turno em 2026-10-25).
- **Público:** mãe/pai de família, quem **já conhece e gosta** da Dupuro. Concorrente dominante: Movido Açaí
  (mais popular); a Dupuro é famosa pelo sabor — "quem experimenta não volta". Vende mais no calor.
- **Jev:** consciência = *product-aware* (0,97). Ângulo: conveniência 0,70 · sabor 0,23.
- **Mensagem:** sabor + conveniência — **"Seu açaí favorito agora chega aí em casa"** (redação do Kayo).
- **Sentimento:** vontade de pedir, vendo na hora o preço de todas as caixas.
- **Layout:** peça única; as 4 caixas lado a lado em ordem crescente (1, 2, 5, 10 L) com o preço embaixo
  de cada uma + taxa de entrega. Bonito **e** dentro das regras.
- **Material:** fotos de estúdio das 4 caixas do site (fotos reais com fundo trocado) — recortar.
  Preços: 1 L R$25 · 2 L R$45 · 5 L R$85 · 10 L R$175 · entrega a partir de R$5.
- **Pendências levantadas (decisão do Kayo):** litro da 10 L mais caro que o da 5 L; cremes com estoque baixo.
- **Atenção:** comparação nomeando a concorrente = propaganda comparativa (CONAR) — decidir em "restrições".

## Notas do Jev (pronto pra produzir, 0–2)
0,20 (só objetivo) → 0,34 (+ meta) → 0,62 (+ público) → 0,84 (+ mensagem) → 1,01 (+ sentimento, layout, material)

## Falta
Estilo e referências (0,04) · restrições (0,37) · provas (0,14) · produção/canal/orçamento (0,04).

## Material pronto
`material/caixa-{1l,2l,5l,10l}-estudio-recorte.webp` — as 4 fotos de estúdio do site com o fundo
removido (rembg, modelo isnet-general-use, máscara binarizada e com buracos preenchidos — a 1ª
tentativa deixou o rótulo da 10 L semitransparente). Cada recorte está no próprio tamanho; a
**proporção real** entre as caixas ainda precisa ser definida (medidas reais ou escala por volume).

## Estilo (decidido 2026-10-26)
Mantém roxo e dourado. **Artesanal conduz** (o Jev indicava "limpa" 0,97 — decisão do Kayo foi artesanal);
toques: caixas levemente tortas, letreiro à mão, preço em adesivo redondo **embaixo** de cada caixa.
Formato = "Grid Static (multi-SKU)", tier A na skill `ad-creative`. Caixas em escala pela raiz cúbica do volume.

## Esboços de direção (`esbocos/`, não são a peça final) — notas do Jev
| | artesanal | preço de relance | vontade | poluição | parece IA | segue brief |
|---|---|---|---|---|---|---|
| prateleira | 1,15 | 1,88 | 1,63 | 0,53 | 0,58 | 0,51 |
| letreiro | 1,34 | 1,87 | 1,60 | 0,54 | 0,54 | 0,65 |
| papel | 1,33 | 1,90 | 1,65 | 0,64 | 0,51 | 0,69 |
Duelo a três (3 ordens): letreiro 0,55 · prateleira 0,23 · papel 0,22 (sinal fraco, sensível à ordem).
Ponto fraco comum: artesanal só "no meio" — texturas imitadas. Ideia: elementos reais fotografados.

## Aprovado e produzido (2026-10-26)
Detalhes finais: título "Seu açaí favorito agora chega na sua casa"; direção papel com carimbo
"Direto da fábrica"; sem nota do Google; feed + stories; escala por volume. Jev: 1,93/2.
Peça em `../delivery-v2/`.
