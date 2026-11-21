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

## Ajustes da revisão da etapa 4 (v6)

- Visita: a cota por IP (`puri-vis:`) só é consumida logo antes de gravar; token inválido, `ja_pedida`, `dados_invalidos` e `cidade_fora` não gastam cota.
- Mensagem: quando Jev/Haiku falham, o turno do usuário ainda é gravado no histórico (sem resposta).
- Telefone: `normalizarTelefone` exige DDD 11 a 99, 11 dígitos com 3º dígito 9 e rejeita dígito único repetido (ex.: 0000000000).

## Mínimo do delivery (v7, 2026-11-20)

- Pedido mínimo de R$ 20 do delivery entrou nos fatos; `ehPendente` só segura lactose/validade; "pedido mínimo" sem contexto é respondido pelo Haiku com os dois (R$ 20 delivery, 30 L revenda).

## Ação revenda (4B-1, v10, 2026-11-20)

`POST` com `{"acao":"revenda","token","passo":...}`. Exige `token` de lead `origem='puri'` (senão `token_invalido`). Todo passo grava `fluxo='revender'` e `intencao='revender'` (o CHECK do banco só aceita `revender`, não `revenda`). Erros: `{ok:false,motivo}` com `token_invalido`, `texto_invalido`, `dados_invalidos`, `limite_*`, `erro`.

| passo | entrada | saída | grava | IA |
|---|---|---|---|---|
| `segmento` | `texto` (mascarado) | `{ok,segmento}` | `segmento`, `negocio` (≤120, mascarado) | J5 (choice; sem os marcadores). Falha/prob. < 0,5 → `outro`. Conta como mensagem (+1 `turns`). |
| `perfil` | `segmento` (da lista), `cidade` 2–60, `bairro?` 2–60, `movimento` (`ate20`/`20a50`/`50a100`/`100mais`) | `{ok,fora_area,coerente}` | `cidade`, `bairro`, `movimento`, `segmento`, `coerente` | J9 (noul ≥ 0,5 → true; falha → null; não bloqueia). Ao Jev vão SÓ segmento, movimento e "Cuiabá/VG" ou "fora"; cidade e bairro nunca vão a IA. `fora_area` = cidade não é Cuiabá/VG (mesma normalização da visita). |
| `escutar` | `texto`, `final` | `{ok,anotacoes:[...]\|null}` | com `final:true`: `anotacoes` `{quer (≤500 mascarado), topicos[]}` + `historico` | `final:false`: J2 "suficiente" (≥ 0,7) → H2 (Haiku, JSON de 2–4 tópicos ≤ 8 palavras). `final:true`: pula J2 e roda H2 se o texto tiver ≥ 15 caracteres. Timeout/erro → `anotacoes:null`. |
| `simulacao` | `preco_copo` 18–20 (arredonda) | `{ok,simulacao}` | `simulacao` jsonb | Nenhuma. Servidor calcula: custo = "Caixa de Açaí 10 L" atacado (mesma busca do `catalogo`), 20 copos/caixa, copos/dia por movimento (10/35/75/120), 6 dias/semana. Exige `movimento` gravado (senão `dados_invalidos`). |

Limites: `segmento`, `perfil` e `escutar` com `final:true` passam pelos mesmos limites da `mensagem` (IP/dia, conversa 25, conversas/dia, global/dia; falha fechada). `escutar` com `final:false` (rascunho) NÃO passa por esse portão e não gasta `turns`: exige texto mascarado ≥ 25 caracteres (senão `anotacoes:null` sem custo) e usa cotas próprias, falha fechada: `puri-esc:<token>` máx 4, `puri-escip:<hash ip>` máx 40/dia, `puri-escg-<dia Cuiabá>` máx 300/dia; estourou → `{ok:true,anotacoes:null}` (silencioso). `simulacao` só checa a cota de conversa (`puri-tok`). `segmento`, `perfil` e `escutar` final incrementam `turns` (perfil conta como mensagem, pois consome `puri-conv`/`puri-tok`). Os tópicos do H2 passam por filtro (descarta o que tiver link, e-mail ou telefone) e depois por `mascarar()`.

