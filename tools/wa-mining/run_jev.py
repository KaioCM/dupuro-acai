#!/usr/bin/env python3
"""Fase 2 da mineração WhatsApp — classificação Jev por conversa.

Envia as 3 perguntas paralelas (objecao / interesse / concreto) para o Jev via
Edge Function pesquisa-analisar ou direto no endpoint systemone.
Output CSV + tabela agregada no TEMP — NUNCA no repo.

Python 3 stdlib. Chave em env TYPESAFE_API_KEY.
"""
import csv
import json
import os
import pathlib
import sys
import urllib.request

# --- Configurações ---

if hasattr(sys.stdout, "buffer"):
    sys.stdout = __import__("io").TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace")

URL         = "https://api.typesafe.ai/v1/systemone"
PROJECT_CTX = ("Açaí wholesale factory/distributor in Cuiabá MT Brazil. "
               "B2B reseller program starting at 1 box (10 L). "
               "Customer communicates only in Brazilian Portuguese.")
MODEL       = "jev-latest"

ANON_DIR   = None          # set by find_anon_dir()
OUTPUT_CSV = None

TAXONOMIA_OBJECAO = [
    "revenda_serio", "varejo_curiosidade", "amostra_teste",
    "produto_duvida", "abrangencia_entrega", "cliente_existente",
    "concorrente_fornecedor", "sem_intencao", "outro",
]

INTERESSE_LABELS = [
    "0 no resale interest at all",
    "1 vague resale interest (asked resale price once)",
    "2 solid interest (minimum, delivery, box price, how to start)",
    "3 concrete demand (quote, sample, registration or order requested)",
]

# --- Helpers ---

def find_anon_dir():
    """Locate wa-mining/anon dir under OPENCODE_SESSION_TEMP."""
    base = os.environ.get("OPENCODE_SESSION_TEMP",
              str(__import__("pathlib").Path.home().joinpath(
                  "AppData", "Local", "Temp", "opencode")))
    p = __import__("pathlib").Path(base) / "wa-mining" / "anon"
    if p.is_dir():
        return str(p)
    raise FileNotFoundError("anon dir not found: " + str(p))

def _fetch(conversation_text):
    """Send 3 parallel questions for one conversation. Return parsed answer dict."""
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise EnvironmentError("TYPESAFE_API_KEY not set")

    state = {
        "project": PROJECT_CTX,
        "conversation": conversation_text[:5500],  # safety cap
    }
    perguntas = {
        "objecao": {
            "type": "choice",
            "instructions": (
                "Classify the customer's main objection or need in this WhatsApp conversation "
                "with an acai wholesaler. Pick ONE label."
            ),
            "criteria": {
                "revenda_serio": (
                    "Genuine reseller prospect: mentions own business/delivery, asks barrel "
                    "or box prices, minimum order, conditions for starters."
                ),
                "varejo_curiosidade": (
                    "Asked about prices, flavors, where to buy or how to receive for personal/end "
                    "use; ALSO the DEFAULT when the customer asked price or product info with NO "
                    "explicit resale signal."
                ),
                "amostra_teste": (
                    "Wants to try/test the product before committing, asks for a sample."
                ),
                "produto_duvida": (
                    "Doubt about product attributes: purity, lactose, babies, storage, "
                    "expiration, temperature."
                ),
                "abrangencia_entrega": (
                    "Doubt about delivery coverage: neighborhood, Várzea Grande, other cities "
                    "in Mato Grosso."
                ),
                "cliente_existente": (
                    "Already bought with us; operational post-sale issue (more flavors, change "
                    "order, deliver today)."
                ),
                "concorrente_fornecedor": (
                    "Already buys from another supplier or is comparing suppliers."
                ),
                "sem_intencao": (
                    "Genuinely no substantive inquiry: only greetings, emoji, stickers, jokes, spam, "
                    "or questions unrelated to buying/reselling. Do NOT use when any price/product/ "
                    "resale question exists."
                ),
                "outro": "None of the above.",
            },
        },
        "interesse": {
            "type": "score",
            "instructions": (
                "Rate how close this lead got to becoming a reseller."
            ),
            "criteria": INTERESSE_LABELS,
        },
        "concreto": {
            "type": "noul",
            "instructions": (
                "Did the customer ask for something concrete: a quote, a resale price list, "
                "a sample, minimum order terms, or registration?"
            ),
        },
    }

    body = json.dumps({"model": MODEL, "state": state, "questions": perguntas}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    })
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read().decode("utf-8"))["answers"]

