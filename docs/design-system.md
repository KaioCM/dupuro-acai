# Design system, assets e SEO

Parte do contexto do projeto (índice e regras gerais no `CLAUDE.md` da raiz).

## Design system v2

Tudo em `:root` no topo de `style.css` — **ajuste as variáveis, não hardcode cores**. **Refinamento v3 (2026-10-20, skill frontend-design):** sem selo/eyebrow em cima de título, sem "→" nem emoji em botão; ícones = sprite SVG inline (`<svg class="sprite">` + `<svg class="ic"><use href="#i-..."/></svg>`, traço currentColor) no lugar de emoji; Klinko maiúscula só em título grande (cards em Inter 800 normal); único movimento de entrada = a caixa 10 L recortada (`assets/img/delivery/caixa-10l-recorte.webp`, fundo removido com rembg) chegando no topo da home (`.hero-v3`); sem reveal-on-scroll/parallax (conteúdo nunca depende de animação); celular: `.lista-compacta` (card vira linha ícone+texto) e `.carrossel` (galeria/avaliações arrastáveis). Delivery: só prometer o que existe (rastreio ao vivo/WhatsApp = Fase 3). Paleta amostrada do logo: roxo `#601050` (escala 950→300), dourado `#F5B301` (gradiente âmbar), verde-limão `#8BB831`, cream `#FFF7EC` (aliases `--color-*` mantidos). Tipografia: **Klinko** (display/uppercase/botões) + **Inter** (corpo). Pattern oficial (cumbuca+açaí) como SVG data-URI em duas versões (`--pattern-color` claro, `--pattern-ghost` roxo). Estilo "candy": botões 3D, cantos arredondados, molduras douradas. Landing com blobs animados, marquee dourado, scrollspy, parallax, contadores (`data-count-to`). Login split-screen. Logos internas (dashboard/admin/login) são botões "home". Tudo respeita `prefers-reduced-motion`.

## Assets

- `img/brand/`: logos PNG transparentes (`logo-principal[-slogan]`, `logo-branco[-slogan]`, `logo-secundaria-1/2`, `selo-movimento`) + favicons 16/32/180.
- `img/fotos/`: 21 fotos (Belvedere, Carmen, crianças, atleta Marcos, produto), máx. 1600px JPEG q80/82.
- Fonte display: `Klinko-PlayfulBold.otf` via `@font-face`.
- **As fotos antigas de IA em `assets/img/*.jpg` e `logo.svg` não são mais referenciadas** — podem ser removidas.

## SEO

`index.html` tem Open Graph, Twitter Card, JSON-LD (`LocalBusiness`); `revenda/` tem OG próprio; `robots.txt`/`sitemap.xml` com home, delivery, revenda. Domínio real `https://www.dupuroacai.com/`. Imagens com `width`/`height` e `loading="lazy"` (hero é eager/`fetchpriority="high"`). Tem skip-link, `prefers-reduced-motion`, `aria-expanded` no menu mobile.
