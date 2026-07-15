# Dupuro Açaí — Site institucional + Área do Revendedor

## Eficiência (leia primeiro)

- **Site 100% estático** (HTML/CSS/JS puro): sem build, sem framework, sem npm. Editou → recarrega o preview.
- **Preview**: servidor `dupuro-acai` na porta 8853, raiz serve `dupuro-acai/` (ex.: `/area-cliente/login.html`). Dashboard/admin exigem sessão Supabase — não dá pra clicar através deles sem login.
- **Orientação de imagem**: as fotos em `assets/img/fotos/` **não têm tag EXIF** de orientação. Cheque orientação pelas dimensões via PowerShell (`System.Drawing`) — não abra o arquivo em tamanho cheio (caro em tokens). Deitada = conteúdo retrato salvo em landscape; corrija com `RotateFlip(Rotate270FlipNone)` (90° anti-horário) e atualize `width`/`height` no HTML.
- Toda ação de compra leva ao WhatsApp `5566996549545` (sem carrinho/checkout).

## Negócio

Fábrica/distribuidora de açaí e cremes em Cuiabá-MT (atendimento presencial, Av. das Torres nº 16, Jardim Imperial II, 78076-001). NÃO tem drive-thru. WhatsApp (66) 99654-9545. 4,8★ no Google (33 aval.). Vende também pelo iFood. Tagline: **"Puro como tem que ser"**. **Sem pedido mínimo.** Dois públicos: (1) quem quer virar revendedor, (2) revendedores ativos que precisam de painel. *Dados extraídos de Instagram/Maps — reconfirmar antes de publicar.*

## Estrutura

```
index.html                landing
area-cliente/
  login.html              login (revendedor ou admin, redireciona conforme role)
  dashboard.html          painel revendedor (fazer pedido, pedidos, cupons, perfil)
  admin.html              painel admin (aprovações, revendedores, produtos, pedidos, cupons)
  caixa.html              PDV da loja (papel 'atendente'): registra venda presencial, vendas do dia, estoque
assets/css/style.css      design system único (variáveis em :root)
assets/js/
  main.js                 interações da landing
  supabase-config.js      URL + anon key (projeto real)
  supabase-client.js      instância única do cliente Supabase (compartilhada)
  cliente.js              acesso revendedor (auth, perfil, pedidos/cupons leitura, criar pedido)
  admin.js                acesso admin (aprovar, revendedores, produtos, pedidos, cupons)
  caixa.js                acesso atendente (catálogo c/ estoque, registrar venda de loja, vendas do dia)
  printer.js              comanda da venda: ESC/POS via Web Serial (Sweda) + fallback de impressão pelo Windows
  app-ui.js               helpers de UI (DupuroUI.countUp)
assets/img/brand/         logos PNG oficiais + favicons
assets/img/fotos/         21 fotos profissionais otimizadas
assets/fonts/Klinko-PlayfulBold.otf
supabase/schema.sql       esquema completo p/ projeto novo (já inclui policies das migrações)
supabase/migration_*.sql  registro das migrações incrementais (005+ aplicadas via MCP)
supabase/functions/admin-delete-reseller/index.ts
```

## Backend Supabase (real e validado)

Projeto real em `supabase-config.js` (URL `zqadfktfplrbrjmepllh.supabase.co`). Duas camadas sobre o mesmo cliente compartilhado: `cliente.js` (usado por index+dashboard) e `admin.js` (admin). Conta admin: **kayocamargo@outlook.com** (`profiles.role = 'admin'`).

