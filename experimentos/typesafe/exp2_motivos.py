"""Experimento 2 — categorizar cancel_motivo (Choice sobre taxonomia fixa)."""
import json, os, sys, requests
from concurrent.futures import ThreadPoolExecutor
MODEL = sys.argv[1] if len(sys.argv) > 1 else "jev-latest"
KEY = os.environ["TYPESAFE_API_KEY"]
REAIS = [("VND-0004","teste"),("VND-0006","teste"),("VND-0008","teste"),("VND-0053","teste"),
         ("VND-0080","teste"),("VND-0195","teste"),("VND-0196","teste"),
         ("VND-0197","Teste exemplo de NFC-e em um sistema novo."),("VND-0250","teste"),
         ("VND-0290","teste"),("VND-0326","desistiu"),("VND-0452","teste"),("VND-0527","troca")]
ESP_REAIS = {"teste":"teste","Teste exemplo de NFC-e em um sistema novo.":"teste","desistiu":"desistencia","troca":"troca_item"}
# Sintéticos realistas (texto livre de atendente, com erro de digitação), com rótulo esperado.
SINT = [("lancei 2x a mesma venda","erro_lancamento"),("valor errado, era 18 e nao 28","erro_lancamento"),
        ("cliente quis trocar o copo de 300 pelo de 500","troca_item"),("trocou o sabor pra cupuaçu","troca_item"),
        ("cliente foi embora sem pagar","desistencia"),("cliente desistiu do pedido","desistencia"),
        ("maquininha recusou o cartao","pagamento"),("pix nao caiu","pagamento"),
        ("cobrei no debito era credito","erro_lancamento"),("impressora travou e refiz","problema_tecnico"),
        ("sistema caiu, refiz a venda","problema_tecnico"),("treinamento da nova atendente","teste"),
        ("produto acabou, sem estoque","sem_estoque"),("acabou o creme de ninho","sem_estoque"),
        ("açaí veio derretido, cliente reclamou","reclamacao"),("cliente reclamou do atendimento","reclamacao"),
        ("pedido do ifood duplicado","erro_lancamento"),("xxx","outro"),("a pedido do Kayo","outro")]
CRIT = {
    "teste": "A test, training or trial sale, not a real customer (teste, treinamento, exemplo).",
    "erro_lancamento": "The cashier made a mistake entering the sale: duplicated sale, wrong price or amount, wrong payment method recorded.",
    "troca_item": "The customer changed the item, size or flavor, so the sale was redone.",
    "desistencia": "The customer gave up or left without buying.",
    "pagamento": "The payment did not go through (card declined, Pix not received).",
    "problema_tecnico": "Equipment or system failure (printer, card machine, internet, app).",
    "sem_estoque": "The product was out of stock.",
    "reclamacao": "Customer complaint about the product quality or service.",
    "outro": "None of the above, or the reason is unclear / meaningless text.",
}
def ask(item):
    texto, esperado, fonte = item
    body = {"model": MODEL, "state": {"context": "Reason typed by a cashier (in Portuguese) when cancelling a sale in an açaí shop's point of sale.",
                                      "cancel_reason": texto},
            "questions": {"cat": {"type": "choice", "instructions": "Which category best describes `cancel_reason`?", "criteria": CRIT}}}
    r = requests.post("https://api.typesafe.ai/v1/systemone", json=body, headers={"Authorization": f"Bearer {KEY}"}, timeout=60)
    r.raise_for_status(); a = r.json()["answers"]["cat"]
    return {"fonte": fonte, "texto": texto, "esperado": esperado, "choice": a["choice"], "confidence": round(a["confidence"], 2)}
itens = [(t, ESP_REAIS[t], n) for n, t in REAIS] + [(t, e, "sintético") for t, e in SINT]
with ThreadPoolExecutor(8) as ex: res = list(ex.map(ask, itens))
json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados", f"exp2_{MODEL}.json"), "w"), ensure_ascii=False, indent=1)
for fonte in ["real", "sintético"]:
    rs = [r for r in res if (r["fonte"] != "sintético") == (fonte == "real")]
    print(f"{MODEL} {fonte}: {sum(r['choice']==r['esperado'] for r in rs)}/{len(rs)}")
seen=set()
for r in res:
    if r["texto"] in seen: continue
    seen.add(r["texto"])
    flag = "ok" if r["choice"]==r["esperado"] else "XX"
    print(f"  {flag} {r['texto'][:45]:45} esp={r['esperado']:16} jev={r['choice']:16} conf={r['confidence']}")