def _safe_fetch(conv_text):
    """Fetch with 1 retry on failure. Return (answers_dict, error_str|None)."""
    try:
        return _fetch(conv_text), None
    except Exception as e:
        err_msg = str(e)[:200]
        try:
            return _fetch(conv_text), err_msg  # single retry
        except Exception as e2:
            return None, "{} -> retry: {}".format(err_msg, str(e2)[:150])

# --- Main pipeline ---

def run(smoke=False):
    global ANON_DIR, OUTPUT_CSV
    ANON_DIR   = find_anon_dir()
    # Anon dir is at <temp>/wa-mining/anon; put CSV alongside other wa-mining outputs
    tmp_base = pathlib.Path(ANON_DIR).parent
    OUTPUT_CSV = str(tmp_base / "resultados.csv")

    json_files = sorted(pathlib.Path(ANON_DIR).glob("C*.json"))
    if not json_files:
        print("Nenhum JSON encontrado em " + ANON_DIR, file=sys.stderr)
        sys.exit(1)

    results = []
    total   = len(json_files)

    for idx, jf in enumerate(json_files, start=1):
        cid = jf.stem                       # e.g. C01
        rec = json.loads(jf.read_text(encoding="utf-8"))
        conv_id  = rec["id"]
        txt      = rec.get("texto_cliente", "")

        if smoke:
            # Only smoke-test the FIRST conversation
            print("\n[SMOKE] {}\n  Conversa {} msgs\n  Enviando…".format(cid, rec["n_cliente"]))
            answers, erro = _safe_fetch(txt)
            if erro:
                print("  ERRO: " + erro)
            else:
                # Print ONLY labels/confidences, never raw text
                obr = answers.get("objecao", {})
                obs = answers.get("interesse", {})
                ocn = answers.get("concreto", {})
                obc = obr.get("choice", "?")
                print("  objecao:      {} conf={:.2f}".format(obc, round(obr.get("confidence", 0), 3)))
                # Score may use 'value' or 'score' depending on API version
                svar = obs.get("value", obs.get("score", obs.get("value_int", "")))
                if svar == "" and isinstance(obs.get("probabilities"), list):
                    vals = obs["probabilities"]
                    if vals:
                        svar = vals.index(max(vals))
                print("  interesse:    val={} conf={:.2f}".format(svar, round(obs.get("confidence", 0), 3)))
                # Noul: could be bool or float; if float > 0.5 treat as True
                cnl = ocn.get("noul")
                con_bool_val = bool(cnl) if cnl not in (None, False, 0, "") else False
                print("  concreto:     {} conf={:.2f}".format(cnl, round(ocn.get("confidence", 0), 3)))
                print("  probabilities:")
                for k in ("objecao", "interesse", "concreto"):
                    ans_k = answers.get(k, {})
                    probs = ans_k.get("probabilities", ans_k.get("probs"))
                    if not probs:
                        print("    {}: <none>".format(k))
                        continue
                    if isinstance(probs, dict):
                        top = max(probs.items(), key=lambda x: x[1])
                        print("    {}: {} → {:.2f}".format(k, top[0], top[1]))
                    elif isinstance(probs, list):
                        vals = [(i, p) for i, p in enumerate(probs)]
                        top = max(vals, key=lambda x: x[1])
                        print("    {}: idx={} val={:.2f}".format(k, top[0], top[1]))
            break   # smoke = only first file

        answers, erro = _safe_fetch(txt)

        # Parse defensivamente
        obr = answers.get("objecao", {}) if answers else {}
        obs = answers.get("interesse", {}) if answers else {}
        ocn = answers.get("concreto", {}) if answers else {}

        obj_label  = obr.get("choice", "")
        obj_conf   = round(obr.get("confidence", 0), 4)

        int_val    = obs.get("value", "")
        int_conf   = round(obs.get("confidence", 0), 4)
        int_probs  = obs.get("probabilities")
        # Argmax index from probabilities (API returns DICT like {'0':0.05, '1':0.93, ...})
        if isinstance(int_probs, dict) and int_probs:
            argmax_key = max(int_probs.items(), key=lambda x: x[1])[0]
            int_val    = int(argmax_key)
        elif isinstance(int_probs, list) and int_probs:
            int_val    = int_probs.index(max(int_probs))

        con_noul = ocn.get("noul", False)
        # Noul type: API may return float confidence as 'noul' or bool
        if isinstance(con_noul, (int, float)):
            con_bool = con_noul > 0.5  # threshold for positive assertion
            # Derive confidence: distância de 0.5 escalada p/ [0,1]
            # p=0 ou p=1 → certidao total; p=0.5 → ambiguidade máxima
            con_conf = min(1.0, max(0.0, abs(con_noul - 0.5) * 2))
        else:
            con_bool = bool(con_noul)
            con_conf = 0.0              # sem valor numérico → incerteza total

        row = {
            "id":             conv_id,
            "objecao":        obj_label,
            "objecao_conf":   obj_conf,
            "interesse":      int_val,
            "interesse_conf": int_conf,
            "concreto":       con_bool,
            "concreto_conf":  con_conf,
        }
        if erro:
            row["erro"] = erro
        else:
            row["erro"] = ""
        results.append(row)

        if idx % 5 == 0 or idx == total:
            print("[{}/{}] {}".format(idx, total, conv_id))

    # --- Escreve CSV ---
    campos = ["id", "objecao", "objecao_conf", "interesse", "interesse_conf",
              "concreto", "concreto_conf", "erro"]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
        w.writeheader()
        w.writerows(results)

    # --- Agregado ---
    n_total = len(results)
    n_erro  = sum(1 for r in results if r.get("erro"))
    obj_counts = {}
    inters    = []
    concretos = 0
    conc_count = 0

    for r in results:
        o = r.get("objecao", "")
        if o:
            obj_counts[o] = obj_counts.get(o, 0) + 1
        iv = r.get("interesse", "")
        if iv != "" and iv is not None:
            inters.append(float(iv))
        cb = r.get("concreto")
        if cb is not None:
            conc_count += 1
            if cb:
                concretos += 1

    mean_int = sum(inters) / len(inters) if inters else 0

    print("\n" + "=" * 70)
    print("RESULTADO AGREGADO ({})".format(n_total))
    print("-" * 70)
    print("Objeção | Contagem")
    print("-" * 70)
    for label, cnt in sorted(obj_counts.items(), key=lambda x: -x[1]):
        bar = "#" * cnt
        print("{:20s} {:3d}  {}".format(label, cnt, bar))
    print("-" * 70)
    print("Média interesse:           {:.2f} / 3".format(mean_int))
    print("Concreto (sim / tot):      {}/{} ({}%)".format(
        concretos, conc_count,
        round(100 * concretos / conc_count, 1) if conc_count else "—"))
    print("Erros de rede/API:         {}".format(n_erro))
    print("=" * 70)
    print("CSV completo: " + OUTPUT_CSV)

# --- Entry point ---

if __name__ == "__main__":
    args = sys.argv[1:]
    smoke = "--smoke" in args or "-s" in args
    run(smoke=smoke)