Vai à IA: texto livre mascarado (telefone/e-mail/CPF/nome trocados, `[contato]`/`[nome]` removidos para o Jev) e os ids de segmento/movimento. Não vai: cidade, bairro, nome, telefone. Log: só códigos curtos (`ev:puri, etapa:revenda, passo`), nunca texto.

`IPS_LIVRES` (index.ts): hashes de IP liberados dos limites POR IP (`puri-ip`, `puri-ipm`, `puri-cat`, `puri-vis`, `puri-escip`); globais e por token continuam valendo. Hoje: a máquina do Kayo (2026-11-20); se o provedor trocar o IP, atualizar o hash.

## Revenda 4B-2 (aprofundar, palpite, resumo; 2026-11-20)
Mesma ação `revenda` (token de lead `puri`), mesmos limites da `mensagem` (portão: turns, IP, token, conversas/dia, global; falha fechada). Cada passo conta 1 turno. `anotacoes` (jsonb) é mesclada, nunca sobrescrita.
- `aprofundar` (sem corpo extra): H3 gera 3 perguntas candidatas, J6 escolhe 1. Resposta `{ok, pergunta, respostas[3-4]}`; falha ou sem `anotacoes.quer` → `{ok, pergunta:null}`. Grava `anotacoes.aprof_pergunta`.
- `aprofundar_resp` `{texto}` (1–300): grava `anotacoes.aprof_resposta` (mascarada) e no histórico. Resposta `{ok}`.
- `palpite`: H4 escreve "Meu palpite: ... Acertei?", J7 (`inventa`) barra se ≥ 0,5. Resposta `{ok, palpite}` (`null` se barrado/falhou). Grava `anotacoes.palpite`. O motivo da falha sai no log `palpite_diag` (`haiku_nulo`, `parse_rejeitou`, `j7_alto` + noul).
- `palpite_resp` `{valor: mosca|parte|nao, texto?}`: grava `palpite_valor` e `palpite_correcao` (mascarada, ≤ 300). Resposta `{ok}`.
- `resumo`: H5 devolve JSON `{resumo, problema}` (2ª pessoa; problema ≤ 5 palavras). Resposta `{ok, resumo, problema}` (`resumo:null` se falhou). Grava `resumo` e `anotacoes.problema`.
- O que vai à IA (`contextoRevenda`): só rótulo do segmento, rótulo do movimento, `quer`, tópicos, pergunta+resposta do aprofundar e (no resumo) palpite/reação/correção. Nunca nome, telefone, cidade nem bairro. Tudo passa por `limparIA` (sem `<>`, mascarado, cortado).
- Filtros de saída (`logica.ts`): `parsePerguntasAprof`, `parsePalpite`, `parseResumo` descartam link, e-mail, número de 6+ dígitos e `[contato]`; limites de tamanho/palavras. J7 foi reescrito (2026-11-20): a versão "inventa coisas que a pessoa não disse" barrava todo palpite (um palpite é inferência por natureza); agora barra só fato da empresa ou detalhe sem relação com o que a pessoa disse.
- Histórico separado (2026-11-20): `historico` só guarda turnos de abertura e dúvida. Os textos de `escutar` e `aprofundar_resp` ficam só em `anotacoes` (antes vazavam para o Haiku da dúvida: depois de falar de freezer, "qual o horário?" recebeu texto de conservação).

## Dúvida: blindagem contra assunto pendente (2026-11-20)
- Prompt do Haiku: responder SÓ à pergunta atual; histórico só para entender referências; nunca acrescentar o que não está nos FATOS.
- `ehPendente` agora também cobre freezer, congelar, conservar, estragar, armazenar, guardar, derreter (→ humano direto).
- Checagem determinística `respostaForaDoAssunto` (logica.ts): se a resposta cita freezer/congel/validade/vencim/lactose/leite/estrag/conserv/armazen e a PERGUNTA atual não é sobre isso → humano (motivo de log `fora_do_assunto`).
- J4 recebe `pending_topics_not_in_facts` e é instruído a responder "sim" se o rascunho tocar nesses assuntos.

