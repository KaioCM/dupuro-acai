import json, os, sys, statistics as st
RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados")
from collections import defaultdict
for model in ["jev-latest", "jev-preview"]:
    R = json.load(open(os.path.join(RES, f"exp1_{model}.json")))
    print(f"\n######## {model} (served: {R[0]['model']})  tokens médios={st.mean(r['input_tokens'] for r in R):.0f}  ms med={st.median(r['ms'] for r in R)}")
    for v in "ABCD":
        rows = [r for r in R if r["variant"] == v]
        line = [f"var {v}:"]
        for s in ["gabarito", "inventado", "acomp"]:
            rs = [r for r in rows if r["set"] == s and (v == "C" or r["esperado"] != "custom")]
            ok = sum(r["choice"] == r["esperado"] for r in rs)
            line.append(f"{s} {ok}/{len(rs)}")
        print("  ".join(line))
        # confiança acertos vs erros (gabarito+inventado, sem custom fora de C)
        rs = [r for r in rows if r["set"] != "acomp" and (v == "C" or r["esperado"] != "custom")]
        c_ok = [r["confidence"] for r in rs if r["choice"] == r["esperado"]]
        c_bad = [r["confidence"] for r in rs if r["choice"] != r["esperado"]]
        print(f"     conf média acerto={st.mean(c_ok):.2f} (min {min(c_ok):.2f})  erro={st.mean(c_bad) if c_bad else float('nan'):.2f} n_err={len(c_bad)}")
        for th in [0.5, 0.7, 0.8, 0.9]:
            auto = [r for r in rs if r["confidence"] >= th]
            ok = sum(r["choice"] == r["esperado"] for r in auto)
            print(f"       conf>={th}: automático {len(auto)}/{len(rs)}  precisão {ok}/{len(auto)}")
    # consistência de ordem A vs B
    A = {(r["set"], r["nome"]): r for r in R if r["variant"] == "A"}
    B = {(r["set"], r["nome"]): r for r in R if r["variant"] == "B"}
    diff = [k for k in A if A[k]["choice"] != B[k]["choice"]]
    print(f"  A vs B (ordem invertida): {len(diff)} trocas de resposta: {[k[1] for k in diff]}")
    print("  --- erros (variant: nome [modo] esperado -> escolha conf)")
    for r in R:
        if r["choice"] != r["esperado"] and not (r["variant"] != "C" and r["esperado"] == "custom"):
            print(f"   {r['variant']}: {r['nome']} [{r['modo']}] {r['esperado']} -> {r['choice']} {r['confidence']:.2f}")
    print("  --- fora do conjunto (esperado custom) em A e C")
    for r in R:
        if r["esperado"] == "custom" and r["variant"] in "AC":
            top2 = sorted(r["probabilities"].items(), key=lambda x: -x[1])[:2]
            print(f"   {r['variant']}: {r['nome']} -> {r['choice']} conf {r['confidence']:.2f}  {top2}")
