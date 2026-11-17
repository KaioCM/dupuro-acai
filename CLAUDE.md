# Dupuro A├ºa├¡ ÔÇö Site institucional + ├ürea do Revendedor

## Efici├¬ncia (leia primeiro)

- **Site 100% est├ítico** (HTML/CSS/JS puro): sem build, sem framework, sem npm. Editou ÔåÆ recarrega o preview.
- **Preview**: servidor `dupuro-acai` na porta 8855, raiz serve `dupuro-acai/` (ex.: `/area-cliente/login.html`). Dashboard/admin exigem sess├úo Supabase ÔÇö n├úo d├í pra clicar atrav├®s deles sem login.
- **Orienta├º├úo de imagem**: as fotos em `assets/img/fotos/` **n├úo t├¬m tag EXIF** de orienta├º├úo. Cheque orienta├º├úo pelas dimens├Áes via PowerShell (`System.Drawing`) ÔÇö n├úo abra o arquivo em tamanho cheio (caro em tokens). Deitada = conte├║do retrato salvo em landscape; corrija com `RotateFlip(Rotate270FlipNone)` (90┬░ anti-hor├írio) e atualize `width`/`height` no HTML.
- Site em 3 partes: **Home** (`index.html`, 2 portas) ┬À **Pe├ºa agora** (`delivery/`, compra online) ┬À **Revenda** (`revenda/`). Demais contatos levam ao WhatsApp `5565992888228`.

## Neg├│cio

F├íbrica/distribuidora de a├ºa├¡ e cremes em Cuiab├í-MT (atendimento presencial, Av. das Torres n┬║ 16, Jardim Imperial II, 78076-001). N├âO tem drive-thru. WhatsApp (65) 99288-8228. 4,8Ôÿà no Google (33 aval.). Vende tamb├®m pelo iFood. Tagline: **"Puro como tem que ser"**. **Revenda a partir de 1 caixa de 10 L** (m├¡nimo por produto; 50 L no pedido dispensam). Dois p├║blicos: (1) quem quer virar revendedor, (2) revendedores ativos que precisam de painel. *Dados extra├¡dos de Instagram/Maps ÔÇö reconfirmar antes de publicar.*

## Estrutura

```
index.html                home (vitrine: 2 portas ÔåÆ delivery/ e revenda/)
revenda/index.html        p├ígina de revenda (diferenciais, como funciona, cadastro #revenda)
area-cliente/
  login.html              login (revendedor ou admin, redireciona conforme role)
  dashboard.html          painel revendedor (fazer pedido, pedidos, cupons, perfil)
  admin.html              painel admin (aprova├º├Áes, revendedores, produtos, pedidos, cupons)
  caixa.html              PDV da loja (papel 'atendente'): registra venda presencial, vendas do dia, estoque
assets/css/style.css      design system ├║nico (vari├íveis em :root)
assets/js/
  main.js                 intera├º├Áes da landing
  supabase-config.js      URL + anon key (projeto real)
  supabase-client.js      inst├óncia ├║nica do cliente Supabase (compartilhada)
  cliente.js              acesso revendedor (auth, perfil, pedidos/cupons leitura, criar pedido)
  admin.js                acesso admin (aprovar, revendedores, produtos, pedidos, cupons)
  caixa.js                acesso atendente (cat├ílogo c/ estoque, registrar venda de loja, vendas do dia)
  printer.js              comanda da venda: app nativo (silencioso) > Web Serial (Sweda) > impress├úo pelo Windows
  offline-queue.js        fila offline do caixa (IndexedDB) + motor de sync (DupuroOffline)
sw.js                     service worker (offline do caixa)
manifest.webmanifest      manifesto PWA do caixa
desktop/                  app Electron do PC da loja (casca + impress├úo nativa) ÔÇö build separado
  app-ui.js               helpers de UI (DupuroUI.countUp)
assets/img/brand/         logos PNG oficiais + favicons
assets/img/fotos/         21 fotos profissionais otimizadas
assets/fonts/Klinko-PlayfulBold.otf
supabase/schema.sql       cópia do esquema do banco vivo (regenerado por dump — hoje 2026-11-17; inclui tabelas norte_* que não têm migração no repo); mudou schema → regenerar
supabase/migration_*.sql  registro das migra├º├Áes incrementais (005+ aplicadas via MCP)
supabase/functions/admin-delete-reseller/index.ts
supabase/functions/sugerir-fiscal/index.ts   sugest├úo de perfil fiscal pelo nome (Jev/TypeSafe)
experimentos/typesafe/    scripts + resultados dos testes com o Jev (README com os n├║meros)
tools/jev                 CLI do Jev pro desenvolvimento (yes/pick/score/trechos) ÔÇö ver skill dupuro-jev
tools/jev-prompt          analista de prompt (hook UserPromptSubmit em .claude/settings.json)
docs/                     contexto detalhado por ├írea (ver ├¡ndice abaixo)
```

