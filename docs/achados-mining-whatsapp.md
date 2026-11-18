# Achados — mineração de 26 conversas WhatsApp Business (2026-11-18)

Método: exports nativos → parse + anonimização local (`tools/wa-mining/parse_anon.py`; self-test PII 6 classes = zero; auditoria de código antes de qualquer envio a terceiros) → classificação Jev por conversa (`run_jev.py`: pick objeção, score interesse 0–3, noul pedido-concreto) → join com `profiles`/`orders` pelo telefone (mapa só offline).

## Distribuição e validação contra cadastro/pedido reais

| Rótulo Jev | Conversas | viraram cadastro | viraram pedido |
|---|---|---|---|
| revenda_serio | 16 (62%) | 11 (69%) | 3 |
| varejo_curiosidade | 7 (27%) | 0 | 0 |
| produto_duvida | 2 | 0 | 0 |
| cliente_existente | 1 | — | — |

Interesse médio 1,73/3; 81% das conversas tiveram pedido concreto (orçamento, preço de revenda, amostra). O classificador separou conversão real de curiosidade SEM ver o desfecho — a taxonomia está validada para o runtime do P3.

## Os 6 achados que viraram decisão de roteiro
1. **Varejo não converte nunca** (0/7) → função nº 1 do chat é triagem em 1 pergunta, não persuasão — economiza o tempo do Kayo na linha da fábrica.
2. **8 dos 11 cadastrados daqui nunca pediram** → são o subconjunto da lista P0 das 19; o chat pega o lead ANTES do cadastro morto.
3. **Amostra apareceu 3× em falas distintas** ("como funciona pra gente testar antes de comprar?", "pode mandar uma amostra no motoboy que vai pra VG?", "quero consumir, se gostar revendo") — as 3 não converteram. Política de amostra = parâmetro ABERTO para o dono no roteiro.
4. **Abrangência 4×** (Várzea Grande ×2, "Mato Grosso todo", distrito específico) → nó de cidade com regra fixa: Cuiabá/VG = rota; demais = nota de expansão + lead salvo.
5. **"Orçamento" 4× e 2 "fico no aguardo" como última frase** → o chat nunca pode encerrar sem número ou sem compromisso de follow-up.
6. **C10 (açaíteria em casa, já aprovada)** travou 2 dias no endereço do mapa do pedido — só pediu quando resolveu. Vítima real e datada do geocoding: reforça o P1 do checkout.

## Perguntas literais mais frequentes (anonimizadas, do corpus)
"Qual o valor do açaí para revender?" · "Trabalham com vendas para revenda e quais os valores dos baldes de 5 e 10 litros?" · "Existe pedido mínimo?" · "Fazem entrega em Várzea Grande/Parque do Lago?" · "Como funciona pra gente testar antes de comprar?" · "O açaí é puro, sem água nem açúcar? Pode dar pra bebê?" · "Tem sem lactose?" · "Pode fazer esse orçamento pra mim?" · "Vocês enviam para o Mato Grosso todo?" · "Estão sem estoque de açaí?" · "Qual a validade/temperatura de armazenamento?" · "O fornecedor que tenho está sem produto, queria 2 ou 3 caixas." · "Qual o horário de funcionamento?" · "Tem os cremes? Lista de preços dos polpas?" · "Quero começar com pouco, posso?"

Retenção LGPD: bruto só na máquina do dono; rótulos+confs no temp; nenhuma frase identificável entra no git (frases do corpus são anônimas e genéricas de intenção).
