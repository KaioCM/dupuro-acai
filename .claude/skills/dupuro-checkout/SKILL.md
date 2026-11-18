---
name: dupuro-checkout
description: Mapa vivo do checkout Dupuro (delivery + revenda): páginas, fluxo, status de pedido, Mercado Pago, webhook, cupons, taxa de entrega assinada, anti-abuso e protocolo de deploy/revisão. Use ao mexer ou depurar delivery/, Edge Functions delivery-*, revenda-pagar, tabela coupons, migrações de checkout, tela "Financeiro pendente" do admin, ou ao planejar mudanças de preço/pagamento/entrega — mesmo que o usuário não diga "checkout".
---

# Dupuro Checkout — mapa e regras do território

Site estático + Supabase (`zqadfktfplrbrjmepllh`). Veridade é o código/SQL; `docs/*.md` são mapa. O banco é COMPARTILHADO com o projeto Norte Interior (tabelas `norte_*`, cron, functions e secrets em comum).

## Fluxo (delivery)
`index.html` → `pedido.html` (3 telas: Escolher — Entrega — Pagar; `irPara/podeIr` ~:690-712) → `acompanhar.html?t=<token>` (polling 10/20/30s + mapa fase longe/perto/a_caminho). Carrinho em localStorage (`dupuro-delivery-carrinho`); preço exibido pode estar velho — o servidor recalcula.

## Edge Functions
- `delivery-checkout`: valida cotação assinada (HMAC `lat|lng|km|taxa|exp`, 2h), preço/estoque/turno no banco, cupom frete via RPC, cria `aguardando_pagamento`; expiração preguiçosa >3h (co-irmão cron `delivery-expirar`, 10 min).
- `delivery-pagar`/`revenda-pagar`: Brick Pix/cartão; `{acao:'status'}` = polling (NUNCA rate-limitar esse caminho); valor sempre o do banco.
- `delivery-mp-webhook`: NÃO confia no corpo — reconsulta `GET /v1/payments/{id}`; assinatura só com `MP_WEBHOOK_SECRET` setado (está setado); 429 por IP é proposital (MP re-notifica).
- `delivery-cotacao`: ORS + cascata pin→Pelias→CEP→rua; Jev desempata endereço; fallback linha reta x1,35 marca `impreciso` (checkout não veta).

## Status
Delivery: `aguardando_pagamento → pago → em_rota → entregue` + `cancelado`/`expirado`. **pago ≠ receita** (pagar-na-entrega nasce `pago` com `pagar_na_entrega=true`; receita real = `recebido_forma` ou `mp_status='approved'`). Único caminho que baixa estoque: RPC `delivery_confirmar_pagamento` (service_role, idempotente, aceita `aguardando|expirado`). Revenda: `processando→enviado→entregue|cancelado`; online passa por `revenda_checkouts` (simula com `__simulacao_ok__`; confirmar cria o pedido de verdade; `status='erro'+`mp approved` = dinheiro entrou sem pedido — tela admin).

## Cupons
`coupons`: tipo `pct` (1-100, dono revendedor) | `frete` (zera taxa; pode ser geral p/ delivery). Validação 100% server-side com `FOR UPDATE`. Delivery aceita só `frete` geral via `usar_cupom_frete` (2 args — exige migração 061 aplicada; 060 sozinha = overload ambíguo = checkout quebra). Cancelamento devolve (trigger `orders_cupom_status`, só UPDATE; DELETE não devolve). Cupom nunca desconta taxa (exceto tipo frete). PDV não tem cupom — `caixa_promocoes` é preço do dia aplicado no cliente (exceção consciente).

## Anti-abuso (062/063, deployadas)
`rate_check(p_key,p_max,p_janela_seg)` = upsert único, service_role only; baldes: `dlv-ip` 30/60s, `dlv-tel` 20/h, `dlvpay|rvpay` 40/h por token, `mpwh` 60/60s. `turno_ocupacao` conta não-pagos por **telefone distinto** (spam não sequestra vagas). Grants: anon sem acesso direto a `delivery_pedidos`/`revenda_checkouts`; authenticated só select/update (delivery) e select (checkouts) — **o painel admin usa PostgREST direto e QUEBRA se revogar de authenticated**.

## Armadilhas provadas nesta trincheira
1. `sb.rpc()` devolve `{data,error}` — objeto é sempre truthy; sempre `const { data } = ...` e comparar `=== false` (fail-open em erro). Bug real: limiter inerte em produção.
2. Guarda `if (!box.offsetParent) return` em card que nasce `hidden` = deadlock (nada desenha, zero erros no console). Bug real.
3. `schema.sql` é dump do banco VIVO compartilhado (Norte Interior); hoje é stub truncado — não recriar banco a partir dele sem regenerar.
4. Migrações: números colidem (060→2, 053→2 nos comentários); ordem real só em `list_migrations` no banco. 060_cupom → 061 → 062 → 063 obrigatória.
5. Tela "Financeiro pendente" (admin, aba Pedidos): G1 valor_divergente; G2 não-pago com pagamento registrado (botão "Conferir no MP" = reconciliação legítima via RPC); G3 estorno só para cancelado/expirado com approved|valor_divergente — entregue+approved é RECEITA; G4 revenda_checkouts erro.
6. Deploy: conferir vivo×repo antes de publicar (`get_edge_function` vs arquivo); functions têm `verify_jwt` próprios (revenda-pagar=true). Arquivos do repo: escrever só via python/Node UTF-8 — PowerShell corrompeu CLAUDE.md (UTF-16LE/base64/CP850) em 2026-11-17.

## Protocolo de mudança neste território
Briefing ≤6 perguntas; ordem grep→`tools/jev trechos`→leitura. Revisão estática NÃO basta: teste funcional de porta (burst 429, render real no browser/Playwright, `cron.job_run_details`). Índices em `delivery_pedidos`: criar só quando >~5k linhas (hoje ~10; seq scan é ótimo em 10 linhas). Contas de teste em `CONTAS-TESTE.local.txt` (admin-teste serve para E2E do painel). Hosting: GitHub Pages (pws.dupuroacai.com) — git push = deploy dos estáticos; functions/migrations via MCP.

## Contratos entre camadas (lição consolidada 2026-11-18)

Família de bug que dominou a semana: cada camada lê um campo que a camada vizinha não garante. Revisão estática NÃO pega — só teste funcional com dado real. Casos reais: filtro do admin lia `rotulado_em` ausente do select; destaque lia `analise_concluida` (coluna inexistente); sticky do qualificar-turno lia `oldRow.objecao` de um select que não trazia a coluna; CSAT lia motivos com `_` quando a RPC devolve com espaço; `data-error-text` sem CSS; cards nascendo `hidden` sem revelador; array posicional em RPC (PGRST102); `token` lido fora da IIFE.

Checklist ao mexer em qualquer par front↔banco↔Edge↔admin:
1. Todo campo lido por filtro/destaque/sticky PRECISA estar no select/query que alimenta a tela — conferir os DOIS lados no diff.
2. Elemento que nasce `hidden` precisa de revelador nomeado no diff (e um estado terminal nunca pode esconder o fallback — regra do skip do chat).
3. RPC via fetch cru: sempre objeto nomeado `{p_...}`; strings de erro do banco são contrato — o front casa EXATO ou normaliza dos dois lados.
4. Depois de TODO lote com código: teste funcional de porta real (UI clicada, burst de rate-limit, linha no banco) — estática aprovada não é evidência.