## Backend Supabase (real e validado)

Projeto real em `supabase-config.js` (URL `zqadfktfplrbrjmepllh.supabase.co`). Duas camadas sobre o mesmo cliente compartilhado: `cliente.js` (usado por revenda+dashboard; a home n├úo carrega supabase-js ÔÇö s├│ `delivery.js` pros pre├ºos) e `admin.js` (admin). Conta admin: **kayocamargo@outlook.com** (`profiles.role = 'admin'`).

- Cadastro dispara notifica├º├úo best-effort via Formspree (`data-formspree-action`), mas o `SEU_FORM_ID` ainda ├® placeholder ÔÇö cadastro funciona sem isso.

## Regras que valem sempre

- **Texto de fora nunca vira HTML**: todo dado do banco montado em `innerHTML` passa por `esc(...)` (tela nova tamb├®m). Detalhe em `docs/seguranca.md`.
- **Pre├ºo, estoque e papel s├úo decididos no banco**: RPC nunca grava o que vem do navegador sem recalcular (exce├º├úo consciente: valor da venda de loja). Coluna nova sens├¡vel em `profiles` ÔåÆ incluir no trigger `profiles_protege_controle`.
- **Fun├º├úo nova n├úo nasce execut├ível por anon**; RPC p├║blica precisa de `grant execute ... to anon` expl├¡cito. Fun├º├Áes internas ficam fora de anon/authenticated.
- **Nunca calcular n├║mero de pedido/venda no cliente** (`next_pedido_numero()`/`next_venda_numero()`).
- Di├ílogos do admin: `confirmar(msg)`/`aviso(msg)`, nunca `window.confirm/alert/prompt` (o Electron da loja n├úo suporta `prompt`). Erro do banco na tela via `motivoErro(e)`.
- Sem emoji em bot├úo nem selo em cima de t├¡tulo; ├¡cones = sprite SVG. Cores s├│ pelas vari├íveis de `:root` em `style.css`.
- Mudou CSS/JS/HTML do caixa ÔåÆ subir o `CACHE_VER` do `sw.js` (o SW usa `ignoreSearch`; mudan├ºa chega na 2┬¬ abertura).
- Mudou o painel do revendedor (`dashboard.html`, `cliente.js`, `endereco.js`) ÔåÆ subir `VERSAO_PAINEL` no `dashboard.html` **e** `area-cliente/versao-painel.json` (aba aberta h├í dias recarrega sozinha ao voltar).
- Bibliotecas do CDN com vers├úo fixa (supabase-js `2.118.0`, chart.js `4.5.1`) ÔÇö atualizar de prop├│sito.
- Chaves (Focus, Mercado Pago, WhatsApp, ORS, TypeSafe) s├│ em secrets das Edge Functions, nunca no git/navegador.
- Migra├º├Áes 005+ e Edge Functions s├úo aplicadas via **MCP do Supabase**; os `.sql`/`.ts` do repo s├úo o espelho ÔÇö conferir que o deploy bate com o arquivo antes de publicar por cima.

