"""Avaliação dos PNGs pelo Jev (imagem, experimental). Uso: python3 -I avaliar_jev.py (precisa de TYPESAFE_API_KEY)."""
import base64, io, json, os, sys, uuid, requests
from PIL import Image
KEY=os.environ["TYPESAFE_API_KEY"]
D="/home/user/dupuro-acai/marketing/anuncios/delivery-2026-10/"
Q={
 "legivel":{"type":"score","instructions":"Seen on a phone screen in a social feed, how easy is it to read the main headline of the ad in `ad`?",
   "criteria":["Hard to read: small, low contrast or busy background.","Readable with some effort.","Instantly readable at a glance."]},
 "apetite":{"type":"score","instructions":"How appetizing does the food in `ad` look?",
   "criteria":["Not appetizing: the food is barely visible or unappealing.","Somewhat appetizing.","Very appetizing: makes you want to eat it."]},
 "poluicao":{"type":"score","instructions":"How visually cluttered is `ad`?",
   "criteria":["Clean: few elements with clear hierarchy.","Moderately busy.","Cluttered: too many competing elements."]},
 "foco":{"type":"choice","instructions":"In `ad`, what draws the eye first?",
   "criteria":{"titulo":"The big headline text.","caixa":"The açaí box product.","creme":"The round photo of ice cream with a spoon.","botao":"The yellow call-to-action button.","nota":"The round '4,8 no Google' rating badge.","logo":"The brand logo at the top."}},
 "o_que_vende":{"type":"noul","instructions":"Is it immediately clear that `ad` sells açaí boxes delivered to your home?"},
 "proximo_passo":{"type":"noul","instructions":"Is it clear from `ad` what the viewer should do next?"},
 "profissional":{"type":"noul","instructions":"Does `ad` look like a professionally designed ad from a real brand?"},
}
def asset(arq):
    im=Image.open(D+arq).convert("RGB"); im.thumbnail((1568,1568)); b=io.BytesIO(); im.save(b,"JPEG",quality=90)
    return str(uuid.uuid4()), {"type":"image","format":"jpg","data_base64":base64.b64encode(b.getvalue()).decode()}

PECAS=[("feed A","dupuro-delivery-feed-4x5.png"),("feed B","dupuro-delivery-feed-4x5-B.png"),
       ("stories A","dupuro-delivery-stories-9x16.png"),("stories B","dupuro-delivery-stories-9x16-B.png")]
for nome,arq in PECAS:
    k,ast=asset(arq)
    body={"model":"jev-latest","state":{"context":"Instagram ad for a Brazilian açaí factory's home delivery (text in Portuguese).","ad":k},
          "assets":{k:ast},"questions":Q}
    r=requests.post("https://api.typesafe.ai/v1/systemone",json=body,headers={"Authorization":f"Bearer {KEY}","TypeSafe-Danger-Zone-Images":"true"},timeout=120)
    r.raise_for_status(); j=r.json(); a=j["answers"]
    print(f"== {nome} ({j['model']}, {j['usage']['input_tokens']} tok)")
    for q in ("legivel","apetite","poluicao"): print(f"  {q:13s} {a[q]['score']:.2f}/2  conf {a[q]['confidence']:.2f}  {a[q]['probabilities']}")
    f=a["foco"]; print(f"  foco          {f['choice']} conf {f['confidence']:.2f}  {f['probabilities']}")
    for q in ("o_que_vende","proximo_passo","profissional"): print(f"  {q:13s} P(sim) {a[q]['noul']:.2f}")

# Comparação direta A × B (as duas peças no mesmo state; ordem trocada pra medir viés de posição)
for fmt,a_,b_ in [("feed","dupuro-delivery-feed-4x5.png","dupuro-delivery-feed-4x5-B.png"),
                  ("stories","dupuro-delivery-stories-9x16.png","dupuro-delivery-stories-9x16-B.png")]:
    for ordem in ((a_,"A",b_,"B"),(b_,"B",a_,"A")):
        k1,x1=asset(ordem[0]); k2,x2=asset(ordem[2])
        body={"model":"jev-latest","state":{"context":"Two versions of an Instagram ad for a Brazilian açaí factory's home delivery.",
              "primeira":k1,"segunda":k2},"assets":{k1:x1,k2:x2},
              "questions":{"melhor":{"type":"choice","instructions":"Which ad makes a viewer hungrier and more likely to order?",
                 "criteria":{"primeira":"The ad in `primeira`.","segunda":"The ad in `segunda`."}}}}
        r=requests.post("https://api.typesafe.ai/v1/systemone",json=body,headers={"Authorization":f"Bearer {KEY}","TypeSafe-Danger-Zone-Images":"true"},timeout=120)
        r.raise_for_status(); m=r.json()["answers"]["melhor"]
        venc=ordem[1] if m["choice"]=="primeira" else ordem[3]
        print(f"== {fmt}: {ordem[1]} primeiro, {ordem[3]} depois -> vence {venc} (conf {m['confidence']:.2f})")
