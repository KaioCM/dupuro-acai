"""Rodada 3: o Jev acha o trecho certo de um arquivo grande antes do Claude ler? (Noul por bloco de 100 linhas,
5 perguntas por request). Uso: python3 -I exp3_trechos.py area-cliente/admin.html"""
import json, os, sys, time, requests
from concurrent.futures import ThreadPoolExecutor
KEY=os.environ["TYPESAFE_API_KEY"]; URL="https://api.typesafe.ai/v1/systemone"
src=open(sys.argv[1]).read().splitlines()
N=100
chunks=[(i, "\n".join(src[i:i+N])) for i in range(0,len(src),N)]
Q={ # pergunta -> linha onde está a resposta
 "fiscal_ia": ("Does this code suggest a product's tax/fiscal classification from the product name using an AI service?", 2240),
 "auditoria": ("Does this code display the trail of edits and cancellations that cashiers made to sales (who, when, reason)?", 3417),
 "chart_lazy": ("Does this code load the charting library on demand, only when a chart is first opened?", 985),
 "ajuste_undo": ("Does this code let the admin manually adjust stock and then undo that adjustment?", 1436),
 "prazo": ("Does this code let the admin allow or forbid a reseller to buy on credit (pay later)?", 1717),
}
def ask(ch):
    i,txt=ch
    body={"model":"jev-latest","state":{"file":"area-cliente/admin.html","first_line":i+1,"code":txt},
          "questions":{k:{"type":"noul","instructions":v[0]} for k,v in Q.items()}}
    for a in range(5):
        r=requests.post(URL,json=body,headers={"Authorization":f"Bearer {KEY}"},timeout=90)
        if r.status_code==200:
            j=r.json(); return i,{k:j["answers"][k] for k in Q}, j["usage"]["input_tokens"]
        if r.status_code in (429,500,502,503,504,529): time.sleep(2**(a+1)); continue
        raise RuntimeError(f"{r.status_code} {r.text[:400]}")
t0=time.time()
with ThreadPoolExecutor(8) as ex: res=list(ex.map(ask,chunks))
print("primeira resposta bruta:", json.dumps(res[0][1])[:300])
def p(a): return a["noul"]
tok=sum(r[2] for r in res)
print(f"{len(chunks)} trechos, {tok} tokens Jev (US$ {tok*0.042/1e6:.4f}), {time.time()-t0:.1f}s")
for k,(q,linha) in Q.items():
    rk=sorted(res,key=lambda r:-p(r[1][k]))
    certo=(linha-1)//N*N
    pos=[r[0] for r in rk].index(certo)+1
    acima=sum(p(r[1][k])>=0.5 for r in res)
    top=", ".join(f"{r[0]+1}:{p(r[1][k]):.2f}" for r in rk[:3])
    print(f"{k:12s} trecho certo (l.{certo+1}) ficou em #{pos}  | trechos com P>=0.5: {acima} | top3 {top}")
