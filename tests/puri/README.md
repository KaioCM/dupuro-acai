# Bateria de testes da Puri

Mede o comportamento da assistente (Edge Function `assistente-dev` ou `assistente`) em casos fixos, sem usar IA para avaliar.

## Como rodar

```
python bateria.py --alvo dev                  # padrão: Edge de desenvolvimento, driver v2
python bateria.py --driver v1                 # protocolo antigo
python bateria.py --autoteste                 # offline: detectores + sequência de chamadas do driver_v2 com respostas simuladas
python bateria.py --casos wikipedia,rio       # só alguns casos
python bateria.py --alvo prod --confirmo-prod # produção: GASTA a cota de clientes
python bateria.py --comparar resultados/A.json resultados/B.json   # atual x nova, lado a lado
```

Só biblioteca padrão do Python (3.12). Não use `-I`.

## Arquivos

- `casos.json`: os casos (entradas + comportamento esperado da Puri nova + checagens).
- `bateria.py`: executa, avalia (PASSOU / FALHOU / REVISAR / ERRO_TEC) e grava os resultados. `driver_v2` (PADRÃO) fala o protocolo novo da revenda (`docs/assistente/ETAPA2-CONTRATO.md`); `driver_v1` fala o protocolo antigo e continua disponível com `--driver v1`.
- `resultados/AAAA-MM-DD-HHMM-<alvo>.json` (tudo: requisições, respostas, tempos, tokens) e `.md` (tabela + conversas legíveis).

## driver_v2 (revenda nova)

Sequência: iniciar, segmento (confiança < 0,7: escolhe a 1ª sugestão), qualif ja_vende, cidade (fora de Cuiabá/VG: pergunta de retira; 'não' grava lista_espera com dados fictícios do caso e encerra), escutar final (nao_acai: confirma_acai com o valor do caso; 'nao' encerra), perfil (retira se for o caso; esclarecer: esclarecer_resp com o texto do caso ou pula), opcoes_compra, qualif compra, simulacao, qualif comeco/papel/conheceu, aprofundar (+ resposta), palpite (+ palpite_resp; com alternativas, palpite_escolha com `alternativa_indice` do caso ou null), resumo (+ resumo_resp 'ok' ou 'corrigir'), mapa (+ mapa_ok, ou `{pulou:true}` se o caso tiver `mapa.pular`). Texto digitado em passo de botões (ex.: movimento) vai ao passo `interpretar`. Abertura com texto livre: `mensagem` etapa 'abertura' e as `acoes` devolvidas ficam em `eventos.acoes`.

Entradas opcionais nos casos de revenda: `retira`, `lista_espera`, `confirma_acai`, `esclarecer_resp`, `compra`, `ja_vende`/`comeco`/`papel`/`conheceu`, `palpite.alternativa_indice`, `resumo {resp, texto}`, `mapa {pular}`. Checagens novas: `flag` (campo neutro ou evento; `opcional:true` só informa) e `evento` (chave/igual).

### Casos de revenda e o que testam

- `bola_jogar`, `bola_vender`: objetivo sem relação com açaí; esperado `nao_acai` (pediu_confirmacao) e, com confirma_acai 'nao', encerra sem chegar ao mapa.
- `rio`: Rio de Janeiro, retira 'não'; lista de espera gravada (fictícia), fora_area, não segue.
- `rio_retira`: Rio de Janeiro, retira 'sim'; segue com fora_area e retira=true até o fim.
- `movimento_digitado`: "uns 30 por dia" via `interpretar` vira `20a50`, sem "Escolhe uma das opções."
- `palpite_absurdo`: objetivo sem relação com açaí; o palpite não inventa (revisão humana).
- `revenda_completa_acaiteria`: ponta a ponta; espera termo no resumo e mapa (cena e mapa simples opcionais).
- `esclarecimento_sorveteria`: sorveteria, Cuiabá, 100+ copos; espera `esclarecer` no perfil.
- `palpite_corrigido`: palpite 'não' com texto; alternativas opcionais; segue até o fim.
- `tramontina` (abertura): espera `acoes` ['revender','consumir'] e pergunta de texto.
- `provar_outra_cidade`: só o texto fixo do front (fábrica ou revender retirando).

O `driver_v2` ainda não foi rodado contra a API (só offline com respostas simuladas); rodar contra o dev quando o servidor novo estiver publicado.

## Cuidados

- Cada caso abre uma conversa (lead). O dev aceita ~40 conversas por dia e 150 mensagens/dia; a bateria usa cerca de 25 conversas. Não rode várias vezes no mesmo dia.
- Produção: só com `--confirmo-prod`; consome a cota real de clientes.
- Os leads de teste ficam na tabela `qualificacao_leads` (origem `puri`). Os tokens criados estão em `tokens_criados` de cada `.json`, para limpeza posterior.
- Trechos que o front responde sozinho (cidade, bairro, "Escolhe uma das opções.", provar/outra cidade) são reproduzidos pelo driver e marcados como "texto fixo do front".
- Chamada lenta (acima do limite do front: 10 s mensagem/segmento/perfil/escutar/simulacao; 25 s aprofundar/palpite/resumo/mapa/mapa_ajuste) é marcada como LENTO no relatório.
- `--reavaliar X.json` reaplica as checagens atuais sobre as conversas gravadas, sem chamar a API, e regrava `.json`/`.md`. `--juntar` recusa arquivos de alvos diferentes.

## Limitações conhecidas do driver_v1

- Não reenvia a mensagem quando o servidor responde `token_invalido` (o front reenviaria) e não simula o rascunho de escuta do front.
- `provar_outra_cidade` testa só os textos fixos do front (não chama o servidor).
- Checagens por regex: `PASSOU` não garante qualidade; casos com `revisar` pedem leitura humana. `revenda_confirma_intencao` nunca dá PASSOU sozinha (se achar a pergunta, vira REVISAR).
- Campos neutros da `Sessao` (`encaminhou`, `fora_area`, `pediu_confirmacao`) são preenchidos pelo driver; o `driver_v2` os preenche igual (`pediu_confirmacao` = `nao_acai` recebido ou pergunta de confirmação) e acrescenta `retira`, `lista_espera_ok`, `esclarecer_recebido`, `cena_recebida`, `alternativas_recebidas`, `termo_recebido`, `mapa_simples`.

## Limpeza dos leads de teste

Tokens em `tokens_criados` de cada `.json`. No SQL editor do Supabase (apague só depois de conferir):

```sql
delete from qualificacao_leads where token in ('TOKEN1', 'TOKEN2');
```

- Nenhuma chave vai para os resultados (a anon key é lida de `assets/js/supabase-config.js` e não é gravada).
