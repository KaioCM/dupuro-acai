"""Rodada 4 (imagens, experimental — header TypeSafe-Danger-Zone-Images): sabor pela foto (Choice),
orientação da foto (Choice) e Box com Noul de presença, nas fotos do próprio site."""
import base64, io, json, os, sys, time, uuid, requests
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
KEY=os.environ["TYPESAFE_API_KEY"]; URL="https://api.typesafe.ai/v1/systemone"
R="/home/user/dupuro-acai/assets/img/"
def prep(path, rot=0, side=1024):
    im=Image.open(path).convert("RGB")
    if rot: im=im.rotate(rot, expand=True)
    im.thumbnail((side,side))
    b=io.BytesIO(); im.save(b,"JPEG",quality=85)
    return im, base64.b64encode(b.getvalue()).decode()
def ask(state, questions, assets, model="jev-1.14.0"):
    body={"model":model,"state":state,"questions":questions,"assets":assets}
    for a in range(5):
        r=requests.post(URL,json=body,headers={"Authorization":f"Bearer {KEY}","TypeSafe-Danger-Zone-Images":"true"},timeout=120)
        if r.status_code==200: return r.json()
        if r.status_code in (429,500,502,503,504,529): time.sleep(2**(a+1)); continue
        raise RuntimeError(f"{r.status_code} {r.text[:400]}")
SHOP="Photo from Dupuro Açaí, an açaí and cream ice-cream factory in Brazil (boxes/tubs of açaí or 'creme' of a flavor)."
# A) sabor
SAB={"acai":"Açaí: dark purple / almost black.","maracuja":"Passion fruit (maracujá) cream: yellow.","pacoca":"Paçoca (peanut) cream: beige / light brown.",
     "morango":"Strawberry cream: pink.","cupuacu":"Cupuaçu cream: off-white / pale cream.","ninho":"Ninho (powdered milk) cream: white.","nao_visivel":"The ice cream itself is not visible."}
A=[("delivery/caixa-maracuja.jpg","maracuja"),("delivery/caixa-pacoca.jpg","pacoca"),("delivery/caixa-pote-morango.jpg","morango"),
   ("delivery/creme-colher-cupuacu.jpg","cupuacu"),("delivery/creme-morango-aberto.jpg","morango"),("fotos/creme-maracuja.jpg","maracuja")]
def sabor(c):
    _,b=prep(R+c[0]); k=str(uuid.uuid4())
    j=ask({"shop":SHOP,"photo":k},{"sabor":{"type":"choice","instructions":"Which flavor is the ice cream shown in `photo`?","criteria":SAB}},{k:{"type":"image","format":"jpg","data_base64":b}})
    a=j["answers"]["sabor"]; return c, a["choice"], a["confidence"], j["usage"]["input_tokens"]
# B) orientação
ORI={"upright":"The photo is upright: people, objects and text stand the right way up.",
     "rot_cw":"The content is rotated 90° clockwise (things that should point up point to the right).",
     "rot_ccw":"The content is rotated 90° counter-clockwise (things that should point up point to the left).",
     "upside_down":"The content is upside down."}
GT={0:"upright",90:"rot_ccw",180:"upside_down",270:"rot_cw"}  # PIL rotate é anti-horário
B=[(f,r) for f in ["delivery/caixa-na-mao.jpg","fotos/marcos-0.jpg","delivery/familia-pai-filho-caixa.jpg","fotos/belvedere-5.jpg"] for r in (0,90,180,270)]
def ori(c):
    _,b=prep(R+c[0],c[1],768); k=str(uuid.uuid4())
    j=ask({"photo":k},{"o":{"type":"choice","instructions":"How is the content of `photo` oriented?","criteria":ORI}},{k:{"type":"image","format":"jpg","data_base64":b}})
    a=j["answers"]["o"]; return c, a["choice"], a["confidence"], j["usage"]["input_tokens"]
with ThreadPoolExecutor(8) as ex:
    ra=list(ex.map(sabor,A)); rb=list(ex.map(ori,B))
print("== sabor:", sum(r[1]==r[0][1] for r in ra),"/",len(ra))
for r in ra: print(f"  {r[0][0]:34s} esperado {r[0][1]:9s} -> {r[1]:9s} conf {r[2]:.2f} tok {r[3]}")
print("== orientação:", sum(r[1]==GT[r[0][1]] for r in rb),"/",len(rb))
for r in rb:
    if r[1]!=GT[r[0][1]]: print(f"  x {r[0][0]} rot{r[0][1]}: esperado {GT[r[0][1]]} -> {r[1]} conf {r[2]:.2f}")
print("  tokens/imagem 768px ~", rb[0][3])
# C) Box
for f,alvo in [("delivery/caixa-na-mao.jpg","the açaí box held in the hand in `photo`"),("delivery/familia-pai-filho-caixa.jpg","the açaí box in `photo`"),("fotos/marcos-0.jpg","the açaí box or cup in `photo`")]:
    im,b=prep(R+f); k=str(uuid.uuid4())
    j=ask({"photo":k},{"tem":{"type":"noul","instructions":"Is there an açaí box, tub or cup in `photo`?"},"box":{"type":"box","instructions":alvo}},{k:{"type":"image","format":"jpg","data_base64":b}})
    bx=j["answers"]["box"]; e=bx["box"]; W,H=im.size
    from PIL import ImageDraw
    d=ImageDraw.Draw(im); d.rectangle([e["left"]*W,e["top"]*H,e["right"]*W,e["bottom"]*H],outline=(255,0,180),width=6)
    im.thumbnail((400,400)); out=f"/tmp/box_{os.path.basename(f)}"; im.save(out)
    print(f"== box {f}: presença {j['answers']['tem']['noul']:.2f}  box {e}  conf {bx['confidence']:.2f}  tok {j['usage']['input_tokens']}  -> {out}")
