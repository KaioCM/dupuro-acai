"""Nota de completude do briefing pelo Jev. Uso: python3 -I avaliar_jev.py brief.json"""
import json,os,sys,requests
KEY=os.environ["TYPESAFE_API_KEY"]; b=json.load(open(sys.argv[1]))
CAMPOS={"objetivo_e_kpi":"the campaign goal and the single metric it is judged on","meta_numerica_e_prazo":"a numeric target and a time frame",
 "publico_e_consciencia":"one specific audience and how aware it already is of the brand/product","sentimento_acao_diferencial":"what the viewer should feel and do, and what makes the brand different",
 "estilo_referencias":"visual style and concrete references (liked and disliked)","material_disponivel":"which photos/assets will be used",
 "restricoes":"what must not be shown, said or promised","provas":"real proof to use (reviews, comments, numbers)","producao_canal_orcamento":"who produces it, placements and budget"}
Q={k:{"type":"noul","instructions":f"Does the creative brief in `brief` clearly define {v}? An empty field means no."} for k,v in CAMPOS.items()}
Q["pronto"]={"type":"score","instructions":"How ready is the creative brief in `brief` to hand to a designer?","criteria":["Not ready: key decisions are missing.","Partly ready: direction exists but important gaps remain.","Ready: a designer could execute it without guessing."]}
r=requests.post("https://api.typesafe.ai/v1/systemone",json={"model":"jev-latest","state":{"brief":b},"questions":Q},headers={"Authorization":f"Bearer {KEY}"},timeout=60); r.raise_for_status(); a=r.json()["answers"]
for k in CAMPOS: print(f"{k:28s} {a[k]['noul']:.2f}")
print(f"{'PRONTO PRA PRODUZIR (0-2)':28s} {a['pronto']['score']:.2f} (conf {a['pronto']['confidence']:.2f})")