## Onde est├í o resto (ler s├│ o que a tarefa pede)

| Arquivo | Conte├║do |
|---|---|
| `docs/admin.md` | painel admin (abas, In├¡cio, Pedidos, N├║meros, Cadastros), modos de produto, produ├º├úo/custos, ajuste de estoque, filtro Varejo/Atacado, gr├íficos |
| `docs/revenda.md` | cadastro/aprova├º├úo, pedido do revendedor (RPC, m├¡nimo por volume, entrega, a prazo), numera├º├úo, painel do revendedor, excluir revendedor |
| `docs/caixa.md` | caixa/PDV: atendente, copo/self-service, app Electron, offline + sync, sess├úo de caixa, TEF, pagamento dividido, taxa de entrega, pedidos em aberto, promo├º├Áes, comanda, layout |
| `docs/fiscal-nfce.md` | NFC-e (Focus NFe), cancelamento, cupom fiscal impresso, classifica├º├úo fiscal por perfil |
| `docs/delivery.md` | Dupuro Delivery: p├íginas, cota├º├úo (ORS + Jev), checkout Mercado Pago, banco |
| `docs/seguranca.md` | auditorias: permiss├Áes de fun├º├Áes, trigger de `profiles`, pre├ºo/estoque no banco, XSS |
| `docs/whatsapp.md` | fila de avisos, modelos da Meta, aceite |
| `docs/design-system.md` | design system v2/v3, assets, SEO |
| `.claude/skills/dupuro-jev/` | quando usar o Jev (produto e desenvolvimento) e o `tools/jev` |
| `.claude/skills/analise-de-prompt/` | toda mensagem do Kayo passa pelo Jev (hook `UserPromptSubmit` ÔåÆ `tools/jev-prompt`); abrir a resposta com `Jev (prompt): ÔÇª` |

Pra achar um assunto sem ler tudo: `grep -n` em `docs/`; se a pergunta for de comportamento e sem palavra-chave, `tools/jev trechos "pergunta" docs/*.md`.



supabase/schema.sql       cópia do esquema do banco vivo (regenerado por dump — hoje 2026-11-17; inclui tabelas norte_* que não têm migração no repo); mudou schema → regenerar


- **Tabelas órfãs no banco** (não espelhadas no repo nem usadas pelo site): `norte_leads` e `norte_admins` (migrações de out/2026, projeto paralelo Norte Interior que compartilha o Supabase). Decisão pendente: espelhar ou derrubar.


domínio `pws.dupuroacai.com` no GitHub Pages; checkout delivery com pagamento online (MP + pagar na entrega), primeiro Pix pago e entregue (DLW-0020, 2026-11-10).

## Regras de delegação (gestor → agentes)

- Ordem de inspeção: **grep/regex (grátis) → `tools/jev trechos` (centavos) → Claude lê (caro)**. Briefing de pesquisa: ≤6 perguntas.
- Todo briefing de subagente termina com: "se os steps acabarem, ENTREGUE parcial em texto com UNVERIFIED nos faltantes — nunca finalize sem resposta".
- Revisor grepa onde a feature É (inline do HTML conta), não onde o briefing acha que está.
- Depois de TODO lote com código mudado: revisor no diff **e** teste funcional de porta (render real, burst de limite, `cron.job_run_details`). Revisão estática não pega deadlock de render nem `.rpc` inerte — pegamos os dois em produção.
- Deploy Supabase: conferir vivo×repo antes de publicar por cima; migrations na ordem; nunca revogar grant de `authenticated` sem grep de PostgREST no front inteiro.
- ⚠️  2026-11-17: CLAUDE.md foi commitado corrompido (base64→lixo) uma vez (788b0b0) e restaurado do working tree. Se virar base64 de novo, decodificar do working tree antes de qualquer commit.

## Lacunas conhecidas
Sem analytics/pixel; sem testes automatizados (validação manual); não testado em dispositivo real. (Checkout online com MP e hospedagem GitHub Pages existem — ver Eficiência/Negócio.)
