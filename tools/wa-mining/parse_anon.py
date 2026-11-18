#!/usr/bin/env python3
"""WhatsApp Business chat extractor + anonimizador (FASE 1 - minera\u00e7\u00e3o).

Python 3 stdlib. Output goes to TEMP ROOT - NEVER into repo.
"""
import csv
import glob
import hashlib
import json
import io
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

# Force UTF-8 stdout (Windows console may default to cp1252)
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# --- Configuration ---

_CONVERSAS_DIR_RAW = r"C:\Users\Kayo\Desktop\conversas whatsapp business\\"
CONVERSAS_DIR = Path(_CONVERSAS_DIR_RAW)
TEMP_ROOT   = Path(os.environ.get("OPENCODE_SESSION_TEMP",
              Path.home().joinpath("AppData", "Local", "Temp", "opencode")))
ANON_DIR    = TEMP_ROOT / "wa-mining" / "anon"

# Company phone numbers (digits only)
COMP_NUMS = {"5565992888228", "5565996949542",
             "65992888228",  "65996949542"}

# Set one of these for smoke test only:
SMOKE_ONLY = None          # e.g. "+33 6 98 20 06 03"
DRY_RUN    = False         # true = compute & print, skip file writes

# --- Regex patterns ---

RE_TS       = re.compile(r'^\[(\d{1,2}/\d{1,2}/\d{1,3}),\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\]\s+')
RE_SYSTEM_D = re.compile(r'^-\s+')          # system line after timestamp

def _clean_number(raw):
    """Strip everything that is not a digit."""
    return re.sub(r'\D', '', raw)

# --- Text reading ---

_ENCODINGS = ["utf-8-sig", "utf-16", "cp1252"]

def _read_txt(path):
    for enc in _ENCODINGS:
        try:
            return path.read_text(encoding=enc)
        except (UnicodeDecodeError, ValueError):
            continue
    return None

# --- Chat parser ---

def _msg_class(sender_raw):
    """Return 'DUPURO' if customer service bot or company number; else 'CLIENTE'."""
    if sender_raw == "Voc\u00ea":                   # "Você" (Portuguese for "You")
        return "DUPURO"
    n = _clean_number(sender_raw)
    if n in COMP_NUMS:
        return "DUPURO"
    return "CLIENTE"

def _date_iso(raw):
    """dd/m/yy -> yyyy-mm-dd"""
    parts = raw.split("/")
    d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
    year = 2000 + y if y < 100 else y
    return f"{year:04d}-{m:02d}-{d:02d}"

def parse_chat(text):
    """Return (client_messages_list, dupuro_count, n_media_discarded, start_date, end_date)."""
    client_msgs = []
    dupuro_msgs = 0
    n_media_discarded = 0
    dt_start = None
    dt_end   = None

    lines = text.splitlines()
    i = 0

    while i < len(lines):
        line = lines[i]

        m = RE_TS.match(line)
        if not m:
            i += 1
            continue

        ts_date, ts_time = m.group(1), m.group(2)
        rest = line[m.end():]

        # Update date window
        iso = _date_iso(ts_date)
        if dt_start is None or iso < dt_start:
            dt_start = iso
        if dt_end is None or iso > dt_end:
            dt_end = iso

        # System line? ('-' after timestamp)
        if rest.startswith("- "):
            i += 1
            continue

        # Split SENDER: from TEXT
        colon_pos = rest.find(":")
        if colon_pos <= 0:
            i += 1
            continue

        sender  = rest[:colon_pos].strip()
        content = rest[colon_pos + 1:].strip()

        msg_class = _msg_class(sender)

        # Consume continuation lines (no timestamp prefix)
        j = i + 1
        while j < len(lines):
            lm = RE_TS.match(lines[j])
            if lm:
                break
            content += "\n" + lines[j]
            j += 1

        # Normalize multiple newlines
        content = re.sub(r'\n{3,}', '\n\n', content)

        if msg_class == "CLIENTE":
            if _is_media_blob(content):
                n_media_discarded += 1      # discard media blobs entirely
            else:
                client_msgs.append(content)
        else:
            dupuro_msgs += 1

        i = j

    return client_msgs, dupuro_msgs, n_media_discarded, dt_start or "", dt_end or ""

# --- Anonymization ---

