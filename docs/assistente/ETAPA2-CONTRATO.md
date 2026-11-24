# Etapa 2 — contrato chat (puri.js) × servidor (Edge assistente)

Fonte: plano em referencias/reforma-puri/04-PLANO-DEFINITIVO.md (§5, §6 Revender, §13 B2, B12). Este arquivo manda: front e servidor implementam exatamente isto. Campos novos são opcionais para o outro lado (compatibilidade).

## Ordem da revenda (front)
1 segmento → 2 ja_vende → 3 cidade (fora da área: "Consegue retirar na fábrica em Cuiabá?" → Sim segue com retira=true; Não → formulário lista de espera → fim gentil + menu) → 4 bairro → 5 objetivo (escuta ao vivo; servidor pode pedir confirmação de açaí; cena) → 6 movimento (pixel) → perfil (coerência; pode pedir esclarecimento) → 7 compra (opções vindas do servidor) → 8 simulador → 9 comeco → 10 papel → 11 conheceu → 12 aprofundar (só se o servidor mandar pergunta) → 13 palpite (com alternativas) → 14 resumo (confirmação) → 15 mapa (ajustar até 2 / pular) → 16 regras + conta (final atual; destinos vêm na Etapa 3).
Barra de progresso: "Passo N de 16 · faltam ~M" (passos pulados contam como feitos).

## Saídas em todo passo de botões
Sempre presentes: "Escrever com as minhas palavras" (foca o campo), "Não sei, e tudo bem" (valor 'nao_sei'), "Prefiro pular esta" (valor 'pulou'). Texto digitado num passo de botões → passo `interpretar`. Se `escolha` vier null: a Puri diz "Não entendi direitinho. Toca numa das opções ou escreve de outro jeito." e repete os botões UMA vez; na segunda falha, aceita como texto livre (valor 'texto' + o texto) e segue.

## Abertura ambígua
Ação `mensagem`, etapa 'abertura': quando o Jev não tem certeza entre revender e consumir (ou a frase fala de empresa/trabalho sem dizer o que quer), o servidor responde `{ok:true, tipo:'resposta', texto:'Você quer revender açaí ou comprar pra você?', acoes:['revender','consumir']}` em vez de abrir um caminho.

## Ação `revenda` — passos (todos com `token`; erros como hoje: {ok:false, motivo})
- `segmento` {texto} → {ok, segmento, confianca, sugestoes?: string[3]} — confianca ≥ 0,7: front aceita ("Anotei: …"); abaixo: front mostra as 3 sugestões + "Outro".
- `interpretar` {etapa, texto, opcoes:[{id, rotulo}]} → {ok, escolha: id|'nao_sei'|'pulou'|null, confianca}. Jev escolhe entre as opções + nenhuma; sem Haiku. Não soma turno.
- `qualif` {campo:'ja_vende'|'compra'|'comeco'|'papel'|'conheceu', valor: id|'nao_sei'|'pulou'|'texto', texto?} → {ok}. Só código; grava em anotacoes.qualif (texto mascarado, máx. 200).
  - ja_vende: 'ja_vendo' | 'quero_comecar' | 'outras_coisas'
  - compra (opções vêm de `opcoes_compra`): ids 'testar_1cx' | '30l_mais' | 'nao_sei'
  - comeco: 'esta_semana' | 'este_mes' | 'pesquisando'
  - papel: 'dono' | 'socio' | 'trabalho' | 'vou_abrir'
  - conheceu: 'instagram' | 'indicacao' | 'google' | 'compro_loja' | 'outro'
- `lista_espera` {nome, telefone, cidade} → {ok} | {ok:false, motivo:'dados_invalidos'|'ja_registrado'|'limite_dia'}. Validação igual à visita; grava nome, telefone, cidade nas colunas do lead e anotacoes.lista_espera=true. Nada disso vai para a IA. Limite 3/IP/dia.
- `escutar` {texto, final} → como hoje {ok, anotacoes} + no final:true também `nao_acai?: true` (Jev: o objetivo não é vender açaí) e `cena?: {chave, cartoes:{cenario, trava, chegar}}` (só quando o Jev decidir que há cenário suficiente; chave entre as 8 cenas existentes; cartões ≤ 60 caracteres, escritos pelo Haiku e conferidos).
- `confirma_acai` {valor:'sim'|'nao'} → {ok}. 'nao' grava anotacoes.nao_acai=true (front encerra com gentileza e volta ao menu).
- `perfil` {segmento, cidade, bairro?, movimento, retira?} → {ok, fora_area, coerente, esclarecer?: {pergunta}} — esclarecer só quando o Jev disser que os dados não batem; pergunta escrita pelo Haiku com a nota do Jev.
- `esclarecer_resp` {texto} → {ok}. Grava anotacoes.esclarecimento (mascarado).
- `opcoes_compra` {} → {ok, opcoes:[{id, rotulo}], explicacao} — decisão 18: o Jev lê o perfil (já vende? vai abrir? movimento) e o código ordena/rotula as opções; `explicacao` é a frase mostrada se a pessoa hesitar 7 s.
- `simulacao` — como hoje.
- `aprofundar` {} → {ok, pergunta|null, respostas?} — o Jev decide se precisa; null = pula. Front chama em segundo plano logo depois do objetivo final (fio) e guarda o resultado.
- `aprofundar_resp` — como hoje.
- `palpite` {} → {ok, palpite|null} — motor: reprovado pelo Jev volta ao Haiku com motivo (até 2); front pode chamar em segundo plano depois do aprofundar.
- `palpite_resp` {valor:'mosca'|'parte'|'nao', texto?} → {ok, alternativas?: string[≤3]} — em 'parte'/'nao' com texto, o Haiku propõe até 3 frases a partir da correção e o Jev filtra/ordena.
- `palpite_escolha` {indice: number|null} → {ok}. Grava a frase escolhida (ou mantém a correção da pessoa).
- `resumo` {} → {ok, resumo, problema, termo} — decisão 19: antes, o Jev rejulga a frase do objetivo contra as respostas seguintes; `termo` ≤ 5 palavras validado no servidor ("A gente chama isso de …").
- `resumo_resp` {valor:'ok'|'corrigir', texto?} → {ok, resumo?, problema?, termo?} — 'corrigir' reescreve uma vez com a correção (motor).
- `mapa` {} → {ok, mapa, simples?:true} — o Jev escolhe quais tipos de nó entram (negocio, problema, causa, risco, destino, passo); o Haiku escreve; conferência com motivo; reprovado 2× → mapa simples por código com `simples:true` (front avisa "montei um mapa mais simples").
- `mapa_ajuste` — como hoje (máx. 2), com o mesmo motor.
- `mapa_ok` — como hoje. "Pular o mapa" no front só chama `mapa_ok` com {pulou:true}.

## Estado no navegador
Chave nova `puri:v2` (a `puri:v1` antiga é descartada com recomeço limpo). Tudo que é salvo passa pela máscara.

## Registro
Toda decisão do Jev desta etapa vai para jev_log (rótulo, valor, efeito; sem texto do cliente).