## Ação converter (2026-11-20)
`{acao:'converter', token, access_token}` → `{ok:true}` | `{ok:false, motivo:'token_invalido'|'sessao_invalida'|'ja_convertido'|'erro'}`.
- Valida token (`origem='puri'`), `sb.auth.getUser(access_token)` (service_role) e `profiles` com esse id, `role='revendedor'`, criado há ≤ 30 min; senão `sessao_invalida`. Lead com `lead_profile` → `ja_convertido`.
- Grava `lead_profile = user.id`, `status='convertido'`, `prioridade` (smallint 0–3). O `access_token` não é guardado nem logado; e-mail nunca é lido.
- Limite `puri-conv2:<token>` máx 3 (falha fechada, devolve `erro`).
- J10 (`prioridadeLead`, choice p0–p3): esforço + interesse + encaixe a partir de segmento, movimento, `coerente`, tópicos, se respondeu o aprofundar e reação ao palpite. Sem dados pessoais. Falha → `prioridade` null.

## Ajustes da revisão da etapa 4 (v11, 2026-11-20)
- `respostaForaDoAssunto`: "leite" solto saiu (pegava "Doce de Leite"); ficam lactose e "sem leite".
- `fatos.ts`: conservação (freezer, recongelar) saiu dos fatos; conservação e validade ficam PENDENTES até o dono confirmar (a base-de-fatos.md ainda os lista como confirmados: decisão do dono).
- `ehPendente`: guardar/armazenar/vencer só contam com contexto de alimento (açaí, creme, caixa, produto, freezer, congelar); "guardar o pedido" e "vence o boleto" não são pendentes. `ehSaude`: `\bpressão` (não casa "impressão").
- `revenda`: o log de falha só grava `passo` se estiver na lista de passos, senão `?`. `escutar` final mescla com as anotações existentes. `perfil` faz um único update (dados + turns). `palpite_resp` rejeita texto > 300 (como `aprofundar_resp`).
- `converter`: se já existe outro lead com `lead_profile` = a conta, devolve `ja_convertido` (1 lead por conta).
- Prompt do Haiku da dúvida: no máximo 2 frases e só o que a pergunta atual pede, sem outros assuntos do histórico.
- Limite aceito: texto livre só passa por `mascarar()`; cidade/bairro ditos em prosa podem chegar à IA.

## Ambientes
- `assistente-dev`: desenvolvimento e testes. O front local (localhost, `?puri=edge`) chama `functions/v1/assistente-dev`; `?puri=prod` em localhost força a produção. Mesmas tabelas e secrets; use tokens de teste e apague o lead e as chaves `puri-tok:`/`puri-esc:` depois.
- `assistente` (produção): só no publicar. Trava: deploy com os 3 arquivos completos (`index.ts`, `logica.ts`, `fatos.ts`) + teste de fumaça (iniciar, mensagem, revenda) logo depois. Volta = redeploy do HEAD do git.

## Visuais (Etapa 5A)
- **Seu caso:** coluna à direita com painel largo (≥900px sem pointer coarse), ou aba recolhível; mostra os campos coletados; nada pessoal é persistido; "O que quer" vem da última anotação, só em memória.
- **Barras do simulador:** barras comparando cenários de revenda dentro do chat, calculadas no navegador.
- **Cena neon:** dados `CENAS` por segmento, desenhados em SVG com `stroke-dashoffset`; posição registrada em `E.r.cenaI`.
- **Pixel art:** N = 10/35/75/120 pelo meio da faixa de movimento; Path2D sobre `CENAS` vira partículas (máx. 900); rAF único de ~2,5 s; em reduced motion ou redesenho, só o quadro final; posição em `E.r.pixI`. A legenda é `aria-hidden` (o contador muda a cada quadro); o `aria-label` do canvas informa o valor.
- **Fallbacks:** tudo em try/catch; falha visual nunca quebra a conversa (exceção no rAF cai no quadro final e libera `_anim`).
- **z-index:** painel 1100, acima do header 1000.
- **Pendência:** o mapa do caso (5B, com IA no servidor).