- **Cadastro/aprovação**: cliente se cadastra em `index.html#revenda` → `status = 'pendente'`. Login só libera se `aprovado`. Admin aprova/rejeita na aba Aprovações. Login admin pula aprovação e vai direto ao painel admin. **"Confirm email" do Supabase está desativado** — aprovação do admin é o único obstáculo.
- **Painel admin**: Visão geral (cards + 4 gráficos Chart.js via CDN); Aprovações; Revendedores (listar + editar + remover); Produtos (CRUD, imagem no bucket público `produtos`; um produto pode ser **varejo e/ou atacado** — marcando os dois vira duas linhas ligadas por `estoque_ref` que dividem estoque, com preço e pedido mínimo próprios de cada tipo; `saveDualProduct` reconcilia criar/editar/converter); Pedidos (select de produto + qtd 1–99, valor auto, campo de data livre, criar/editar/excluir, número `PED-XXXX` auto); Cupons (gerar/excluir — revendedor só vê).
- **Modos de produto** (migration_019, `products.modo`): `embalado` (padrão — caixas/potes/bebidas, é o único que o revendedor vê e o único com estoque/atacado-varejo), `copo` (açaí no copo da loja: preço fixo + `acomp_gratis` acompanhamentos grátis e `acomp_extra_preco` por excedente) e `peso` (self-service; `preco` = R$/kg). Copo/peso são linha única (`saveStoreProduct`), sem estoque por unidade, e ficam fora do gráfico de estoque, do select de pedidos e do dashboard do revendedor. Tabela `acompanhamentos` (lista única da loja: `gratuito` entra na cota, `pago` cobra preço próprio) tem CRUD na aba Produtos.
- **Venda de copo/self-service no PDV** (migration_020): no caixa, copo abre a lista de acompanhamentos (cota grátis + excedente cobrado + pagos somados) e self-service pede o peso em kg (campo texto, aceita vírgula). Essas linhas nascem com `usa_estoque = false` (não têm estoque por unidade) e `orders.detalhes` (jsonb) guarda acompanhamentos/peso — base pra comanda impressa e nota fiscal. A policy `orders_insert_atendente` amarra `usa_estoque` ao `modo` do produto: embalado obriga `true`, copo/peso obrigam `false`.
- **Revendedor lança pedido** (aba Fazer pedido): sempre nasce `status = 'enviado'` — travado no banco pela policy `orders_insert_self` (revendedor_id = auth.uid() + status='enviado' + perfil aprovado).
- **Atendente (caixa/PDV)**: papel `atendente` (migration_018). Login redireciona pra `caixa.html`. Registra venda presencial (balcão avulso ou revendedor) que nasce `origem='loja'` + `status='entregue'` e **baixa o estoque na hora** — sem análise do admin. RLS `orders_insert_atendente` obriga origem='loja'/entregue/usa_estoque coerente com o modo; ela não gerencia produtos/revendedores/pedidos. **Editar/cancelar venda** (migration_022): na aba Vendas do dia a atendente pode **cancelar** (vira status 'cancelado' + `cancel_motivo`, sai do total, estoque volta) ou **editar** (recarrega os itens no carrinho e refaz a venda) — **só as vendas de hoje** e **com motivo obrigatório**. Tudo passa pelas funções `caixa_cancelar_venda`/`caixa_substituir_venda`/`caixa_pode_mexer` (security definer; checam papel + "é de hoje" no fuso America/Cuiaba) e grava trilha em `order_audits` (só o admin lê). O admin vê essa trilha (quem/quando/ação/motivo/estado anterior) num painel no fim da aba **Pedidos** (`getOrderAudits` + `renderAudits`). Admin transforma um revendedor em atendente pelo botão "Caixa" (aba Revendedores).
- **Numeração** (migration_021): pedido de revendedor/admin = **PED-XXXX**, venda de loja = **VND-XXXX**, cada um numerado pelas funções `next_pedido_numero()` / `next_venda_numero()` (security definer — enxergam todas as linhas). Nunca calcular número no cliente: cada papel só vê parte de `orders` pelo RLS e gerava números repetidos. Vendas de loja antigas (até PED-1006) ficaram com número PED-.
- **Comanda impressa** (`printer.js`): impressora térmica **Sweda** (papel 80mm = 48 colunas, acentos em CP850). Na loja a Sweda está instalada como **impressora do Windows** (não expõe porta serial), então o caminho usado é a **impressão do navegador** (HTML 80mm por iframe). Para sair **sem a janela** de impressão, abrir o caixa pelo Chrome/Edge com `--kiosk-printing` e a Sweda como impressora padrão — há um painel de ajuda ("Fazer sair sem a janela") na aba Nova venda com o passo a passo. Barra da impressora tem "imprimir ao registrar" (lembrado no localStorage) + "Imprimir teste"; reimpressão por venda na aba Vendas do dia. O código Web Serial (ESC/POS direto) continua em `printer.js` mas não é usado por essa impressora — a UI de conectar porta foi removida.
- **Excluir revendedor** apaga a conta de auth de verdade via Edge Function `admin-delete-reseller` (service role, `verify_jwt: true`, valida role=admin no servidor). Pedidos/cupons do revendedor removido **não somem**: `revendedor_id` é opcional com `on delete set null` (UI mostra "Revendedor removido").
- Migrações 005+ e a Edge Function são aplicadas via **MCP do Supabase** (acesso concedido); os arquivos `.sql`/`.ts` são só o espelho.
- Cadastro dispara notificação best-effort via Formspree (`data-formspree-action`), mas o `SEU_FORM_ID` ainda é placeholder — cadastro funciona sem isso.

## Design system v2

Tudo em `:root` no topo de `style.css` — **ajuste as variáveis, não hardcode cores**. Paleta amostrada do logo: roxo `#601050` (escala 950→300), dourado `#F5B301` (gradiente âmbar), verde-limão `#8BB831`, cream `#FFF7EC` (aliases `--color-*` mantidos). Tipografia: **Klinko** (display/uppercase/botões) + **Inter** (corpo). Pattern oficial (cumbuca+açaí) como SVG data-URI em duas versões (`--pattern-color` claro, `--pattern-ghost` roxo). Estilo "candy": botões 3D, cantos arredondados, molduras douradas. Landing com blobs animados, marquee dourado, scrollspy, parallax, contadores (`data-count-to`). Login split-screen. Logos internas (dashboard/admin/login) são botões "home". Tudo respeita `prefers-reduced-motion`.

## Assets

- `img/brand/`: logos PNG transparentes (`logo-principal[-slogan]`, `logo-branco[-slogan]`, `logo-secundaria-1/2`, `selo-movimento`) + favicons 16/32/180.
- `img/fotos/`: 21 fotos (Belvedere, Carmen, crianças, atleta Marcos, produto), máx. 1600px JPEG q80/82.
- Fonte display: `Klinko-PlayfulBold.otf` via `@font-face`.
- **As fotos antigas de IA em `assets/img/*.jpg` e `logo.svg` não são mais referenciadas** — podem ser removidas.

## SEO

`index.html` tem Open Graph, Twitter Card, JSON-LD (`LocalBusiness`), `robots.txt` e `sitemap.xml`. **Todas as URLs usam o domínio placeholder `https://www.dupuroacai.com.br/`** — trocar pelo real ao definir hospedagem. Imagens com `width`/`height` e `loading="lazy"` (hero é eager/`fetchpriority="high"`). Tem skip-link, `prefers-reduced-motion`, `aria-expanded` no menu mobile.

## Lacunas conhecidas

Sem analytics/pixel; sem checkout (CTA → WhatsApp); sem testes automatizados (validação manual); não testado em dispositivo real; sem hospedagem/domínio definidos.
