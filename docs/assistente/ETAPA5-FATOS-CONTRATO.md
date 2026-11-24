# Etapa 5: fatos da Puri editáveis por assunto (contrato)

Os fatos (antes uma string única em `supabase/functions/assistente/fatos.ts`) viram texto editável por assunto no admin, só pelo Kayo. Esta etapa entrega a BASE: divisão em assuntos, tabela e funções do banco. A Edge e a tela vêm nas tarefas seguintes.

## Tabelas (migração 083)

- `puri_fatos(assunto pk, titulo, ordem, travado, aviso, publicado, rascunho, rascunho_em, publicado_em, versao)`. `assunto` só `[a-z_]` (2 a 40), `publicado` e `rascunho` com 1 a 2000 caracteres. 16 assuntos, semeados a partir de `FATOS_LISTA`.
- `puri_fatos_historico(id, assunto, tipo, texto, autor, criado_em)`. `tipo`: `rascunho`, `publicado`, `descartado`, `voltou`.
- `puri_dono()`: verdadeiro só se `is_admin()` e `auth.uid()` for o do Kayo (o id do dono, ver `PURI_AVISO_ADMIN` no admin.html). Outro admin é recusado.
- RLS ligada. SELECT só para `authenticated` com `puri_dono()`; nenhuma escrita direta (revogada para anon e authenticated). `service_role` lê tudo.

## Funções (migrações 083 + 084; todas `security definer`, só `authenticated`, recusam quem não é `puri_dono()` com erro 42501; devolvem a linha atualizada)

Controle de versão: `puri_fatos.versao` (inteiro, começa em 1) soma 1 a cada escrita (salvar com mudança, publicar, descartar, voltar). A tela manda de volta o inteiro que recebeu; se não for igual ao atual (ou for nulo), a função recusa com "Conflito: este fato mudou em outra tela. Recarregue." `rascunho_em` é só informação.

- `puri_fato_salvar(assunto, texto, versao)`: grava o RASCUNHO. Recusa assunto travado. Texto sem `<` `>` nem caractere de controle (tab e quebras de linha viram um espaço ao salvar: o fato salvo é uma linha só); 10 a 2000 caracteres. Texto igual ao rascunho atual devolve a linha sem gravar (e sem somar versão). Recusa qualquer sequência de 8 a 13 dígitos (com espaço, ponto, hífen, barra ou parênteses entre eles) que não seja (65) 99288-8228 ou (65) 9694-9542 (com ou sem DDD/+55); passam CEP 78076-001, datas (23/11/2026, 2026-11-23), par de anos ("2026 2027"), preço, horário e litro. Na dúvida, recusa.
- `puri_fato_publicar(assunto, versao)`: mesma checagem de versão; copia rascunho para publicado, limpa `rascunho_em`; guarda no histórico o publicado ANTERIOR (tipo `publicado`). Recusa se rascunho = publicado.
- `puri_fato_descartar(assunto, versao)`: rascunho volta a ser igual ao publicado.
- `puri_fato_voltar(assunto, historico_id, versao)`: põe no rascunho o texto de uma linha do histórico escolhida pela tela (tem de ser do mesmo assunto e do tipo `publicado`; o texto original do seed fica alcançável porque o primeiro publicar o guarda). Não publica.

## Leitura pela Edge (próxima tarefa)

Com service role. `assistente-dev` lê `rascunho`, a Edge oficial lê `publicado`, concatenados na ordem da lista do código (`FATOS_LISTA`; a coluna `ordem` não manda), uma linha por assunto, com `<` e `>` removidos. Cache em memória: 60 s no dev, 5 min na prod; uma leitura por vez por ambiente (requisições simultâneas dividem a mesma). Se a leitura FALHAR (prazo de 2 s, erro, exceção) e houver texto bom do banco no cache, reusa esse texto por mais 60 s, por no máximo 30 min desde a última leitura boa; depois disso, ou sem texto bom, usa o código. Resposta válida do banco que reprova na montagem (assunto faltando, tamanho) cai direto para o código e apaga o texto bom guardado. Se faltar assunto, ou o total ficar abaixo de 1.000 ou acima de 15.000 caracteres, usa `FATOS` do código. Assunto que cai para o código por conter telefone não liberado é registrado (`fatos`/`assunto_codigo`, só os nomes) a cada renovação do cache. Assunto `travado` vem sempre do código (hoje: `contato_endereco` e `leite_gluten`).

## Tela do admin (tarefa seguinte)

Subaba "Fatos da Puri", só para o Kayo, com Salvar rascunho, Publicar, Descartar rascunho e Voltar a uma versão anterior (lista do histórico do tipo publicado). Guarda a `versao` recebida e a devolve em cada chamada. Mostra o `aviso` de cada assunto (onde o fato também está escrito no código, para o Kayo saber que precisa pedir a mudança lá).

## Até a Etapa 6

A Edge oficial passa a ler a tabela com a publicação da Etapa 6: "Publicar" só vale lá a partir daí. Até lá, na produção, o `FATOS` do código manda.

## Código

`fatos.ts` exporta `FATOS_LISTA` (assunto, titulo, texto, travado?, aviso?) e `FATOS` (string, textos unidos por quebra de linha; conteúdo idêntico ao anterior). Teste em `logica_test.ts` confere assuntos únicos, tamanhos e total.