_RE_PHONES = re.compile(
    r'(?<!\w)'                          # não pode ter letra antes
    r'(?:\+?[\d]{1,3})?'                # opcional +XX país
    r'[\s.\-()]?'                       # separador inicial
    r'(\d[\d\s.\-()]*)'                 # captura o corpo todo
    r'(?!\w)',                          # não pode ter letra depois
)
# Será usado com filtro pós-match (≥8 dígitos, sem formato YYYY-MM-DD)
def _is_phone(text_fragment):
    """Retorna True se o fragmento parece número de telefone real."""
    digits_only = re.sub(r'\D', '', text_fragment)
    if len(digits_only) < 8:
        return False
    # Não é data ISO (YYYY-MM-DD tem exatamente 8 dígitos em formato 4-2-2)
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text_fragment.strip()):
        return False
    # Não é data completa no meio de texto JSON
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text_fragment.strip()):
        return False
    return True

# --- Media blob rejection (WhatsApp desktop embeds thumbnails as base64) ---

_RE_JPEG_BOM = re.compile(r'^\s*/9j/')
_RE_BASE64_LINE = re.compile(r'^[A-Za-z0-9+/]{80,}={0,2}$')
_RE_DATA_IMAGE = re.compile(r'data:image', re.IGNORECASE)

def _is_media_blob(text):
    """Return True if text is a WhatsApp-desktop embedded media blob."""
    stripped = text.strip()
    if _RE_JPEG_BOM.match(stripped):
        return True
    if _RE_DATA_IMAGE.search(stripped):
        return True
    # Single-line base64 block (>=80 chars, ends with 0-2 padding)
    for line in stripped.splitlines():
        if _RE_BASE64_LINE.match(line.strip()):
            return True
    return False

_RE_CPF    = re.compile(r'(?<!\d)\d{3}\.\d{3}\.\d{3}[-\s]?\d{2}(?!-?)')
_RE_CNPJ   = re.compile(r'(?<!\d)\d{2,3}\.\d{3}\.\d{3}/\d{4}[-\s]?\d{2}')
_RE_EMAIL  = re.compile(r'\S+@\S+\.\S+')
_RE_LONGDIG = re.compile(r'(?<!\d)\d{7,}(?!\d)')

def anon_text(text):
    """Replace sensitive data with placeholders."""
    text = _RE_CNPJ.sub('\u27e8cnpj\u27e9', text)     # <cnpj> angle-bracket style
    text = _RE_CPF.sub('\u27e8cpf\u27e9', text)        # <cpf>
    text = _RE_EMAIL.sub('\u27e8email\u27e9', text)    # <email>
    # Phone: validate each match to avoid dates/short numbers
    result = []
    last_end = 0
    for m in _RE_PHONES.finditer(text):
        full = m.group()
        frag = full[1:] if full.startswith('+') else full
        if _is_phone(frag):
            result.append(text[last_end:m.start()])
            result.append('\u27e8tel\u27e9')
            last_end = m.end()
    result.append(text[last_end:])
    text = ''.join(result)
    text = _RE_LONGDIG.sub('\u27e8num\u27e9', text)    # <num>
    return text

# --- Conversation discovery ---

def _find_txt(paths):
    """Prioritize chat.txt, then any .txt."""
    for p in paths:
        if p.name.lower() == "chat.txt":
            return p
    for p in paths:
        if p.suffix.lower() == ".txt":
            return p
    return None

def enumerate_conversations():
    """List conversations sorted lexicographically by original filename/folder name.
    Returns list of (name_str, txt_path_or_None_for_extracted)."""
    entries = []

    # Extracted folders (already have .txt on disk)
    for d in CONVERSAS_DIR.iterdir():
        if d.is_dir() and not d.name.endswith('.zip'):
            txt = _find_txt(list(d.glob("*.txt")))
            if txt:
                entries.append((d.name, str(txt)))

    # Zip files without corresponding extracted folder
    existing_names = set(e[0] for e in entries)
    tmp_stem_to_path = {}      # track temp unzip dirs to clean up later

    for zf in sorted(CONVERSAS_DIR.glob("*.zip")):
        if zf.stem in existing_names or zf.name in existing_names:
            continue
        with zipfile.ZipFile(zf) as zf_obj:
            txt_in_zip = None
            for info in zf_obj.infolist():
                fname_lower = info.filename.lower()
                if fname_lower.endswith(".txt"):
                    basename = os.path.basename(fname_lower)
                    if basename == "chat.txt" or txt_in_zip is None:
                        txt_in_zip = info.filename
            if txt_in_zip is None:
                continue
            # Extract temporarily
            stem_name = zf.stem
            if stem_name in existing_names:
                continue
            tmp_dir = TEMP_ROOT / "wa-mining" / "_unzip_tmp" / stem_name
            tmp_dir.mkdir(parents=True, exist_ok=True)
            zf_obj.extract(txt_in_zip, str(tmp_dir))
            txt_path = tmp_dir / os.path.basename(txt_in_zip)
            entries.append((stem_name, str(txt_path)))
            tmp_stem_to_path[stem_name] = tmp_dir

    # Sort lexicographically
    entries.sort(key=lambda e: e[0])
    return entries, tmp_stem_to_path

