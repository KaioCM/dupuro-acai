# Bastidores do assistente (Etapa 2 reduzida: F0, F1, F5, F6)

Edge `assistente` (`supabase/functions/assistente/`: `index.ts`, `logica.ts` funções puras, `fatos.ts` base de fatos confirmados). Deploy via MCP, `verify_jwt = true` (o anon key do site passa). CORS: www.dupuroacai.com, dupuroacai.com, pws.dupuroacai.com, localhost:8855.

## Contrato (POST JSON, headers `apikey` + `Authorization: Bearer <anon>`)
- `{acao:"iniciar", pagina:"home"|"revenda"|"delivery"}` → `{ok:true, token}` | `{ok:false, motivo:"limite_dia"}`
- `{acao:"mensagem", token, etapa:"abertura"|"duvida", texto}` →
  - abertura: `{ok:true, tipo:"intencao", intencao:"revender|consumir|provar|duvida|humano|incerto"}` (regra abaixo)
  - dúvida: `{ok:true, tipo:"resposta", texto}` ou `{ok:true, tipo:"humano", texto}`
  - `{ok:false, motivo:"limite_conversa|limite_dia|token_invalido|texto_invalido|erro"}`
- Erro/timeout do Jev (5 s) ou Haiku (8 s) → na dúvida `tipo:"humano"` com texto de reserva; na abertura `intencao:"incerto"` (log só com status).
- Textos fixos de `tipo:"humano"` (sem número de WhatsApp: o site sempre mostra o botão "Falar com uma pessoa"): sem-fato "Essa eu prefiro não chutar. Uma pessoa da equipe te responde certinho."; reserva/erro "Não consegui confirmar isso agora. Uma pessoa da equipe te responde."; saúde (pediatra/nutricionista) inalterado. Nunca 500.
- Texto: `<` e `>` são REMOVIDOS (o delimitador do prompt fica inviolável); vazio depois disso → `texto_invalido`.

## Abertura (J1 + J11), em ordem
(i) J1=humano >= 0,6 → humano; (ii) J11 >= 0,9 → humano; (iii) J1 em revender/consumir/provar/duvida >= 0,6 → essa intenção; (iv) J11 >= 0,8 → humano; (v) senão `incerto`. O texto enviado ao Jev vai SEM os marcadores `[contato]`/`[nome]` (`ultimo_texto` continua com eles).

## Dúvida (F1)
Pergunta de saúde (regex com contexto de saúde/pessoa; "pode dar desconto?" não conta) → texto fixo pediatra/nutricionista, sem número (o front mostra "Falar com uma pessoa"). Assunto [CONFIRMAR] (lactose, validade, mínimo R$ 20 do consumidor) → humano; "pedido mínimo" sem contexto de revenda (revend/atacado/litro/30 L/caixa) também → humano. Senão: J3 "respondível" (< 0,6 → humano) em paralelo com o Haiku (`claude-haiku-4-5`, 200 tokens, temp. 0,2, só com `fatos.ts`; `SEM_FATO` → humano); depois J4 "inventou" (>= 0,5 → humano). Defesas na resposta do Haiku: `stop_reason=max_tokens` → humano; link (`http(s)://`, `www.`), `@` ou sequência de >= 8 dígitos que não seja o WhatsApp (ou o CEP) dos fatos → humano. O prompt manda não citar telefone/WhatsApp/links salvo pedido explícito do contato e responder SEM_FATO quando a resposta depender de a pessoa ser revendedor ou consumidor. Preço, estoque, taxa e turnos não estão nos fatos: viram humano até a Etapa 4 ligar o banco.

