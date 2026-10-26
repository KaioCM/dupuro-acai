"""Jev avalia os esboços de direção (imagem, experimental). Uso: python3 -I avaliar_esbocos.py"""
import base64, io, json, os, uuid, requests
from PIL import Image
KEY=os.environ["TYPESAFE_API_KEY"]; H={"Authorization":f"Bearer {KEY}","TypeSafe-Danger-Zone-Images":"true"}
V=["prateleira","letreiro","papel"]
BRIEF=("Instagram ad for a Brazilian açaí factory's home delivery. Audience: parents who already like the brand. "
       "Goal: make them want to order by seeing the price of every box size at a glance. Style asked by the owner: "
       "handcrafted look leading, with playful touches (slightly tilted boxes, hand-lettered word, round price stickers); "
       "brand purple and gold.")
def asset(f):
    im=Image.open(f).convert("RGB"); im.thumbnail((1568,1568)); b=io.BytesIO(); im.save(b,"JPEG",quality=90)
    return str(uuid.uuid4()), {"type":"image","format":"jpg","data_base64":base64.b64encode(b.getvalue()).decode()}
Q={"artesanal":{"type":"score","instructions":"How handcrafted does the design of `ad` feel?","criteria":["Not handcrafted: generic digital layout.","Somewhat handcrafted.","Clearly handcrafted: textures and hand-made details lead."]},
   "precos":{"type":"score","instructions":"In `ad`, how easy is it to see which box costs what at a glance on a phone?","criteria":["Hard to match prices to boxes.","Possible with some effort.","Instant: each box clearly has its price."]},
   "vontade":{"type":"score","instructions":"For the audience in `brief`, how much does `ad` make them want to order now?","criteria":["Not at all.","Somewhat.","Strongly."]},
   "poluicao":{"type":"score","instructions":"How visually cluttered is `ad`?","criteria":["Clean.","Moderately busy.","Cluttered."]},
   "ia":{"type":"noul","instructions":"Does `ad` look AI-generated or like a generic template?"},
   "brief_ok":{"type":"noul","instructions":"Does `ad` follow the style asked in `brief`?"}}
print(f"{'':12s} artesanal preços vontade poluição  IA   segue-brief")
for v in V:
    k,a=asset(f"esboco-{v}.png")
    r=requests.post("https://api.typesafe.ai/v1/systemone",json={"model":"jev-latest","state":{"brief":BRIEF,"ad":k},"assets":{k:a},"questions":Q},headers=H,timeout=120); r.raise_for_status(); x=r.json()["answers"]
    print(f"{v:12s} {x['artesanal']['score']:8.2f} {x['precos']['score']:6.2f} {x['vontade']['score']:7.2f} {x['poluicao']['score']:8.2f} {x['ia']['noul']:5.2f} {x['brief_ok']['noul']:8.2f}")
# duelo a três, 3 rotações de ordem
votos={v:0.0 for v in V}
for rot in range(3):
    ordem=V[rot:]+V[:rot]; st={"brief":BRIEF}; assets={}; crit={}
    for i,v in enumerate(ordem):
        k,a=asset(f"esboco-{v}.png"); nome=f"opcao_{i+1}"; st[nome]=k; assets[k]=a; crit[nome]=f"The ad in `{nome}`."
    q={"melhor":{"type":"choice","instructions":"Which ad best fulfils `brief` (style asked by the owner, prices at a glance, wanting to order)?","criteria":crit}}
    r=requests.post("https://api.typesafe.ai/v1/systemone",json={"model":"jev-latest","state":st,"assets":assets,"questions":q},headers=H,timeout=120); r.raise_for_status(); m=r.json()["answers"]["melhor"]
    for i,v in enumerate(ordem): votos[v]+=m["probabilities"][f"opcao_{i+1}"]
    print(f"duelo ordem {ordem}: vence {ordem[int(m['choice'][-1])-1]} (conf {m['confidence']:.2f})")
print("probabilidade média no duelo:", {v:round(p/3,2) for v,p in votos.items()})
