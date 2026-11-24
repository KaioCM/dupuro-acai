# Etapa 3 — contrato chat (puri.js) × servidor (Edge assistente): destinos

Fonte: plano em referencias/reforma-puri/04-PLANO-DEFINITIVO.md (§13 B5 e B13). Este arquivo manda: front, servidor, banco e admin implementam exatamente isto. Campos novos são opcionais para o outro lado (compatibilidade). Continua valendo o contrato da Etapa 2 (ETAPA2-CONTRATO.md).

## 1. Visão
Depois do mapa (passo `mapa_ok`, inclusive quando a pessoa pula o mapa), o navegador chama o passo novo `destino`. O servidor decide 1 de 5 destinos e o navegador mostra a tela final daquele destino.

| Destino | Quando |
|---|---|
| `contato_rapido` | caso quente: a equipe chama a pessoa |
| `visita` | Cuiabá/VG e a pessoa ganha em provar antes |
| `cadastro` | caminho normal: criar a conta |
| `delivery` | compra para consumo próprio |
| `lista_espera` | fora da área, sem retirada na fábrica |

## 2. Banco: migração 081
Em `qualificacao_leads`:

| Coluna | Tipo | Regra |
|---|---|---|
| `destino` | text | CHECK: null, 'contato_rapido', 'visita', 'cadastro', 'delivery', 'lista_espera' |
| `destino_em` | timestamptz | quando o destino foi decidido |
| `esforco` | smallint | CHECK entre 0 e 3 |
| `atendido_em` | timestamptz | quando o Kayo marca o caso quente como atendido |

- Índice em `destino`.
- RPC `admin_lead_atendido(p_lead uuid)`: security definer, só admin (`is_admin()`), grava `atendido_em = now()`. `grant execute` só para authenticated; sem anon.
- Configuração `puri_aviso_admin` (id da conta do Kayo) em `app_settings`. Ajustar ao formato de app_settings.
- Os CHECKs atuais de `status`, `fluxo` e `intencao` não mudam.

## 3. Servidor: passo `destino` (ação `revenda`)
- **Entrada:** `{token, passo:'destino'}`.
- **Idempotente:** se o lead já tem `destino`, devolve o mesmo.

### Esforço (só código, 0 a 3)
Soma de três pontos:
- +1 se passaram 3 minutos ou mais desde `criado_em`;
- +1 se a pessoa detalhou: objetivo/escuta com 60 caracteres ou mais, ou resposta do aprofundar que não seja 'nao_sei'/'pulou';
- +1 se respondeu pelo menos 4 das 5 perguntas de qualificação sem 'pulou'/'nao_sei'.

### Prioridade
A função atual `prioridadeLead` (J10) passa a rodar para TODOS os leads aqui, com o esforço no estado enviado ao Jev. Hoje ela só roda no `converter`.

### Regras do destino (na ordem)
| | Destino | Condição |
|---|---|---|
| a | `lista_espera` | `anotacoes.lista_espera`. Na prática esse fluxo termina antes; é por garantia. |
| b | `delivery` | o Jev, com a pergunta noul `JEV_CONSUMIDOR`, diz com nota ≥ 0,8 que a pessoa compra para consumo próprio e não para revender. |
| c | `contato_rapido` | (1) `qualif.ja_vende = 'ja_vendo'`, `movimento` em `50a100` ou `100mais`, e `coerente` diferente de false; **ou** (2) o Jev, com a pergunta noul `JEV_PONTO_DEFINIDO`, diz com nota ≥ 0,8 que a pessoa está montando loja ou ponto de açaí com local definido, e `qualif.comeco` é 'esta_semana' ou 'este_mes'. |
| d | `visita` | cidade Cuiabá ou Várzea Grande (`normalizarCidade` / `CIDADES_VISITA`) e o Jev, com a pergunta noul `JEV_PROVAR`, diz com nota ≥ 0,6 que a pessoa ganha em provar antes (nunca vendeu açaí, está em dúvida ou está comparando fornecedor). |
| e | `cadastro` | caso contrário. |

- Os limiares ficam em `LIMIARES`.
- Ao Jev vão só dados mascarados: segmento, movimento, qualif, tópicos, objetivo mascarado. Nunca dado pessoal.
- Se o Jev falhar ou estourar o tempo, a pergunta conta como "não" e segue para a próxima regra.
- **Grava:** `destino`, `destino_em`, `esforco` e `prioridade`, mais `jev_log` sem texto do cliente.
- **Devolve:** `{ok:true, destino, visita:{cidade, bairro}}`. O `visita` só vem quando o destino é `visita` ou quando a cidade é Cuiabá/VG, para preencher a visita.

## 4. Servidor: passos novos
- `contato` — o "Só quero que me chamem" do destino A.
  - Entrada: `{nome, telefone}`.
  - Validação e limite por IP iguais aos de `lista_espera` (`validarListaEspera`, limite diário).
  - Grava `nome`, `telefone` e `anotacoes.so_contato = true`.
  - Devolve `ok` / `ja_registrado` / `dados_invalidos` / `limite`.