## Limites
Tudo via `rate_check` (janela 86400 s, chave com o dia de America/Cuiaba quando global), **falhando fechado**: erro ou resposta diferente de `true` bloqueia (`limite_dia`/`limite_conversa`).
- `iniciar`: 10/IP/dia (`puri-ip:<hash>`) e teto global folgado de 200 criações/dia (`puri-new-<dia>`). Não consome o teto principal.
- `mensagem`: 60/IP/dia (`puri-ipm:<hash>`); 25/conversa (`turns` + `puri-tok:<token>`); **40 conversas/dia** contadas na PRIMEIRA mensagem de cada conversa (`puri-conv-<dia>`); **150 mensagens/dia globais** que chamam Jev/Haiku (`puri-global-<dia>`).
- IP: `cf-connecting-ip`, senão o ÚLTIMO valor de `x-forwarded-for`; IPv6 vira o prefixo /64, IPv4 inteiro. Hash SHA-256 com sal = SHA-256(`SUPABASE_SERVICE_ROLE_KEY` + 'puri'), nunca logado.
- Limpar testes: `delete from rate_buckets where key like 'puri-%'` (só chaves do assistente; as `pur-%` são da versão antiga).

## Privacidade
`mascarar()` (logica.ts) tira telefone, e-mail, CPF/CNPJ (`[contato]`) e nome (`[nome]`) antes de gravar e de chamar Jev/Haiku. `ultimo_texto` só guarda texto mascarado. O nome é mascarado inteiro: após "sou"/"aqui é" pega a sequência de palavras Capitalizadas com conectores (da, de, do, das, dos, e); após "meu nome é"/"me chamo"/"pode me chamar de" pega até 4 palavras em qualquer caixa. Logs só com status/código, nunca texto nem chave. Migrações `migration_072_puri_leads.sql` (`origem`, `pagina`, `intencao` em `qualificacao_leads`) e `migration_073_puri_checks.sql` (checks de `origem` = 'puri' e `intencao` nos 6 valores); RLS inalterada.

## Secrets
`TYPESAFE_API_KEY` (Jev), `ANTHROPIC_API_KEY` (Haiku); opcional `ASSISTENTE_MODELO` para trocar o modelo.

## Testar
POST com anon key (ver exemplos no relatório da Etapa 2). Funções puras: `node` roda `logica.ts` direto (Node 24, sem Deno instalado). Cada chamada de dúvida custa Jev + Haiku. Apagar as linhas de teste: `delete from qualificacao_leads where token = '...' and origem = 'puri'`.

## `qualificar-turno`
Desativada em 2026-11-19 (stub 410, sem tocar no banco); substituída por esta Edge.

## Falta (Etapa 4)
F2 consumir (dados ao vivo), F3 visita, F4 revenda (H2–H7, J2, J5–J10), `escutar`, `visita`, `catalogo`, `converter`, fatos de preço/taxa/turnos do banco.

## Log de motivo (monitoramento sem dado pessoal)

Cada saída de `mensagem` escreve uma linha JSON: `{"ev":"puri","etapa":"abertura|duvida","tipo":"...","motivo":"..."}`; na abertura vai também `"intencao"` (a decidida). Nunca texto do usuário, token, IP ou resposta.

Códigos de `motivo`: `ok` (resposta do Haiku aprovada, ou abertura classificada), `saude`, `pendente` ([CONFIRMAR]/mínimo sem contexto), `j3_baixo` (Jev: fatos não cobrem), `sem_fato` (Haiku devolveu SEM_FATO ou vazio), `max_tokens` (Haiku cortou), `suspeita` (link/@/telefone na resposta), `j4_inventou`, `jev_falhou` (erro/timeout do Jev; na abertura vira `incerto`), `haiku_falhou` (erro HTTP do Haiku; timeout do Haiku cai em `jev_falhou`), `limite_ip_dia`, `limite_conversa`, `limite_conversas_dia`, `limite_global_dia`, `token_invalido`, `texto_invalido`.

Consultar: MCP `query_logs` (janela <= 24 h), `select timestamp, event_message from logs where source='function_logs' and event_message like '%"ev":"puri"%' order by timestamp desc`. Contar por motivo: filtrar e agrupar em `event_message`.