# --- Main pipeline ---

def run_pipeline(batch=True):
    convos, tmp_stems = enumerate_conversations()
    if SMOKE_ONLY:
        convos = [(n, p) for n, p in convos if n == SMOKE_ONLY]
        if not convos:
            print(f"ERROR: conversation '{SMOKE_ONLY}' not found.", file=sys.stderr)
            sys.exit(1)

    ANON_DIR.mkdir(parents=True, exist_ok=True)

    all_stats = []
    all_questions = {}      # question_text -> count (global dedup)
    total = len(convos)

    for idx, (orig_name, txt_path) in enumerate(convos, start=1):
        cid = f"C{idx:02d}"

        text = _read_txt(Path(txt_path))
        if text is None:
            print(f"WARN: could not read {txt_path}", file=sys.stderr)
            continue

        # Skip encryption banner (first line)
        first_nl = text.find('\n')
        if 0 < first_nl < 200 and any(kw in text[:first_nl] for kw in ['criptografia', 'encrypt', 'encryption']):
            text = text[first_nl + 1:]
        elif text.strip().startswith('As mensagens'):
            nl_idx = text.find('\n')
            if nl_idx > 0:
                text = text[nl_idx + 1:]

        client_msgs, dupuro_count, n_media_discarded, dt_start, dt_end = parse_chat(text)

        # Questions containing '?', anonymized
        questions = []
        for cm in client_msgs:
            if '?' in cm:
                q = anon_text(cm)
                questions.append(q)

        # Join questions for truncated full text output
        joined = "\n".join(questions)
        joined_short = joined[:6000]

        record = {
            "id": cid,
            "data_inicio": dt_start,
            "data_fim": dt_end,
            "n_cliente": len(client_msgs),
            "n_dupuro": dupuro_count,
            "n_midia_descartada": n_media_discarded,
            "msgs_cliente": [anon_text(cm) for cm in client_msgs],
            "texto_cliente": joined_short,
            "perguntas": questions,
        }

        if DRY_RUN:
            print(f"[DRY RUN] {cid} ({orig_name}): {record['n_cliente']} cli, {record['n_dupuro']} dupro, {dt_start}->{dt_end}")
            print(f"  Sample question: {questions[0] if questions else '(none)'}")
            continue

        # Write individual JSON
        fpath = ANON_DIR / f"{cid}.json"
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        all_stats.append({
            "id": cid,
            "n_cliente": len(client_msgs),
            "n_dupuro": dupuro_count,
            "data_inicio": dt_start,
            "data_fim": dt_end,
            "origem": orig_name,
        })

        # Accumulate global questions for dedup
        for q in questions:
            all_questions[q] = all_questions.get(q, 0) + 1

    # --- Stats CSV ---
    stats_path = TEMP_ROOT / "wa-mining" / "stats.csv"
    with open(stats_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "n_cliente", "n_dupuro", "data_inicio", "data_fim"])
        writer.writeheader()
        for row in all_stats:
            writer.writerow({k: v for k, v in row.items() if k != "origem"})

    # --- Local map (THIS file only - contains original names) ---
    mapa_path = TEMP_ROOT / "wa-mining" / "mapa-local.csv"
    with open(mapa_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "arquivo_origem"])
        for row in all_stats:
            w.writerow([row["id"], row["origem"]])

    # --- Deduplicated questions ---
    pq_path = TEMP_ROOT / "wa-mining" / "perguntas-dedup.txt"
    with open(pq_path, "w", encoding="utf-8") as f:
        sorted_q = sorted(all_questions.items(), key=lambda x: -x[1])
        f.write("# Customer questions (anonymized) - {} unique\\n".format(len(sorted_q)))
        f.write("# Format: [Nx] question\\n\\n")
        for qtext, cnt in sorted_q:
            f.write("[{}] {}\n".format(cnt, qtext))

    # --- Summary ---
    print("\n[OK] Batch complete - {} conversations processed".format(total))
    print("  Statistics:    {}".format(stats_path))
    print("  Map:           {}".format(mapa_path))
    print("  Questions dedup:{} ".format(pq_path))
    print("  JSONs:         {}/".format(ANON_DIR))

    # Clean up temp unzip dirs
    for stem, tdir in tmp_stems.items():
        try:
            shutil.rmtree(str(tdir), ignore_errors=True)
        except OSError:
            pass

