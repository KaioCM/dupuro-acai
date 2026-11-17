---
name: dupuro-checkout
description: Regras, arquitetura e checklist de qualidade para checkout do delivery Dupuro. Usa Mercado Pago + pagar na entrega (Pix/Cartão) via Checkout Pro. Cobrir triângulo: API → Frontend → Edge Function, com atenção ao estado, rede instável e falha de pagamento. Validação manual antes de aprovar; sem teste em dispositivo real ainda. TRINCHEIRA 1: checkout MP (Mercado Pago) | TRINCHEIRA 2: gateway host & deploy GitHub Pages | TRINCHEIRA 3: CTA WhatsApp fallback quando checkout não converte.

## Contexto do negócio
- Delivery de açaí/cremes em Cuiabá-MT. Prime Pix pago e entregue: DLW-0020, 2026-11-10.
- Checkout usa Mercado Pago (Checkout Pro) com opção "pagar na entrega".
- Domínio hospedado no GitHub Pages (pws.dupuroacai.com ou domínio customizado configurado via DNS/CNAME).
- **TRINCHEIRA 1 (G3):** Checkout online com MP — validar link da SDK MP, payload, callback webhook, tratamento de erro 4xx/5xx, redirecionamento pós-pagamento.
- **TRINCHEIRA 2 (hosting):** Site hospedado em GitHub Pages (domínio pws.dupuroacai.com). Sem servidor backend próprio. Edge Functions Supabase tratam lógica server-side (auth, RPCs).
- **TRINCHEIRA 3:** Se checkout falhar ou usuário desistir, CTA deve direcionar ao WhatsApp (5565992888228) como fallback — nunca deixar usuário sem saída.

## Arquitetura
1. `delivery/checkout.html` — formulário (itens, endereço, forma de pagamento). Integra com MP JS SDK (MercadoPago.setPublishingKey, createPreference, initBrick).
2. Edge Function (Supabase) — cria preference no MP (via SDK Node/REST), armazena preference_id no pedido.
3. Webhook MP — notifica status do pagamento; atualiza pedido (paid/pending/cancelled).
4. Fallback: botão WhatsApp no checkout para pedir atendimento manual.

## Checklist de validação manual
- [ ] Preference criada corretamente (valores, itens, metadados): POST /v1/preferences body válido.
- [ ] Brick/Pix aparece no checkout e gera QR code/copiable reference funcional.
- [ ] Pagamento Pix confirmado → webhook chega → pedido marcado paid.
- [ ] Primeiro Pix pago e entregue (DLW-0020) reproduzível no fluxo.
- [ ] Falha de pagamento (declined/expired) mostra mensagem clara + botão retry ou WhatsApp fallback.
- [ ] Pagar na entrega: pedido criado com status pending_payment, recebe código rastreio.
- [ ] Mobile: layout responsivo, botão CTA fixo visível.
- [ ] Verificar se hosting GitHub Pages está apontando para domínio correto (DNS/CNAME).
- [ ] Sem emoji em botões de ação (segurança/regra sempre).

## G3 — Checklist de qualidade (G3)
- [ ] Preferencias MP criadas sem dados sensíveis expostos (API key em secrets EF, nunca no client).
- [ ] Tratamento completo de erros HTTP: catch network, parse JSON err, show motivoErro().
- [ ] Estado local sincronizado com banco: após pagamento, reler pedido via RPC.
- [ ] Nenhum innerHTML cru vindo do banco (usar esc()).
- [ ] Sem hard-coding de chaves no git; tudo em Edge Function secrets.
- [ ] Loading states nos botões para evitar double-submit.

## Hosting (GitHub Pages)
- Site serve conteúdo estático (`index.html`, `delivery/`, etc.).
- HTTPS via GitHub Pages (automático); certificado Let's Encrypt integrado.
- Deploy via push para main → automatic deploy. Verificar branch source (.github/workflows/ ou setting).
- Subdomínio: pws.dupuroacai.com → aponta para `<user>.github.io/dupuro-acai`.
- Não há build step; editar HTML/CSS/JS → push → deploy automático.

## Observações críticas
- Checkout é o momento mais frágil da jornada do revendedor/cliente. Priorizar diagnóstico rápido.
- Testes limitados a navegador desktop; nenhuma validação em dispositivo real ainda (P0 lacuna conhecida).
- Webhook MP precisa ser tolerante a reentrância (status já processado = noop seguro).
