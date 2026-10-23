"""Rodada 2: holdout (itens que não aparecem em nenhuma descrição) + critérios genéricos."""
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exp1_fiscal as E

HOLD = [
    ("Sorvete de flocos 2L", "embalado", "acai"),
    ("Creme de morango 10L", "embalado", "acai"),
    ("Creme de Ninho 5 Litros", "embalado", "acai"),
    ("Creme de Ninho 10 Litros", "embalado", "acai"),
    ("Creme de cupuaçu 5L", "embalado", "acai"),
    ("Copo Kids 200ml", "copo", "acai"),
    ("Açaí na tigela 700ml", "copo", "acai"),
    ("Pepsi lata 350ml", "embalado", "refri"),
    ("Guaraná Kuat 2L", "embalado", "refri"),
    ("Água Crystal 1,5L", "embalado", "agua"),
    ("Água mineral com gás 500ml", "embalado", "agua"),
    ("Granola com mel 250g", "embalado", "granola"),
    ("Leite Ninho porção", "embalado", "adicional"),
    ("Chocoball porção 50g", "embalado", "adicional"),
    ("Chá gelado Leão lata", "embalado", "custom"),
    ("Isotônico Gatorade 500ml", "embalado", "custom"),
    ("Kombucha 300ml", "embalado", "custom"),
    ("Pão de queijo", "embalado", "custom"),
    ("Vinho tinto 750ml", "embalado", "custom"),
    ("Sacola plástica", "embalado", "custom"),
    ("Coxinha", "embalado", "custom"),
    ("Suco de uva integral 1L", "embalado", "custom"),
    ("Gelo em cubo 5kg", "embalado", "custom"),
]
C2 = {
    "acai": "Açaí or cream ice cream (sorvete). Includes any 'Creme de <flavor>' (cupuaçu, ninho, morango...) "
            "sold in boxes or tubs by volume, cups, bowls and marmitas served in the shop, self-service by weight, popsicles.",
    "agua": "Bottled mineral or drinking water, still or sparkling.",
    "refri": "Carbonated soft drink (refrigerante).",
    "granola": "Granola or breakfast cereal sold packaged.",
    "adicional": "A small topping or complement put on the açaí (fruit, candy, chocolate, syrup, condensed milk, powdered milk, peanut).",
    "custom": "Anything that is not one of the options above; the tax codes must be entered by hand.",
}
KEYS = ["acai", "agua", "refri", "granola", "adicional", "custom"]

def q(v):
    if v == "C":   crit = {k: E.CRIT_C[k] for k in KEYS}           # critérios da rodada 1 (vazavam exemplos)
    elif v == "C2": crit = {k: C2[k] for k in KEYS}
    elif v == "C2r": crit = {k: C2[k] for k in reversed(KEYS)}
    return {"type": "choice", "instructions": E.INSTR, "criteria": crit}

E.variant_question = q
cases = [{"set": "holdout", "nome": n, "modo": m, "esperado": e} for n, m, e in HOLD]
# também re-roda o gabarito e os inventados com C2 pra ver se não piorou
cases += [{"set": "gabarito", "nome": n, "modo": m, "esperado": e} for _, n, m, e in E.GABARITO]
cases += [{"set": "inventado", "nome": n, "modo": m, "esperado": e} for n, m, e in E.INVENTADOS]
jobs = [(c, v) for v in ["C", "C2", "C2r"] for c in cases]
with ThreadPoolExecutor(max_workers=8) as ex:
    res = list(ex.map(lambda cv: E.ask(*cv), jobs))
json.dump(res, open(os.path.join(E.HERE, "resultados", f"exp1b_{E.MODEL}.json"), "w"), ensure_ascii=False, indent=1)
for v in ["C", "C2", "C2r"]:
    print(f"== {E.MODEL} var {v}")
    for s in ["holdout", "gabarito", "inventado"]:
        rs = [r for r in res if r["variant"] == v and r["set"] == s]
        print(f"   {s}: {sum(r['choice']==r['esperado'] for r in rs)}/{len(rs)}")
    for r in res:
        if r["variant"] == v and r["choice"] != r["esperado"]:
            print(f"     x {r['set']}: {r['nome']}  {r['esperado']} -> {r['choice']} conf {r['confidence']:.2f}")
