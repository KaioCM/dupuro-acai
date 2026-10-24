"""Experimento 1 — classificação fiscal (perfil FISCAL_PERFIS) com Jev (Choice).

Uso: python3 -I exp1_fiscal.py [modelo]   (lê TYPESAFE_API_KEY do ambiente)
Saída: exp1_<modelo>.json ao lado deste arquivo.
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import requests

MODEL = sys.argv[1] if len(sys.argv) > 1 else "jev-latest"
KEY = os.environ["TYPESAFE_API_KEY"]
URL = "https://api.typesafe.ai/v1/systemone"
HERE = os.path.dirname(os.path.abspath(__file__))

# Gabarito: products (perfil derivado de ncm/csosn/cfop em FISCAL_PERFIS).
GABARITO = [
    (4, "Caixa de Cremes 10 Litros", "embalado", "acai"),
    (13, "Pote/Caixa de 1 Litro", "embalado", "acai"),
    (14, "Caixa de 2 Litros", "embalado", "acai"),
    (15, "Caixa de 5 Litros", "embalado", "acai"),
    (16, "Caixa de Açaí 10 Litros", "embalado", "acai"),
    (17, "Granola Tia Sônia 1kg", "embalado", "granola"),
    (18, "Pote de 500ml", "embalado", "acai"),
    (19, "Pote de 500ml", "embalado", "acai"),
    (21, "Pote/Caixa de 1 Litro", "embalado", "acai"),
    (22, "Caixa de 2 Litros", "embalado", "acai"),
    (23, "Caixa de 5 Litros", "embalado", "acai"),
    (24, "Caixa de 10 Litros", "embalado", "acai"),
    (26, "Coca", "embalado", "refri"),
    (27, "Coca Zero", "embalado", "refri"),
    (28, "Água S/Gás", "embalado", "agua"),
    (29, "Água C/Gás", "embalado", "agua"),
    (35, "Granola Tia Sônia 1kg", "embalado", "granola"),
    (41, "Copo de 180ml", "copo", "acai"),
    (42, "Copo de 300ml", "copo", "acai"),
    (43, "Copo de 400ml", "copo", "acai"),
    (44, "Copo de 500ml", "copo", "acai"),
    (45, "Copo de 700ml", "copo", "acai"),
    (46, "Marmita de 1 Litro", "copo", "acai"),
    (47, "Marmita de 1,2 Litros", "copo", "acai"),
    (48, "Copo/Tigela Kg", "peso", "acai"),
]

# Inventados realistas. "custom" = nenhum perfil serve (cadastro manual).
INVENTADOS = [
    ("Guaraná Antarctica lata 350ml", "embalado", "refri"),
    ("Fanta Laranja 2L", "embalado", "refri"),
    ("Sprite lata", "embalado", "refri"),
    ("Coca-Cola 600ml", "embalado", "refri"),
    ("Água mineral 500ml", "embalado", "agua"),
    ("Água com gás 1,5L", "embalado", "agua"),
    ("Creme de cupuaçu 5L", "embalado", "acai"),
    ("Creme de Ninho 10 Litros", "embalado", "acai"),
    ("Açaí zero açúcar 1L", "embalado", "acai"),
    ("Pote de 250ml", "embalado", "acai"),
    ("Barca de açaí 1kg", "copo", "acai"),
    ("Tigela de 500ml", "copo", "acai"),
    ("Copo da Promoção 300ml", "copo", "acai"),
    ("Self-service Creme de Morango", "peso", "acai"),
    ("Picolé de açaí", "embalado", "acai"),
    ("Granola tradicional 500g", "embalado", "granola"),
    ("Granola sem açúcar 800g", "embalado", "granola"),
    ("Paçoca", "embalado", "adicional"),
    ("Leite condensado bisnaga", "embalado", "adicional"),
    ("Morango picado porção", "embalado", "adicional"),
    ("Nutella porção 30g", "embalado", "adicional"),
    ("Leite em pó 200g", "embalado", "adicional"),
    ("Água de coco 1L", "embalado", "custom"),
    ("Suco de laranja 300ml", "embalado", "custom"),
    ("Energético lata 250ml", "embalado", "custom"),
    ("Cerveja lata 350ml", "embalado", "custom"),
    ("Colher descartável (pacote)", "embalado", "custom"),
]

# Adicionais da tabela acompanhamentos: na NFC-e saem como "adicional" (emitir-nfce v7).
ACOMPS = ["Abacaxi", "Amendoim", "Banana", "Bis branco", "Bis preto", "Calda de Caramelo",
          "Calda de Chocolate", "Calda de Morango", "Cereja", "Chocoball", "Coco Ralado",
          "Confete", "Creme de Amendoim", "Doce de Leite", "Goiabada", "Gotas de Chocolate",
          "Granola", "Granulado", "Jujuba", "Kiwi", "Leite Condensado", "Leite em pó", "Mel",
          "Morango", "Nutella", "Ouro Branco", "Ovomaltine", "Paçoca", "Sonho de Valsa", "Sucrilhos"]

MODO_DESC = {
    "embalado": "packaged item sold by the unit",
    "copo": "cup or bowl assembled and served in the shop, with toppings",
    "peso": "self-service sold by weight (price per kg)",
    "acompanhamento": "topping added on top of an açaí cup",
}
SHOP = ("Dupuro Açaí, an açaí factory and shop in Brazil. Unless the name says otherwise, "
        "boxes (caixa), tubs (pote), cups (copo), bowls (tigela) and 'marmitas' contain açaí "
        "or cream ice cream.")

CRIT = {
    "acai": "Açaí or cream ice cream (sorvete/creme): boxes and tubs of açaí or cream sold by volume, "
            "cups, bowls and marmitas served in the shop, self-service sold by weight, popsicles.",
    "agua": "Bottled drinking water, still or sparkling (água mineral, com gás / sem gás).",
    "refri": "Soft drink / soda (refrigerante), such as Coca-Cola, Guaraná, Fanta or Sprite.",
    "granola": "Granola or breakfast cereal sold packaged.",
    "adicional": "Topping or complement that goes on the açaí (fruit, candy, chocolate, syrup, "
                 "condensed milk, powdered milk, peanut, paçoca), or any other item that is none of the above.",
}
CRIT_C = dict(CRIT)
CRIT_C["adicional"] = ("Topping or complement that goes on the açaí (fruit, candy, chocolate, syrup, "
                       "condensed milk, powdered milk, peanut, paçoca).")
CRIT_C["custom"] = ("None of the options above clearly fits (for example juice, coconut water, energy "
                    "drink, beer, disposable utensils); the tax codes must be entered by hand.")

ORDER = ["acai", "agua", "refri", "granola", "adicional"]
INSTR = "Which tax profile (Brazilian NFC-e) fits the product in `product_name`?"


def variant_question(v):
    if v == "A":   # contexto da loja, ordem natural
        crit = {k: CRIT[k] for k in ORDER}
    elif v == "B": # mesma coisa, ordem invertida (viés de 1ª opção)
        crit = {k: CRIT[k] for k in reversed(ORDER)}
    elif v == "C": # + opção "nenhum serve" (vira 'Personalizado' na UI)
        crit = {k: CRIT_C[k] for k in ORDER + ["custom"]}
    elif v == "D": # sem contexto: só nome + modo cru
        crit = {k: CRIT[k] for k in ORDER}
    return {"type": "choice", "instructions": INSTR, "criteria": crit}


def state_for(nome, modo, v):
    if v == "D":
        return {"product_name": nome, "sale_mode": modo}
    return {"shop": SHOP, "product_name": nome, "sale_mode": MODO_DESC[modo]}


def ask(case, v):
    body = {"model": MODEL, "state": state_for(case["nome"], case["modo"], v),
            "questions": {"perfil": variant_question(v)}}
    for attempt in range(4):
        t0 = time.time()
        r = requests.post(URL, json=body, headers={"Authorization": f"Bearer {KEY}"}, timeout=60)
        if r.status_code == 200:
            j = r.json()
            a = j["answers"]["perfil"]
            return {**case, "variant": v, "choice": a["choice"], "confidence": a["confidence"],
                    "probabilities": a["probabilities"], "model": j["model"],
                    "input_tokens": j["usage"]["input_tokens"], "ms": round((time.time() - t0) * 1000)}
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 ** (attempt + 1))
            continue
        raise RuntimeError(f"{r.status_code}: {r.text[:300]}")
    raise RuntimeError("retries exhausted")


def main():
    cases = [{"set": "gabarito", "id": i, "nome": n, "modo": m, "esperado": e} for i, n, m, e in GABARITO]
    cases += [{"set": "inventado", "nome": n, "modo": m, "esperado": e} for n, m, e in INVENTADOS]
    cases += [{"set": "acomp", "nome": n, "modo": "acompanhamento", "esperado": "adicional"} for n in ACOMPS]
    jobs = [(c, v) for v in "ABCD" for c in cases]
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda cv: ask(*cv), jobs))
    out = os.path.join(HERE, "resultados", f"exp1_{MODEL}.json")
    with open(out, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print(f"{len(results)} respostas -> {out}")


if __name__ == "__main__":
    main()
