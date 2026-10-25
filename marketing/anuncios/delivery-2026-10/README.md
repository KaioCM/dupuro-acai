# Anúncio — Dupuro Delivery (2026-10)

Objetivo: vender o delivery (caixas em casa), sem oferta. CTA "Peça agora" → `dupuroacai.com/delivery`.

| Arquivo | Uso |
|---|---|
| `dupuro-delivery-feed-4x5.png` | Instagram/Facebook feed, 1080×1350 |
| `dupuro-delivery-stories-9x16.png` | Stories/Reels/Status, 1080×1920 (margem livre de 250 px em cima e 330 px embaixo) |
| `*-B.png` (`feed-b.html`, `story-b.html`) | **versão B**: foto real (caixa aberta com maracujá) ocupando a peça — vence a A no duelo do Jev |
| `feed.html`, `story.html`, `criativo.css` | fonte — editar e rodar `sh render.sh` (Chromium headless) |

Texto só com o que a página /delivery/ promete: entrega em Cuiabá e VG, manhã ou tarde,
Pix ou cartão, 4,8 no Google (33 avaliações — conferir antes de veicular).
Fotos reais do site (`assets/img/delivery/`), cores e fonte Klinko do design system.
Versões editáveis no Canva da conta do Kayo (links na conversa de 2026-10-25), com a caixa
recortada, a foto do creme e o logo branco na biblioteca de uploads.

Antes de pagar mídia: fazer uma compra real de teste no /delivery/ (até 2026-10-25 nenhum
pedido tinha sido pago — o checkout cria a preferência no Mercado Pago, falta ver o fim).

## Avaliação pelo Jev (2026-10-25, `avaliar_jev.py`)

| | Feed | Stories |
|---|---|---|
| Título legível no celular (0–2) | 1,92 | 1,91 |
| Claro que vende açaí em casa (P sim) | 0,97 | 0,96 |
| Claro o próximo passo (P sim) | 0,96 | 0,96 |
| Poluição visual (0 limpo – 2 poluído) | 0,76 | 0,57 |
| Atrai o olhar primeiro | título 0,90 | título 0,93 |
| Parece anúncio profissional (P sim) | 0,68 | 0,69 |
| **Apetite (0–2)** | **1,09** | **1,07** |

Ponto fraco: apetite — a comida aparece pouco (embalagem em destaque, creme num círculo
pequeno). Próximo teste: versão B com a foto do creme como fundo. Imagem no Jev é
experimental: triagem, não veredito.

### Versão B × A (mesmo script; duelo com as duas peças no mesmo request, nas duas ordens)

| | Feed A | Feed B | Stories A | Stories B |
|---|---|---|---|---|
| Apetite (0–2) | 1,07 | **1,56** | 1,07 | **1,22** |
| Título legível (0–2) | 1,92 | 1,89 | 1,94 | 1,83 |
| Poluição (0 limpo) | 0,72 | 0,87 | 0,56 | 1,12 |
| Profissional (P sim) | 0,71 | 0,62 | 0,72 | 0,55 |
| Duelo "qual dá mais vontade de pedir" | | **B** 0,88 / 0,84 | | **B** 0,90 / 0,78 |

A foto de fundo foi escolhida pelo Jev (Score de apetite): caixa aberta com maracujá 1,69 ·
creme de cupuaçu na colher 1,12 · pote de morango 0,99 · creme de morango aberto 0,48.
Ponto a melhorar no story B: selos em cima da comida (poluição 1,12).