# --- Self-test PII ---

# Helpers that map a PII category name to its regex + validation function
PII_RULES = {
    "telefone":    (_RE_PHONES, lambda frag: _is_phone(frag)),
    "cpf":         (_RE_CPF,    lambda _: True),
    "cnpj":        (_RE_CNPJ,   lambda _: True),
    "email":       (_RE_EMAIL,  lambda _: True),
    "numeros_long":(_RE_LONGDIG,lambda _: True),
}

def _pii_hit_count(text, cat_name):
    """Count real PII violations of a given category in a text string."""
    regex, validator = PII_RULES[cat_name]
    count = 0
    for m in regex.finditer(text):
        full = m.group()
        # For phone, strip optional leading + before validation
        frag = full[1:] if full.startswith('+') else full
        if validator(frag):
            count += 1
    return count

def self_test_pii():
    """Re-read all outputs and check for PII leakage."""
    print("\n[PII TEST] Re-analyzing outputs...\n")
    files_json = list(ANON_DIR.glob("C*.json"))
    pq_file    = TEMP_ROOT / "wa-mining" / "perguntas-dedup.txt"
    total_violations = 0

    for pat_name in PII_RULES:
        matches_per_file = {}
        # Check each JSON
        for jp in files_json:
            content = jp.read_text(encoding="utf-8")
            hits = [(ln, None) for ln, line in enumerate(content.splitlines(), 1)
                    if _pii_hit_count(line, pat_name) > 0]
            if hits:
                matches_per_file[str(jp)] = hits
        # Check questions dedup
        if pq_file.exists():
            hits = []
            for ln, line in enumerate(pq_file.read_text(encoding="utf-8").splitlines(), 1):
                if _pii_hit_count(line, pat_name) > 0:
                    hits.append((ln, None))
            if hits:
                matches_per_file[str(pq_file)] = hits

        count = sum(len(v) for v in matches_per_file.values())
        status = "[ZERO]" if count == 0 else "[WARN {} hits]".format(count)
        print("  {:20s}: {}".format(pat_name, status))
        if count > 0:
            for fp, hs in matches_per_file.items():
                line_nums = set(h[0] for h in hs)
                print("    WARN {}: {} line(s) affected".format(fp, len(hs)))
            total_violations += count

    if total_violations == 0:
        print("\n[PASS] Self-test PASSED - no PII detected in outputs.")
    else:
        print("\n[FAIL] Self-test FAILED - {} potential leak(s).".format(total_violations), file=sys.stderr)
    return total_violations == 0

# --- Smoke test display ---

def smoke_show_sample():
    """For first conversation: show full structure with placeholders."""
    convos, _ = enumerate_conversations()
    if not convos:
        print("No conversations found.", file=sys.stderr)
        return
    orig_name, txt_path = convos[0]
    text = _read_txt(Path(txt_path))
    if text and ('criptografia' in text[:text.find('\n')] if text.find('\n') > 0 else ''):
        text = text[text.find('\n') + 1:]

    client_msgs, dupuro_count, n_media_discarded, dt_start, dt_end = parse_chat(text)

    print("\n" + "="*60)
    print("SMOKE TEST - sample: {}".format(orig_name))
    print("  Date:     {} -> {}".format(dt_start, dt_end))
    print("  Client:   {} msgs".format(len(client_msgs)))
    print("  Dupuro:   {} msgs".format(dupuro_count))
    if n_media_discarded > 0:
        print("  Media discartada: {} blocos base64 removidos".format(n_media_discarded))
    print("="*60 + "\n")

    for i, cm in enumerate(client_msgs[:3]):
        anon = anon_text(cm)
        print("  [customer {}] {}".format(i + 1, repr(anon[:120])))
    if len(client_msgs) > 3:
        print("  ... +{} more customer message(s) omitted".format(len(client_msgs) - 3))

    # Questions
    questions = [anon_text(cm) for cm in client_msgs if '?' in cm]
    print("\n  Questions detected: {}".format(len(questions)))
    for q in questions[:3]:
        print("    ? {}".format(repr(q[:100])))

# --- Entry point ---

def main():
    args = sys.argv[1:]

    # Smoke-only mode
    if "--smoke" in args:
        smoke_show_sample()
        return

    # Full batch
    run_pipeline(batch=True)

    # Run self-test after writing
    passed = self_test_pii()

    if not passed:
        print("\nReview the script before rerunning.", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
