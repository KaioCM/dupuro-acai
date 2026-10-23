# Dupuro Açaí — Site institucional + Área do Revendedor

## Eficiência (leia primeiro)

- **Site 100% estático** (HTML/CSS/JS puro): sem build, sem framework, sem npm. Editou → recarrega o preview.
- **Preview**: servidor `dupuro-acai` na porta 8855, raiz serve `dupuro-acai/` (ex.: `/area-cliente/login.html`). Dashboard/admin exigem sessão Supabase — não dá pra clicar através deles sem login.
- **Orientação de imagem**: as fotos em `assets/img/fotos/` **não têm tag EXIF** de orientação. Cheque orientação pelas dimensões via PowerShell (`System.Drawing`) — não abra o arquivo em tamanho cheio (caro em tokens). Deitada = conteúdo retrato salvo em landscape; corrija com `RotateFlip(Rotate270FlipNone)` (90° anti-horário) e atualize `width`/`height` no HTML.
- Site em 3 partes: **Home** (`index.html`, 2 portas) · **Peça agora** (`delivery/`, compra online) · **Revenda** (`revenda/`). Demais contatos levam ao WhatsApp `5565992888228`.

## Negócio

Fábrica/distribuidora de açaí e cremes em Cuiabá-MT (atendimento presencial, Av. das Torres nº 16, Jardim Imperial II, 78076-001). NÃO tem drive-thru. WhatsApp (65) 99288-8228. 4,8★ no Google (33 aval.). Vende também pelo iFood. Tagline: **"Puro como tem que ser"**. **Revenda a partir de 1 caixa de 10 L** (mínimo por produto; 50 L no pedido dispensam). Dois públicos: (1) quem quer virar revendedor, (2) revendedores ativos que precisam de painel. *Dados extraídos de Instagram/Maps — reconfirmar antes de publicar.*

## Estrutura

```
index.html                home (vitrine: 2 portas → delivery/ e revenda/)
revenda/index.html        página de revenda (diferenciais, como funciona, cadastro #revenda)
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
  printer.js              comanda da venda: app nativo (silencioso) > Web Serial (Sweda) > impressão pelo Windows
  offline-queue.js        fila offline do caixa (IndexedDB) + motor de sync (DupuroOffline)
sw.js                     service worker (offline do caixa)
manifest.webmanifest      manifesto PWA do caixa
desktop/                  app Electron do PC da loja (casca + impressão nativa) — build separado
  app-ui.js               helpers de UI (DupuroUI.countUp)
assets/img/brand/         logos PNG oficiais + favicons
assets/img/fotos/         21 fotos profissionais otimizadas
assets/fonts/Klinko-PlayfulBold.otf
supabase/schema.sql       esquema completo p/ projeto novo (já inclui policies das migrações)
supabase/migration_*.sql  registro das migrações incrementais (005+ aplicadas via MCP)
supabase/functions/admin-delete-reseller/index.ts
supabase/functions/sugerir-fiscal/index.ts   sugestão de perfil fiscal pelo nome (Jev/TypeSafe)
experimentos/typesafe/    scripts + resultados dos testes com o Jev (README com os números)
tools/jev                 CLI do Jev pro desenvolvimento (yes/pick/score/trechos) — ver skill dupuro-jev
docs/                     contexto detalhado por área (ver índice abaixo)
```

## Backend Supabase (real e validado)

Projeto real em `supabase-config.js` (URL `zqadfktfplrbrjmepllh.supabase.co`). Duas camadas sobre o mesmo cliente compartilhado: `cliente.js` (usado por revenda+dashboard; a home não carrega supabase-js — só `delivery.js` pros preços) e `admin.js` (admin). Conta admin: **kayocamargo@outlook.com** (`profiles.role = 'admin'`).

- Cadastro dispara notificação best-effort via Formspree (`data-formspree-action`), mas o `SEU_FORM_ID` ainda é placeholder — cadastro funciona sem isso.

## Regras que valem sempre

- **Texto de fora nunca vira HTML**: todo dado do banco montado em `innerHTML` passa por `esc(...)` (tela nova também). Detalhe em `docs/seguranca.md`.
- **Preço, estoque e papel são decididos no banco**: RPC nunca grava o que vem do navegador sem recalcular (exceção consciente: valor da venda de loja). Coluna nova sensível em `profiles` → incluir no trigger `profiles_protege_controle`.
- **Função nova não nasce executável por anon**; RPC pública precisa de `grant execute ... to anon` explícito. Funções internas ficam fora de anon/authenticated.
- **Nunca calcular número de pedido/venda no cliente** (`next_pedido_numero()`/`next_venda_numero()`).
- Diálogos do admin: `confirmar(msg)`/`aviso(msg)`, nunca `window.confirm/alert/prompt` (o Electron da loja não suporta `prompt`). Erro do banco na tela via `motivoErro(e)`.
- Sem emoji em botão nem selo em cima de título; ícones = sprite SVG. Cores só pelas variáveis de `:root` em `style.css`.
- Mudou CSS/JS/HTML do caixa → subir o `CACHE_VER` do `sw.js` (o SW usa `ignoreSearch`; mudança chega na 2ª abertura).
- Bibliotecas do CDN com versão fixa (supabase-js `2.118.0`, chart.js `4.5.1`) — atualizar de propósito.
- Chaves (Focus, Mercado Pago, WhatsApp, ORS, TypeSafe) só em secrets das Edge Functions, nunca no git/navegador.
- Migrações 005+ e Edge Functions são aplicadas via **MCP do Supabase**; os `.sql`/`.ts` do repo são o espelho — conferir que o deploy bate com o arquivo antes de publicar por cima.

## Onde está o resto (ler só o que a tarefa pede)

| Arquivo | Conteúdo |
|---|---|
| `docs/admin.md` | painel admin (abas, Início, Pedidos, Números, Cadastros), modos de produto, produção/custos, ajuste de estoque, filtro Varejo/Atacado, gráficos |
| `docs/revenda.md` | cadastro/aprovação, pedido do revendedor (RPC, mínimo por volume, entrega, a prazo), numeração, painel do revendedor, excluir revendedor |
| `docs/caixa.md` | caixa/PDV: atendente, copo/self-service, app Electron, offline + sync, sessão de caixa, TEF, pagamento dividido, taxa de entrega, pedidos em aberto, promoções, comanda, layout |
| `docs/fiscal-nfce.md` | NFC-e (Focus NFe), cancelamento, cupom fiscal impresso, classificação fiscal por perfil |
| `docs/delivery.md` | Dupuro Delivery: páginas, cotação (ORS + Jev), checkout Mercado Pago, banco |
| `docs/seguranca.md` | auditorias: permissões de funções, trigger de `profiles`, preço/estoque no banco, XSS |
| `docs/whatsapp.md` | fila de avisos, modelos da Meta, aceite |
| `docs/design-system.md` | design system v2/v3, assets, SEO |
| `.claude/skills/dupuro-jev/` | quando usar o Jev (produto e desenvolvimento) e o `tools/jev` |

Pra achar um assunto sem ler tudo: `grep -n` em `docs/`; se a pergunta for de comportamento e sem palavra-chave, `tools/jev trechos "pergunta" docs/*.md`.

## Lacunas conhecidas

Sem analytics/pixel; sem checkout (CTA → WhatsApp); sem testes automatizados (validação manual); não testado em dispositivo real; sem hospedagem/domínio definidos.