- `conversao_falhou` — o navegador chama quando o `converter` falha mesmo depois das tentativas. Grava `anotacoes.conversao_falhou = true`.

## 5. Servidor: ajustes no `converter`
- Em caso de sucesso, também copia `nome` e `telefone` de `profiles` para `qualificacao_leads`, pelo servidor, com service role. Assim o admin tem o WhatsApp do caso quente.
- Não recalcula o destino.

## 6. Navegador: telas finais (`assets/js/puri.js`)
Depois de `mapa_ok`, o navegador chama `destino` e mostra os pontos de espera. Se falhar ou passar do tempo, cai em `cadastro`. O destino fica salvo em `E.r.destino` (estado `puri:v2`). Toda tela final tem os chips "Ver o resumo do caso" (reexibe o cartão do resumo e o último mapa) e "Começar de novo".

| Destino | Fala | Chips |
|---|---|---|
| `contato_rapido` | "Pelo que você contou, seu caso é prioridade pra gente." | "Criar minha conta": cadastro completo; no sucesso mostra "[Primeiro nome], seu caso já está com o nosso time; a gente te chama no WhatsApp em até 24 horas úteis." / "Só quero que me chamem": pede nome e WhatsApp, chama o passo `contato`; no ok mostra "Anotei, [Primeiro nome]! A gente te chama no WhatsApp em até 24 horas úteis." |
| `visita` | "Que tal provar antes? Um vendedor leva amostras grátis até você, de segunda a sexta, das 8h às 17h." | "Quero receber a visita": entra na visita com cidade/bairro já preenchidos, pula os passos já respondidos e NÃO apaga o caso (`E.r`) / "Prefiro criar a conta direto": vai para `cadastro`. |
| `cadastro` | as regras atuais (`T_REGRAS`) | "Criar minha conta" / "Quero provar antes", só se a cidade for Cuiabá/VG, que vai para a visita preenchida / "Falar com uma pessoa". |
| `delivery` | "Pelo que entendi, é pra consumo seu. O delivery é o caminho mais rápido." | "Abrir o delivery" (link) / "Na verdade quero revender", que vai para `cadastro`. |
| `lista_espera` | sem mudança | sem mudança |

## 7. Navegador: cadastro
- O nome é normalizado: trim, espaços colapsados, primeira letra de cada palavra maiúscula.
- `empresa` recebe o rótulo do segmento da conversa.
- `cidade` usa a cidade da conversa.
- O resultado do `converter` passa a ser conferido. São até 2 novas tentativas. Se ainda falhar, a mensagem é "Sua conta foi criada! Não consegui ligar esta conversa a ela, mas o time vai ver do mesmo jeito.", e o navegador chama `conversao_falhou`.
- Se o Supabase exigir confirmação de e-mail, o signup não devolve token. Nesse caso a mensagem passa a ser "Conta criada! Confirme seu e-mail para entrar." **Depende da conferência** (ainda não verificado se o projeto exige confirmação).

## 8. Admin (`area-cliente/admin.html` e `assets/js/admin.js`)
- A lista "Leads da Puri" ganha a coluna Destino (rótulos em português) e o esforço.
- Ordem da lista: `contato_rapido` não atendido primeiro, por prioridade; depois visitas pedidas; depois o resto.
- O botão "Chamar no WhatsApp" (wa.me) aparece em todo lead com telefone.
- A tag "Conta sem vínculo" aparece quando `anotacoes.conversao_falhou`.
- Só para o Kayo, quando o id do usuário logado for igual a `puri_aviso_admin`:
  - selo "Prioridade" nos `contato_rapido` não atendidos;
  - botão "Marcar como atendido", que chama a RPC `admin_lead_atendido`;
  - no Início, um item "Casos quentes da Puri" com a contagem de `contato_rapido` não atendidos.
- A Dilene vê a lista normal, sem selo e sem contador.
- Para testar, o parâmetro de URL `?puri_amb=dev` faz a lista mostrar `ambiente='dev'` em vez de `'prod'`. Só no admin, que já é restrito.

## 9. Bateria
Casos novos, com perfis diferentes chegando a destinos diferentes:

| Perfil | Destino esperado |
|---|---|
| já vende 100+ por dia | `contato_rapido` |
| nunca vendeu e está em Cuiabá | `visita` |
| outra cidade que retira na fábrica | `cadastro` |
| consumo próprio | `delivery` |

Checagem nova: `destino_igual`.

## 10. Regras que valem
- Dados pessoais nunca vão para a IA nem para o log.
- Produção (Edge `assistente`) intocada até a Etapa 6.
- Toda tela usa `textContent`/`esc`.

## Registro
Toda decisão do Jev desta etapa vai para jev_log (rótulo, valor, efeito; sem texto do cliente).
