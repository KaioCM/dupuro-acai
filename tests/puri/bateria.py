#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bateria de testes da Puri (assistente do site Dupuro Acai).

Uso:
  python bateria.py --alvo dev                    (padrao)
  python bateria.py --alvo prod --confirmo-prod   (gasta a cota de clientes!)
  python bateria.py --casos wikipedia,rio         (so alguns casos)
  python bateria.py --comparar A.json B.json      (gera .md lado a lado)
  python bateria.py --juntar A.json B.json --saida CAMINHO_SEM_EXTENSAO   (mesmo alvo)
  python bateria.py --reavaliar X.json            (OFFLINE: reaplica as checagens atuais sobre as conversas gravadas e regrava .json/.md)

So biblioteca padrao. Nao usa IA para avaliar: so checagens simples (regex).
O driver_v1 reproduz o protocolo ATUAL do front (assets/js/puri.js). Para o protocolo novo,
escreva driver_v2 e registre em DRIVERS.
"""
import argparse, json, os, re, sys, time, unicodedata, urllib.request, urllib.error
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", ".."))
PASTA_RES = os.path.join(AQUI, "resultados")

# ---- textos fixos do front atual (assets/js/puri.js), usados nos trechos que o front responde sozinho ----
T = {
    "humano": "Tudo bem. Vou te passar pra uma pessoa.",
    "incerto": "Não entendi bem. Escolhe uma das opções.",
    "incertoAb": "Não peguei bem. Você quer revender, comprar pra você, provar ou tirar uma dúvida?",
    "olaSocial": "Oi, tudo bem? Eu sou a Puri. Me conta: você quer revender, comprar pra você, provar antes ou tirar uma dúvida?",
    "escolhe": "Escolhe uma das opções.",
    "provar": "Dá pra provar de dois jeitos. Qual você prefere?",
    "visitaIntro": "A visita é grátis, de segunda a sexta, das 8h às 17h, em Cuiabá e Várzea Grande.",
    "pCidade": "Em qual cidade você está?",
    "foraCidade": "Por enquanto a visita é só em Cuiabá e Várzea Grande. Você pode provar na fábrica ou, se for revender, retirar na fábrica.",
    "retira": "Por enquanto a gente entrega só em Cuiabá e Várzea Grande. Consegue retirar na fábrica em Cuiabá?",
    "naoAcai": "Você quer mesmo vender açaí?",
    "fimNaoAcai": "Tudo bem. Se mudar de ideia sobre o açaí, é só voltar aqui.",
    "fimConsumo": "Então o delivery é o caminho mais rápido: https://www.dupuroacai.com/delivery",
    "fimEspera": "Anotei seu contato. A gente avisa quando chegar na sua cidade.",
    "naoEntendi": "Não entendi direitinho. Toca numa das opções ou escreve de outro jeito.",
    "fabrica": "A fábrica fica na Av. das Torres, nº 16, Jardim Imperial II, Cuiabá-MT. Funciona de segunda a sábado, das 13h às 19h30. Quando quiser revender, é só chamar aqui.",
    "FORA": "Entregamos só em Cuiabá e Várzea Grande. De outra cidade, dá pra revender retirando na fábrica.",
}
FALA_R = {
    "cidade": "Em que cidade?",
    "bairro": "E o bairro?",
    "objetivo": "O que você quer com a revenda? Pode contar do seu jeito.",
    "movimento": "Quantos copos por dia você vende (ou imagina vender)?",
}
SEG_ROT = {"delivery_acai": "delivery de açaí", "acaiteria": "açaiteria", "lanchonete_bar": "lanchonete ou bar",
           "sorveteria": "sorveteria", "feira_evento": "feira ou evento", "mercado_varejo": "mercado ou varejo",
           "revenda_casa": "revenda em casa", "outro": "outro tipo de negócio"}
MOV_ROT = {"ate20": "Até 20", "20a50": "20 a 50", "50a100": "50 a 100", "100mais": "Mais de 100"}
REACAO_ROT = {"mosca": "Na mosca", "parte": "Em parte", "nao": "Não, é outra coisa"}


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).lower()
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def ler_config():
    caminho = os.path.join(RAIZ, "assets", "js", "supabase-config.js")
    try:
        cfg = open(caminho, encoding="utf-8").read()
    except OSError as e:
        sys.exit(f"ERRO: não consegui abrir {caminho}: {e}")
    mu = re.search(r"DUPURO_SUPABASE_URL\s*=\s*(['\"])(.+?)\1", cfg)
    mk = re.search(r"DUPURO_SUPABASE_ANON_KEY\s*=\s*(['\"])(.+?)\1", cfg)
    if not mu or not mk:
        sys.exit(f"ERRO: não achei DUPURO_SUPABASE_URL / DUPURO_SUPABASE_ANON_KEY (entre aspas simples ou duplas) em {caminho}")
    return mu.group(2).rstrip("/"), mk.group(2)


# limites de tempo do front (s): acima disso a chamada e marcada como lenta
LIM_10 = {"segmento", "perfil", "escutar", "simulacao"}
LIM_25 = {"aprofundar", "palpite", "resumo", "mapa", "mapa_ajuste"}


def limite_s(acao, passo):
    if acao == "mensagem":
        return 10
    if acao == "revenda":
        if passo in LIM_10:
            return 10
        if passo in LIM_25:
            return 25
    return None


def lentas(chamadas):
    out = []
    for ch in chamadas or []:
        lim = limite_s(ch.get("acao"), ch.get("passo"))
        if lim and ch.get("ms", 0) > lim * 1000:
            out.append({"acao": ch.get("acao"), "passo": ch.get("passo"), "ms": ch.get("ms"), "limite_s": lim})
    return out


# ---------------------------------------------------------------- sessao (uma conversa = um lead)
class Sessao:
    def __init__(self, url, key, func):
        self.url, self.key, self.func = url, key, func
        self.token = None
        self.chamadas = []   # requisicoes reais ao servidor
        self.conversa = []   # falas legiveis (cliente/puri), origem servidor ou front-simulado
        self.erro = None
        self.ultimo = None   # ultima resposta de mensagem (para checagens)
        self.intencao = None
        self.eventos = {}
        self.offline = False          # True no --reavaliar: nunca chama a API
        # campos neutros (preenchidos pelo driver; um driver_v2 deve preencher os mesmos)
        self.encaminhou = False       # a Puri encaminhou para pessoa (tipo humano / flag humano / intencao humano)
        self.fora_area = None         # True/False quando o fluxo de revenda informou; None se nao chegou la
        self.pediu_confirmacao = None # dict {achou, trecho, fechada} sobre perguntar se quer mesmo vender acai
        # campos novos (driver_v2)
        self.retira = False               # revenda retirando na fabrica (cliente de fora da area)
        self.lista_espera_ok = False      # lista de espera gravada
        self.esclarecer_recebido = False  # perfil devolveu pedido de esclarecimento
        self.cena_recebida = False        # escutar final devolveu cena
        self.alternativas_recebidas = False  # palpite_resp devolveu alternativas
        self.termo_recebido = False       # resumo devolveu termo
        self.mapa_simples = False         # mapa veio no modo simples

    def registrar_revenda(self, passo, req, r):
        """Atualiza flags/eventos a partir de uma resposta ok de revenda (usado ao vivo e no --reavaliar)."""
        req = req or {}
        r = r or {}
        if passo == "perfil":
            self.fora_area = r.get("fora_area") is True
            self.eventos["fora_area"] = self.fora_area
            if req.get("retira") is True:
                self.retira = True
            if isinstance(r.get("esclarecer"), dict) and r["esclarecer"].get("pergunta"):
                self.esclarecer_recebido = True
        elif passo == "escutar" and req.get("final") is True:
            if r.get("nao_acai") is True:
                self.pediu_confirmacao = {"achou": True, "trecho": "nao_acai", "fechada": True}
                self.eventos["nao_acai"] = True
            if r.get("cena"):
                self.cena_recebida = True
        elif passo == "lista_espera":
            self.lista_espera_ok = True
        elif passo == "interpretar" and req.get("etapa") == "movimento":
            self.eventos["movimento_interpretado"] = r.get("escolha")
        elif passo == "palpite":
            self.eventos["palpite"] = r.get("palpite")
        elif passo == "palpite_resp":
            if isinstance(r.get("alternativas"), list) and r["alternativas"]:
                self.alternativas_recebidas = True
        elif passo == "resumo":
            if r.get("termo"):
                self.termo_recebido = True
        elif passo == "destino":
            self.eventos["destino"] = r.get("destino")
            self.eventos["visita"] = r.get("visita")
        elif passo == "mapa":
            self.eventos["chegou_ao_fim"] = True
            if r.get("simples") is True:
                self.mapa_simples = True

    def registrar_flags(self, r):
        if isinstance(r.get("acoes"), list):
            self.eventos["acoes"] = r["acoes"]
        if r.get("humano") is True:
            self.eventos["humano"] = True
        if r.get("fora") is True:
            self.eventos["fora"] = True
        if r.get("tipo") == "humano" or r.get("humano") is True or r.get("intencao") == "humano":
            self.encaminhou = True

    def catalogo(self):
        if self.offline:
            for ch in self.chamadas:
                if ch.get("acao") == "catalogo":
                    return ch.get("resp")
            return None
        return self.post({"acao": "catalogo"})

    def post(self, corpo, timeout=40, rotulo=None):
        t0 = time.time()
        req_log = dict(corpo)
        if "token" in req_log:
            req_log["token"] = "<token>"
        reg = {"acao": corpo.get("acao"), "passo": corpo.get("passo") or corpo.get("etapa"), "req": req_log}
        data = json.dumps(corpo).encode("utf-8")
        rq = urllib.request.Request(
            f"{self.url}/functions/v1/{self.func}", data=data, method="POST",
            headers={"apikey": self.key, "Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        resp, http = None, None
        try:
            with urllib.request.urlopen(rq, timeout=timeout) as r:
                http = r.status
                resp = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            http = e.code
            try:
                resp = json.loads(e.read().decode("utf-8"))
            except Exception:
                resp = {"ok": False, "motivo": f"http_{e.code}"}
        except Exception as e:
            resp = {"ok": False, "motivo": "timeout_ou_rede", "detalhe": type(e).__name__}
        reg["http"] = http
        reg["resp"] = resp
        reg["ms"] = int((time.time() - t0) * 1000)
        self.chamadas.append(reg)
        time.sleep(0.4)
        return resp

    def cliente(self, texto, origem="cliente"):
        self.conversa.append({"quem": "cliente", "texto": texto})

    def puri(self, texto, origem="servidor", **flags):
        f = {"quem": "puri", "texto": texto, "origem": origem}
        chips = flags.pop("chips", None)
        intencao = flags.pop("intencao", None)
        f.update({k: True for k, v in flags.items() if v})
        if isinstance(chips, list) and chips:
            f["chips"] = [str(c) for c in chips]
            self.eventos.setdefault("chips", []).extend(f["chips"])
        if isinstance(intencao, str) and intencao:
            f["intencao"] = intencao
            self.eventos["intencao_resposta"] = intencao
        self.conversa.append(f)

    def falha(self, resp, onde):
        self.erro = f"{onde}: {(resp or {}).get('motivo', 'sem resposta')}"
        return False

    def iniciar(self, pagina="home"):
        r = self.post({"acao": "iniciar", "pagina": pagina})
        if r and r.get("ok") and r.get("token"):
            self.token = r["token"]
            return True
        return self.falha(r, "iniciar")

    def mensagem(self, etapa, texto):
        if not self.token and not self.iniciar():
            return None
        r = self.post({"acao": "mensagem", "token": self.token, "etapa": etapa, "texto": texto})
        if not r or not r.get("ok"):
            self.falha(r, "mensagem/" + etapa)
            return None
        self.ultimo = r
        self.registrar_flags(r)
        return r

    def revenda(self, passo, critico=True, **kw):
        r = self.post({"acao": "revenda", "token": self.token, "passo": passo, **kw})
        if not r or not r.get("ok"):
            if critico:
                self.falha(r, "revenda/" + passo)
            return None
        self.registrar_revenda(passo, kw, r)
        return r


# ---------------------------------------------------------------- driver_v1: protocolo ATUAL (puri.js)
def _tratar_resposta(s, r, texto, etapa="abertura"):
    """Espelha tratar() do front: resposta/humano mostram texto; intencao leva ao fluxo (ou 2a chamada como duvida)."""
    if r.get("tipo") in ("resposta", "humano"):
        txt = r.get("texto") or ""
        if not txt and r.get("tipo") == "humano":
            s.puri(T["humano"], "front-simulado", humano=r.get("humano") is True, fora=r.get("fora") is True,
                   chips=r.get("chips"), intencao=r.get("intencao"))
        else:
            s.puri(txt, humano=r.get("humano") is True, fora=r.get("fora") is True,
                   chips=r.get("chips"), intencao=r.get("intencao"))
        return
    if r.get("tipo") == "intencao":
        it = r.get("intencao")
        s.intencao = it
        if it == "humano":
            s.puri(T["humano"], "front-simulado")
        elif it in ("revender", "consumir", "provar"):
            s.puri(f"[o front abriria o fluxo: {it}]", "front-simulado")
        elif it == "social":
            # cumprimento/agradecimento: o front mostra o texto (ou T.olaSocial) com os chips da abertura e continua na abertura
            tx = r.get("texto")
            s.puri(tx if isinstance(tx, str) and tx else T["olaSocial"], "front-simulado")
        elif it == "duvida":
            if etapa == "duvida":
                # ja era a etapa de duvida: o front nao recursa
                s.puri(T["incertoAb"], "front-simulado")
            else:
                # o front repete o mesmo texto como etapa duvida (2a chamada)
                r2 = s.mensagem("duvida", texto)
                if r2:
                    _tratar_resposta(s, r2, texto, "duvida")
        else:
            s.puri(T["incertoAb"], "front-simulado")


def driver_v1(caso, s):
    tipo = caso["tipo"]
    if tipo in ("duvida", "abertura"):
        etapa = "duvida" if tipo == "duvida" else "abertura"
        for e in caso["entradas"]:
            s.cliente(e["texto"])
            r = s.mensagem(etapa, e["texto"])
            if not r:
                return
            _tratar_resposta(s, r, e["texto"], etapa)
        return
    if tipo == "provar":
        return _driver_v1_provar(caso, s)
    if tipo == "revenda":
        return _driver_v1_revenda(caso, s)
    s.erro = "tipo de caso desconhecido: " + tipo


def _driver_v1_provar(caso, s):
    # tudo isto o front responde sozinho (sem chamar o servidor), como em aoChipVisita()
    s.cliente("Quero provar antes")
    s.puri(T["provar"], "front-simulado")
    for e in caso["entradas"]:
        esc = e.get("escolha")
        if e["passo"] == "provar" and esc == "vendedor":
            s.cliente("Receber um vendedor com amostras")
            s.puri(T["visitaIntro"] + " " + T["pCidade"], "front-simulado")
        elif e["passo"] == "cidade" and esc == "Outra cidade":
            s.cliente("Outra cidade")
            s.puri(T["foraCidade"], "front-simulado")
        elif e["passo"] == "pos" and "fábrica" in (esc or ""):
            s.cliente("Visitar a fábrica")
            s.puri(T["fabrica"], "front-simulado")


RE_CONFIRMA = (r"quer mesmo (vender|revender)|voce quer (mesmo )?(vender|revender) acai ?\?|"
               r"realmente quer (vender|revender) acai|e isso mesmo que voce quer|"
               r"(vender|revender) acai de verdade ?\?|quer vender acai mesmo")


def janela_confirmacao(conversa, obj_txt):
    """Falas da Puri entre o objetivo do cliente e o passo de simulacao/aprofundar.
    Retorna {achou, trecho, fechada} ou None se o objetivo nao esta na conversa."""
    idx = next((i for i, c in enumerate(conversa) if c["quem"] == "cliente" and c["texto"] == obj_txt), None)
    if idx is None:
        return None
    janela, fechada = [], False
    for c in conversa[idx + 1:]:
        if c["quem"] != "puri":
            continue
        t = c["texto"]
        if t.startswith("Fiz uma conta") or t.startswith("[cartão]") or "| Pular]" in t:
            fechada = True
            break
        janela.append(t)
    m = re.search(RE_CONFIRMA, norm(" \n ".join(janela)))
    return {"achou": bool(m), "trecho": m.group(0) if m else None, "fechada": fechada}


def _driver_v1_revenda(caso, s):
    _revenda_fluxo(caso, s)
    obj = next((e.get("texto") for e in caso["entradas"] if e["passo"] == "objetivo"), None)
    if obj:
        s.pediu_confirmacao = janela_confirmacao(s.conversa, obj)


def _revenda_fluxo(caso, s):
    E = {e["passo"]: e for e in caso["entradas"]}
    s.cliente("Quero revender")
    if not s.iniciar():
        return
    # 1. segmento (texto livre -> chamada)
    seg_txt = E["segmento"]["texto"]
    s.cliente(seg_txt)
    r = s.revenda("segmento", texto=seg_txt)
    if not r:
        return
    segmento = r.get("segmento") or "outro"
    s.puri(f"Anotei: {SEG_ROT.get(segmento, segmento)}. {FALA_R['cidade']}", "front-simulado")
    # 2. cidade e bairro (so no front)
    cid_txt = E["cidade"]["texto"]
    n = norm(cid_txt)
    cidade = "Cuiabá" if "cuiab" in n else ("Várzea Grande" if "varzea" in n else cid_txt[:60])
    s.cliente(cid_txt)
    s.puri(FALA_R["bairro"], "front-simulado")
    bairro = None
    if "bairro" in E:
        bairro = E["bairro"]["texto"]
        s.cliente(bairro)
    s.puri(FALA_R["objetivo"], "front-simulado")
    # 3. objetivo (escuta final)
    obj = E["objetivo"]["texto"]
    s.cliente(obj)
    r = s.revenda("escutar", texto=obj, final=True)
    if not r:
        return
    an = [a.strip().rstrip(". ") for a in (r.get("anotacoes") or []) if isinstance(a, str) and a.strip()]
    s.puri(("Anotei: " + "; ".join(an) + ". " if an else "Anotado. ") + FALA_R["movimento"], "front-simulado")
    # 4. movimento (o front so aceita chip; texto digitado vira "Escolhe uma das opcoes.")
    m = E["movimento"]
    if "texto" in m:
        s.cliente(m["texto"])
        s.puri(T["escolhe"], "front-simulado")
        mov = m["depois_escolha"]
    else:
        mov = m["escolha"]
    s.cliente(MOV_ROT[mov])
    # 5. perfil
    corpo = {"segmento": segmento, "cidade": cidade, "movimento": mov}
    if bairro:
        corpo["bairro"] = bairro
    r = s.revenda("perfil", **corpo)
    if not r:
        return
    s.eventos["fora_area"] = r.get("fora_area") is True
    s.fora_area = r.get("fora_area") is True
    if r.get("fora_area") is True:
        s.puri(T["FORA"], "front-simulado")
    # 6. simulacao
    preco = E["preco"]["escolha"]
    s.puri("Fiz uma conta rápida com o seu movimento.", "front-simulado")
    r = s.revenda("simulacao", preco_copo=preco)
    if not r:
        return
    sim = r.get("simulacao") or {}
    s.puri(f"[cartão] 1 caixa de 10 L ≈ 20 copos; venda R$ {sim.get('venda_caixa')}, custo R$ {sim.get('custo_caixa')}, sobra R$ {sim.get('sobra_caixa')} por caixa", "front-simulado")
    s.cliente("Continuar")
    # 7. aprofundar
    r = s.revenda("aprofundar")
    if not r:
        return
    perg = r.get("pergunta")
    if perg:
        s.puri(perg + "  [chips: " + " | ".join(r.get("respostas") or []) + " | Pular]")
        if "aprofundar_resp" in E:
            resp_ap = E["aprofundar_resp"]["texto"]
        else:
            resp_ap = (r.get("respostas") or [""])[0]
        if resp_ap:
            s.cliente(resp_ap)
            if not s.revenda("aprofundar_resp", texto=resp_ap):
                return
    # 8. palpite
    r = s.revenda("palpite")
    if not r:
        return
    palpite = r.get("palpite")
    s.eventos["palpite"] = palpite
    if palpite:
        s.puri(palpite + "  [chips: Na mosca | Em parte | Não, é outra coisa]")
        pe = E.get("palpite", {})
        reacao = pe.get("reacao", "mosca")
        s.cliente(REACAO_ROT[reacao] + (": " + pe["texto"] if pe.get("texto") else ""))
        kw = {"valor": reacao}
        if reacao == "nao" and pe.get("texto"):
            kw["texto"] = pe["texto"]
        if not s.revenda("palpite_resp", **kw):
            return
    # 9. resumo
    r = s.revenda("resumo")
    if not r:
        return
    if r.get("resumo"):
        s.puri(f"[cartão] O que ficou do que você contou: {r['resumo']} (problema: {r.get('problema')})")
    # 10. mapa
    r = s.revenda("mapa")
    if not r:
        return
    mapa = r.get("mapa")
    if mapa and mapa.get("nos"):
        s.puri("[mapa do caso] " + " -> ".join(f"{n.get('titulo') or n.get('tipo')}: {n.get('texto')}" for n in mapa["nos"]))
        s.cliente("Está certo")
        s.revenda("mapa_ok", critico=False)  # o front ignora falha aqui: nao vira ERRO_TEC
    s.eventos["chegou_ao_fim"] = True


# ---------------------------------------------------------------- driver_v2: protocolo NOVO (docs/assistente/ETAPA2-CONTRATO.md)
OPC_QUALIF = {
    "ja_vende": [("ja_vendo", "Já vendo"), ("quero_comecar", "Quero começar"), ("outras_coisas", "Vendo outras coisas")],
    "comeco": [("esta_semana", "Esta semana"), ("este_mes", "Este mês"), ("pesquisando", "Só pesquisando")],
    "papel": [("dono", "Sou o dono"), ("socio", "Sou sócio"), ("trabalho", "Trabalho lá"), ("vou_abrir", "Vou abrir")],
    "conheceu": [("instagram", "Instagram"), ("indicacao", "Indicação"), ("google", "Google"),
                 ("compro_loja", "Compro na loja"), ("outro", "Outro")],
}
PADRAO_QUALIF = {"ja_vende": "quero_comecar", "comeco": "este_mes", "papel": "dono", "conheceu": "instagram"}


def _opcoes(pares):
    return [{"id": i, "rotulo": r} for i, r in pares]


def _interpretar(s, etapa, texto, opcoes):
    """Passo `interpretar`: devolve o id escolhido (de opcoes) ou None."""
    r = s.revenda("interpretar", critico=False, etapa=etapa, texto=texto, opcoes=opcoes)
    esc = (r or {}).get("escolha")
    return esc if esc in [o["id"] for o in opcoes] else None


def _qualif(s, E, campo):
    e = E.get(campo, {})
    pares = OPC_QUALIF[campo]
    rot = dict(pares)
    if "texto" in e and "escolha" not in e:
        s.cliente(e["texto"])
        esc = _interpretar(s, campo, e["texto"], _opcoes(pares))
        corpo = {"valor": esc} if esc else {"valor": "texto", "texto": e["texto"]}
    else:
        esc = e.get("escolha", PADRAO_QUALIF[campo])
        s.cliente(rot.get(esc, esc))
        corpo = {"valor": esc}
    return s.revenda("qualif", campo=campo, **corpo)


def driver_v2(caso, s):
    tipo = caso["tipo"]
    if tipo in ("duvida", "abertura"):
        etapa = "duvida" if tipo == "duvida" else "abertura"
        for e in caso["entradas"]:
            s.cliente(e["texto"])
            r = s.mensagem(etapa, e["texto"])
            if not r:
                return
            _tratar_resposta(s, r, e["texto"], etapa)
            if etapa == "abertura" and isinstance(r.get("acoes"), list):
                s.eventos["acoes"] = r["acoes"]
        return
    if tipo == "provar":
        return _driver_v1_provar(caso, s)
    if tipo == "revenda":
        _driver_v2_revenda(caso, s)
        if not s.pediu_confirmacao:
            obj = next((e.get("texto") for e in caso["entradas"] if e["passo"] == "objetivo"), None)
            if obj:
                s.pediu_confirmacao = janela_confirmacao(s.conversa, obj)
        return
    s.erro = "tipo de caso desconhecido: " + tipo


def _driver_v2_revenda(caso, s):
    E = {e["passo"]: e for e in caso["entradas"]}
    s.cliente("Quero revender")
    if not s.iniciar():
        return
    # 1. segmento (se confianca < 0,7: escolhe a 1a sugestao)
    seg_txt = E["segmento"]["texto"]
    s.cliente(seg_txt)
    r = s.revenda("segmento", texto=seg_txt)
    if not r:
        return
    segmento = r.get("segmento") or "outro"
    conf = r.get("confianca")
    sug = [k for k in (r.get("sugestoes") or []) if isinstance(k, str)]
    if isinstance(conf, (int, float)) and conf < 0.7 and sug:
        s.puri("Acho que é um destes. Qual chega mais perto?  [chips: " + " | ".join(SEG_ROT.get(k, k) for k in sug) + " | Outro]", "front-simulado")
        segmento = sug[0]
        s.cliente(SEG_ROT.get(segmento, segmento))
    s.puri(f"Anotei: {SEG_ROT.get(segmento, segmento)}.", "front-simulado")
    # 2. ja_vende
    if not _qualif(s, E, "ja_vende"):
        return
    # 3. cidade (so no front); fora da area: retira
    s.puri(FALA_R["cidade"], "front-simulado")
    cid_txt = E["cidade"]["texto"]
    n = norm(cid_txt)
    cidade = "Cuiabá" if "cuiab" in n else ("Várzea Grande" if "varzea" in n else cid_txt[:60])
    fora = not ("cuiab" in n or "varzea" in n)
    s.cliente(cid_txt)
    retira = False
    if fora:
        s.fora_area = True
        s.eventos["fora_area"] = True
        s.puri(T["retira"], "front-simulado")
        esc = E.get("retira", {}).get("escolha", "sim")
        s.cliente("Sim, consigo retirar" if esc == "sim" else "Não consigo")
        if esc != "sim":
            le = E.get("lista_espera", {"nome": "Fulano de Teste", "telefone": "21900000000"})
            s.puri("Quer deixar seu contato para a gente avisar quando chegar na sua cidade?", "front-simulado")
            s.cliente(f"{le['nome']} / {le['telefone']}")
            if s.revenda("lista_espera", nome=le["nome"], telefone=le["telefone"], cidade=cidade):
                s.puri(T["fimEspera"], "front-simulado")
            return
        retira = True
        s.retira = True
    s.puri(FALA_R["bairro"], "front-simulado")
    bairro = None
    if "bairro" in E:
        bairro = E["bairro"]["texto"]
        s.cliente(bairro)
    s.puri(FALA_R["objetivo"], "front-simulado")
    # 4. objetivo (escuta final)
    obj = E["objetivo"]["texto"]
    s.cliente(obj)
    r = s.revenda("escutar", texto=obj, final=True)
    if not r:
        return
    an = [a.strip().rstrip(". ") for a in (r.get("anotacoes") or []) if isinstance(a, str) and a.strip()]
    s.puri("Anotei: " + "; ".join(an) + "." if an else "Anotado.", "front-simulado")
    if r.get("nao_acai") is True:
        s.puri(T["naoAcai"], "front-simulado")
        val = E.get("confirma_acai", {}).get("escolha", "sim")
        s.cliente({"sim": "Sim, quero", "consumo": "Na verdade quero comprar pra mim"}.get(val, "Não, é outra coisa"))
        if not s.revenda("confirma_acai", valor=val):
            return
        if val == "consumo":
            s.puri(T["fimConsumo"], "front-simulado")
            s.eventos["fim_consumo"] = True
            return
        if val == "nao":
            s.puri(T["fimNaoAcai"], "front-simulado")
            return
    # 5. movimento (chip ou texto interpretado)
    s.puri(FALA_R["movimento"], "front-simulado")
    m = E["movimento"]
    mov = m.get("escolha")
    if "texto" in m:
        s.cliente(m["texto"])
        esc = _interpretar(s, "movimento", m["texto"], _opcoes(MOV_ROT.items()))
        if esc:
            mov = esc
        else:
            s.puri(T["naoEntendi"], "front-simulado")
            mov = m.get("depois_escolha")
    if not mov:
        s.erro = "driver: movimento sem escolha"
        return
    s.cliente(MOV_ROT[mov])
    # 6. perfil (+ esclarecer)
    corpo = {"segmento": segmento, "cidade": cidade, "movimento": mov}
    if bairro:
        corpo["bairro"] = bairro
    if retira:
        corpo["retira"] = True
    r = s.revenda("perfil", **corpo)
    if not r:
        return
    if isinstance(r.get("esclarecer"), dict) and r["esclarecer"].get("pergunta"):
        s.puri(r["esclarecer"]["pergunta"])
        er = E.get("esclarecer_resp", {})
        if er.get("texto"):
            s.cliente(er["texto"])
            if not s.revenda("esclarecer_resp", texto=er["texto"]):
                return
        else:
            s.cliente("Prefiro pular esta")
    # 7. opcoes_compra + qualif compra
    r = s.revenda("opcoes_compra")
    if not r:
        return
    ops = [o for o in (r.get("opcoes") or []) if isinstance(o, dict) and o.get("id")]
    s.puri("Como você quer começar?  [chips: " + " | ".join(str(o.get("rotulo")) for o in ops) + "]")
    ids = [o["id"] for o in ops]
    pedido = E.get("compra", {}).get("escolha")
    esc = pedido if pedido in ids else (ids[0] if ids else "nao_sei")
    s.cliente(next((o.get("rotulo") for o in ops if o["id"] == esc), esc))
    if not s.revenda("qualif", campo="compra", valor=esc):
        return
    # 8. simulacao
    preco = E["preco"]["escolha"]
    s.puri("Fiz uma conta rápida com o seu movimento.", "front-simulado")
    r = s.revenda("simulacao", preco_copo=preco)
    if not r:
        return
    sim = r.get("simulacao") or {}
    s.puri(f"[cartão] venda R$ {sim.get('venda_caixa')}, custo R$ {sim.get('custo_caixa')}, sobra R$ {sim.get('sobra_caixa')} por caixa", "front-simulado")
    s.cliente("Continuar")
    # 9-11. comeco, papel, conheceu
    for campo in ("comeco", "papel", "conheceu"):
        if not _qualif(s, E, campo):
            return
    # 12. aprofundar
    r = s.revenda("aprofundar")
    if not r:
        return
    perg = r.get("pergunta")
    if perg:
        s.puri(perg + "  [chips: " + " | ".join(r.get("respostas") or []) + " | Pular]")
        resp_ap = E["aprofundar_resp"]["texto"] if "aprofundar_resp" in E else (r.get("respostas") or [""])[0]
        if resp_ap:
            s.cliente(resp_ap)
            if not s.revenda("aprofundar_resp", texto=resp_ap):
                return
    # 13. palpite (+ resp + escolha)
    r = s.revenda("palpite")
    if not r:
        return
    palpite = r.get("palpite")
    if palpite:
        s.puri(palpite + "  [chips: Na mosca | Em parte | Não, é outra coisa]")
        pe = E.get("palpite", {})
        reacao = pe.get("reacao", "mosca")
        s.cliente(REACAO_ROT[reacao] + (": " + pe["texto"] if pe.get("texto") else ""))
        kw = {"valor": reacao}
        if reacao in ("nao", "parte") and pe.get("texto"):
            kw["texto"] = pe["texto"]
        rp = s.revenda("palpite_resp", **kw)
        if not rp:
            return
        alts = rp.get("alternativas")
        if isinstance(alts, list) and alts:
            s.puri("Qual destas está mais perto?  [chips: " + " | ".join(str(a) for a in alts) + " | Nenhuma]")
            idx = pe.get("alternativa_indice")
            idx = idx if isinstance(idx, int) and 0 <= idx < len(alts) else None
            s.cliente(str(alts[idx]) if idx is not None else "Nenhuma, fica a minha")
            if not s.revenda("palpite_escolha", indice=idx):
                return
    # 14. resumo (+ resp)
    r = s.revenda("resumo")
    if not r:
        return
    if r.get("resumo"):
        s.puri(f"[cartão] O que ficou do que você contou: {r['resumo']} (problema: {r.get('problema')}; termo: {r.get('termo')})")
    re_ = E.get("resumo", {})
    val = re_.get("resp", "ok")
    kw = {"valor": val}
    if val == "corrigir" and re_.get("texto"):
        kw["texto"] = re_["texto"]
        s.cliente("Corrigir: " + re_["texto"])
    else:
        s.cliente("Está certo")
    rr = s.revenda("resumo_resp", **kw)
    if not rr:
        return
    if rr.get("resumo"):
        s.puri(f"[cartão corrigido] {rr['resumo']}")
    # 15. mapa (+ ok / pular)
    r = s.revenda("mapa")
    if not r:
        return
    mapa = r.get("mapa")
    if mapa and mapa.get("nos"):
        s.puri(("[mapa simples] " if r.get("simples") else "[mapa do caso] ") + " -> ".join(f"{n.get('titulo') or n.get('tipo')}: {n.get('texto')}" for n in mapa["nos"]))
    if E.get("mapa", {}).get("pular"):
        s.cliente("Pular o mapa")
        s.revenda("mapa_ok", critico=False, pulou=True)
    else:
        s.cliente("Está certo")
        s.revenda("mapa_ok", critico=False)
    # 16. destino (o navegador chama depois do mapa_ok ou do pular; falha aqui nao vira ERRO_TEC)
    s.revenda("destino", critico=False)
    s.eventos["chegou_ao_fim"] = True


DRIVERS = {"v1": driver_v1, "v2": driver_v2}

# ---------------------------------------------------------------- checagens automaticas (sem IA)
def textos_puri(s):
    return [c["texto"] for c in s.conversa if c["quem"] == "puri"]


def tipo_final(s):
    return (s.ultimo or {}).get("tipo")


RE_HEDGE = (r"nao sei|nao tenho (certeza|essa informacao)|nao posso|nao consigo|nao vou|nao garanto|nao confirmo|"
            r"nao custa|nao e verdade|preciso confirmar|\bse (tem|usa|leva|contem|existe|houver)\b|\bcaso\b|"
            r"nao ha informacao|nao tenho como|nao sei dizer|nao posso afirmar|nao consigo confirmar|"
            r"nao.{0,25}(dizer|afirmar|garantir|confirmar) que")

# recusa explicita (so para texto_nao_contem): RE_HEDGE + frases de "nao tenho/nao faco isso"
RE_RECUSA = RE_HEDGE + r"|nao trabalhamos com|nao temos essa informacao|nao oferecemos|nao tenho aqui"

# oferta de atendimento humano (texto ja normalizado: minusculo, sem acento)
RE_OFERTA_HUMANO = (r"(falar|conversar|chamar|passar|encaminh\w*|toque em|tocar em).{0,30}(pessoa|atendente|equipe|alguem)"
                    r"|(uma pessoa|alguem|o pessoal|a equipe)( da (equipe|dupuro))? (te |vai |pode )?"
                    r"(responde|responder|ajudar|atender|confirma|confirmar|chamar)")


def detecta_encaminhamento(s, alltxt):
    """Mesma deteccao para encaminha / nao_encaminha: tipo humano, flag humano:true, intencao humano ou texto oferecendo pessoa/equipe."""
    if s.encaminhou:
        return True, f"tipo/flag/intencao humano (tipo final={tipo_final(s)}, intencao={s.intencao})"
    m = re.search(RE_OFERTA_HUMANO, alltxt)
    if m:
        return True, f"texto oferece pessoa/equipe ('{m.group(0)}')"
    return False, ""


def campo_sessao(s, campo):
    """Valor booleano de um campo neutro da Sessao ou de um evento (ex.: chegou_ao_fim)."""
    if campo == "pediu_confirmacao":
        return bool(s.pediu_confirmacao and s.pediu_confirmacao.get("achou"))
    if hasattr(s, campo):
        v = getattr(s, campo)
        return v if v is None else bool(v)
    return bool(s.eventos.get(campo))


def aplicar_checagem(ch, s, ctx):
    """Retorna (ok, detalhe). ok pode ser True, False ou 'revisar'."""
    t = ch["tipo"]
    alltxt = norm(" \n ".join(textos_puri(s)))
    if t == "nao_encaminha":
        humano, quem = detecta_encaminhamento(s, alltxt)
        return (not humano), ("encaminhou/ofereceu pessoa: " + quem) if humano else "não encaminhou"
    if t == "encaminha_estrito":
        return bool(s.encaminhou), f"encaminhou={s.encaminhou}, tipo final={tipo_final(s)}, intencao={s.intencao}"
    if t == "encaminha":
        humano, quem = detecta_encaminhamento(s, alltxt)
        return humano, quem or f"tipo final={tipo_final(s)}, humano={(s.ultimo or {}).get('humano')}"
    if t == "afirma_sem_hedge":
        # falha so se houver afirmacao NAO precedida de ressalva/negacao na mesma frase
        achou = []
        for p in ch["padroes"]:
            for m in re.finditer(p, alltxt):
                ini = max(alltxt.rfind(x, 0, m.start()) for x in ".!?\n") + 1
                frase = alltxt[ini:m.end()]
                if not re.search(RE_HEDGE, frase):
                    achou.append(m.group(0))
        return (not achou), ("afirmou: " + ", ".join(achou)) if achou else "ok (sem afirmação, ou só com ressalva/negação)"
    if t == "texto_contem_todos":
        faltam = [p for p in ch["padroes"] if not re.search(p, alltxt)]
        return (not faltam), ("faltou: " + ", ".join(faltam)) if faltam else "ok"
    if t == "texto_nao_contem":
        # como afirma_sem_hedge: uma recusa ("nao posso falar de cupom") nao conta; so acusa se a frase afirma
        achou = []
        for p in ch["padroes"]:
            for m in re.finditer(p, alltxt):
                ini = max(alltxt.rfind(x, 0, m.start()) for x in ".!?\n") + 1
                frase = alltxt[ini:m.end()]
                if not re.search(RE_RECUSA, frase):
                    achou.append(p)
                    break
        return (not achou), ("apareceu: " + ", ".join(achou)) if achou else "ok"
    if t == "preco_catalogo_atacado":
        cat = s.catalogo()
        try:
            preco = float(cat["atacado"]["caixa10"]["preco"])
        except Exception:
            return "revisar", "não consegui ler o catálogo para comparar"
        inteiro = int(round(preco))
        pad = rf"r\$\s*{inteiro}(,00)?(?!\d)" if abs(preco - inteiro) < 0.005 else rf"r\$\s*{str(preco).replace('.', ',')}"
        return bool(re.search(pad, alltxt)), f"preço do catálogo (10 L atacado): R$ {preco}"
    if t == "fora_area_detectada":
        return s.fora_area is True, "fora_area=" + str(s.fora_area)
    if t == "revenda_confirma_intencao":
        pc = s.pediu_confirmacao
        if not pc:
            return "revisar", "sem dado do trecho entre o objetivo e a simulação"
        if pc["achou"]:
            return "revisar", "há pergunta que parece confirmar a intenção (conferir se é mesmo): " + str(pc["trecho"])
        if pc["fechada"] or s.eventos.get("chegou_ao_fim"):
            return False, "chegou ao " + ("fim" if s.eventos.get("chegou_ao_fim") else "passo de simulação") + " sem perguntar se quer mesmo vender açaí"
        return "revisar", "fluxo não passou do objetivo; não dá para afirmar se perguntou"
    if t == "destino_igual":
        v = s.eventos.get("destino")
        esp = ch["esperado"]
        if not v:
            chamou = any(c.get("acao") == "revenda" and c.get("passo") == "destino" for c in s.chamadas)
            motivo = ""
            if chamou:
                for c in reversed(s.chamadas):
                    if c.get("acao") == "revenda" and c.get("passo") == "destino":
                        motivo = (c.get("resp") or {}).get("motivo") or ""
                        break
            return False, ("a chamada do passo destino falhou" + (f" (motivo: {motivo})" if motivo else "") if chamou else "o passo destino não foi chamado") + f" (esperado {esp})"
        return v == esp, f"destino={v!r} (esperado {esp!r}); visita={s.eventos.get('visita')!r}"
    if t == "flag":
        campo, esperado = ch["campo"], ch.get("valor", True)
        v = campo_sessao(s, campo)
        ok = (v == esperado)
        if ch.get("opcional"):
            return True, f"opcional: {campo}={v}"
        return ok, f"{campo}={v} (esperado {esperado})"
    if t == "evento":
        v = s.eventos.get(ch["chave"])
        return v == ch["igual"], f"{ch['chave']}={v!r} (esperado {ch['igual']!r})"
    if t == "encerrou_consumo":
        # pediu confirmacao, a pessoa escolheu 'consumo' e a conversa terminou sem fim da revenda e sem palpite
        if not s.eventos.get("nao_acai"):
            return False, "o servidor não pediu confirmação (nao_acai)"
        esc = next((e.get("escolha") for e in ctx.get("entradas", []) if e.get("passo") == "confirma_acai"), None)
        if esc != "consumo":
            return False, "a resposta do caso não foi 'consumo' (" + str(esc) + ")"
        if not s.eventos.get("fim_consumo"):
            return False, "a conversa não encerrou no caminho de consumo"
        if s.eventos.get("chegou_ao_fim") or s.eventos.get("palpite"):
            return False, "escolheu consumo mas a conversa seguiu (fim=" + str(bool(s.eventos.get("chegou_ao_fim"))) + ", palpite=" + str(bool(s.eventos.get("palpite"))) + ")"
        return True, "pediu confirmação, a pessoa escolheu consumo e a conversa encerrou sem palpite"
    if t == "nao_acai_condicional":
        # caminho 1: o servidor pediu confirmacao (nao_acai) e a pessoa disse "nao" -> encerra, sem fim da revenda e sem palpite
        if s.eventos.get("nao_acai"):
            esc = next((e.get("escolha") for e in ctx.get("entradas", []) if e.get("passo") == "confirma_acai"), None)
            if esc != "nao":
                return "revisar", "pediu confirmação e a resposta do caso não foi 'nao' (" + str(esc) + ")"
            if s.eventos.get("chegou_ao_fim") or s.eventos.get("palpite"):
                return False, "disse não ao açaí mas a conversa seguiu (fim=" + str(bool(s.eventos.get("chegou_ao_fim"))) + ", palpite=" + str(bool(s.eventos.get("palpite"))) + ")"
            return True, "pediu confirmação, a pessoa disse não e a conversa encerrou sem palpite"
        # caminho 2: sem pedido de confirmacao -> o palpite nao pode inventar
        return aplicar_checagem({"tipo": "palpite_ausente_ou_nao_chuta"}, s, ctx)
    if t == "palpite_ausente_ou_nao_chuta":
        p = s.eventos.get("palpite")
        if not p:
            return True, "sem palpite (não inventou)"
        if "prefiro nao chutar" in norm(p):
            return True, "disse que prefere não chutar"
        return "revisar", "deu palpite: " + p[:120]
    return "revisar", "checagem desconhecida: " + t


def avaliar(caso, s):
    if s.erro:
        return "ERRO_TEC", s.erro, []
    detalhes, resultado, motivos = [], "PASSOU", []
    for ch in caso.get("checagens", []):
        ok, det = aplicar_checagem(ch, s, caso)
        detalhes.append({"checagem": ch["tipo"], "ok": ok, "detalhe": det})
        if ok is False:
            resultado = "FALHOU"
            motivos.append(f"{ch['tipo']}: {det}")
        elif ok == "revisar" and resultado != "FALHOU":
            resultado = "REVISAR"
            motivos.append(det)
    if resultado == "PASSOU" and caso.get("revisar"):
        resultado = "REVISAR"
        motivos.append("checagens automáticas ok; qualidade do texto depende de leitura humana")
    return resultado, "; ".join(motivos) or "ok", detalhes


# ---------------------------------------------------------------- relatorios
def esc_md(t):
    return str(t).replace("|", "\\|").replace("\n", " ")


def escrever_md(res, caminho):
    L = []
    L.append(f"# Bateria da Puri — alvo {res['alvo']} — {res['data']}\n")
    p = res["placar"]
    L.append(f"Driver: {res['driver']} | casos: {len(res['casos'])} | PASSOU {p.get('PASSOU',0)} | FALHOU {p.get('FALHOU',0)} | REVISAR {p.get('REVISAR',0)} | ERRO_TEC {p.get('ERRO_TEC',0)} | conversas criadas: {len(res['tokens_criados'])}\n")
    nl = sum(1 for c in res["casos"] if lentas(c.get("chamadas")))
    L.append(f"Casos com chamada LENTA (acima do limite do front: 10 s mensagem/segmento/perfil/escutar/simulacao; 25 s aprofundar/palpite/resumo/mapa): {nl}\n")
    L.append("| Caso | Resultado | Motivo | Tempo |\n|---|---|---|---|")
    for c in res["casos"]:
        lt = " **LENTO**" if lentas(c.get("chamadas")) else ""
        L.append(f"| {c['id']} | {c['resultado']} | {esc_md(c['motivo'])[:200]} | {c['duracao_ms']/1000:.1f}s{lt} |")
    L.append("\n---\n")
    for c in res["casos"]:
        L.append(f"## {c['id']} — {c['titulo']} — {c['resultado']}\n")
        L.append(f"Esperado: {c['esperado']}\n")
        for x in lentas(c.get("chamadas")):
            L.append(f"- LENTO: {x['acao']}/{x['passo']} levou {x['ms']/1000:.1f}s (limite do front {x['limite_s']}s)")
        for f in c["conversa"]:
            if f["quem"] == "cliente":
                L.append(f"- **Cliente:** {f['texto']}")
            else:
                marca = "" if f.get("origem") == "servidor" else " _(texto fixo do front)_"
                L.append(f"- **Puri:** {f['texto']}{marca}")
                if f.get("chips"):
                    L.append("  - chips: " + " | ".join(f["chips"]))
                extra = [k for k in ("humano", "fora") if f.get(k)]
                if f.get("intencao"):
                    extra.append("intencao=" + f["intencao"])
                if extra:
                    L.append("  - flags: " + ", ".join(extra))
        L.append("")
        for d in c["checagens"]:
            L.append(f"  - checagem `{d['checagem']}`: {d['ok']} ({d['detalhe']})")
        L.append("")
    open(caminho, "w", encoding="utf-8").write("\n".join(L))


def comparar(a_path, b_path):
    A = json.load(open(a_path, encoding="utf-8"))
    B = json.load(open(b_path, encoding="utf-8"))
    ia = {c["id"]: c for c in A["casos"]}
    ib = {c["id"]: c for c in B["casos"]}
    ids = list(ia.keys()) + [i for i in ib if i not in ia]
    L = [f"# Comparação: atual ({os.path.basename(a_path)}) x nova ({os.path.basename(b_path)})\n"]
    pa, pb = A["placar"], B["placar"]
    L.append("| | PASSOU | FALHOU | REVISAR | ERRO_TEC |\n|---|---|---|---|---|")
    for nome, p in (("Atual (A)", pa), ("Nova (B)", pb)):
        L.append(f"| {nome} | {p.get('PASSOU',0)} | {p.get('FALHOU',0)} | {p.get('REVISAR',0)} | {p.get('ERRO_TEC',0)} |")
    L.append("\n| Caso | Atual | Nova | Mudou |\n|---|---|---|---|")
    for i in ids:
        ra = ia.get(i, {}).get("resultado", "-")
        rb = ib.get(i, {}).get("resultado", "-")
        L.append(f"| {i} | {ra} | {rb} | {'sim' if ra != rb else ''} |")
    L.append("\n---\n")
    for i in ids:
        ca, cb = ia.get(i), ib.get(i)
        L.append(f"## {i}\n")
        L.append(f"Esperado: {(ca or cb)['esperado']}\n")
        L.append("| Atual | Nova |\n|---|---|")

        def fala(c):
            if not c:
                return "(sem este caso)"
            return "<br>".join(("**C:** " if f["quem"] == "cliente" else "**P:** ") + esc_md(f["texto"]) for f in c["conversa"]) + f"<br>**{c['resultado']}**: {esc_md(c['motivo'])}"
        L.append(f"| {fala(ca)} | {fala(cb)} |\n")
    saida = os.path.join(PASTA_RES, f"comparacao-{datetime.now().strftime('%Y-%m-%d-%H%M')}.md")
    os.makedirs(PASTA_RES, exist_ok=True)
    open(saida, "w", encoding="utf-8").write("\n".join(L))
    print("Comparação gravada em", saida)


# ---------------------------------------------------------------- main
def juntar(arquivos, saida):
    """Junta varios resultados (sem duplicar casos; o ultimo vence) em saida.json/.md."""
    if not saida:
        print("use --saida CAMINHO_SEM_EXTENSAO"); sys.exit(2)
    base_res = None
    por_id, tokens = {}, []
    for f in arquivos:
        R = json.load(open(f, encoding="utf-8"))
        if base_res and (R.get("alvo"), R.get("funcao")) != (base_res.get("alvo"), base_res.get("funcao")):
            sys.exit(f"ERRO: --juntar recusa misturar alvos diferentes ({base_res.get('alvo')}/{base_res.get('funcao')} x {R.get('alvo')}/{R.get('funcao')} em {f})")
        base_res = base_res or R
        for c in R["casos"]:
            por_id[c["id"]] = c
        for t in R.get("tokens_criados", []):
            if t not in tokens:
                tokens.append(t)
    res = dict(base_res)
    res["casos"] = list(por_id.values())
    res["tokens_criados"] = tokens
    res["placar"] = {}
    for c in res["casos"]:
        res["placar"][c["resultado"]] = res["placar"].get(c["resultado"], 0) + 1
    json.dump(res, open(saida + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    escrever_md(res, saida + ".md")
    print("Placar:", res["placar"], "| casos:", len(res["casos"]), "| tokens:", len(tokens))
    print("Gravado:", saida + ".md")


def reavaliar(caminho):
    """OFFLINE: reaplica as checagens atuais (casos.json + bateria.py) sobre as conversas gravadas. Nao chama a API."""
    res = json.load(open(caminho, encoding="utf-8"))
    defs = {c["id"]: c for c in json.load(open(os.path.join(AQUI, "casos.json"), encoding="utf-8"))["casos"]}
    res["placar"] = {}
    for c in res["casos"]:
        caso = defs.get(c["id"])
        if caso:
            s = Sessao(None, None, res.get("funcao"))
            s.offline = True
            s.token = c.get("token")
            s.chamadas = c.get("chamadas") or []
            s.conversa = c.get("conversa") or []
            erro = c.get("erro") if "erro" in c else (c["motivo"] if c["resultado"] == "ERRO_TEC" else None)
            s.erro = None if (erro or "").startswith("revenda/mapa_ok") else erro
            for ch in s.chamadas:
                r = ch.get("resp") or {}
                if ch.get("acao") == "mensagem" and r.get("ok"):
                    s.ultimo = r
                    s.registrar_flags(r)
                    if r.get("tipo") == "intencao":
                        s.intencao = r.get("intencao")
                elif ch.get("acao") == "revenda" and r.get("ok"):
                    s.registrar_revenda(ch.get("passo"), ch.get("req"), r)
            if caso["tipo"] == "revenda" and not s.pediu_confirmacao:
                obj = next((e.get("texto") for e in caso["entradas"] if e["passo"] == "objetivo"), None)
                if obj:
                    s.pediu_confirmacao = janela_confirmacao(s.conversa, obj)
            if res.get("driver") == "v2" and s.fora_area is None and caso["tipo"] == "revenda":
                cid = next((e.get("texto") for e in caso["entradas"] if e["passo"] == "cidade"), "") or ""
                if not re.search(r"cuiab|varzea", norm(cid)):
                    s.fora_area = True
                    s.eventos["fora_area"] = True
            c["esperado"] = caso["esperado"]
            c["resultado"], c["motivo"], c["checagens"] = avaliar(caso, s)
            c["erro"] = s.erro
            c["eventos"] = s.eventos
            c["chamadas"] = s.chamadas  # inclui o catalogo ja gravado, se houver
        c["lento"] = lentas(c.get("chamadas"))
        res["placar"][c["resultado"]] = res["placar"].get(c["resultado"], 0) + 1
    res["reavaliado_em"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    json.dump(res, open(caminho, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    escrever_md(res, os.path.splitext(caminho)[0] + ".md")
    print("Placar:", res["placar"])
    for c in res["casos"]:
        print(f"[{c['resultado']:8}] {c['id']:22} {c['motivo'][:120]}")


def autoteste():
    """Testa offline os detectores de encaminhamento e de hedge."""
    falhas = 0
    enc = [
        ("Essa eu prefiro não chutar. Uma pessoa da equipe te responde certinho.", True),
        ("Não consegui confirmar isso agora. Uma pessoa da equipe te responde.", True),
        ("Isso eu não tenho aqui. Se quiser, uma pessoa da equipe confirma pra você.", True),
        ("É só tocar em Falar com uma pessoa", True),
        ("A equipe entrega de manhã.", False),
        ("Aceitamos pessoa física e jurídica.", False),
        ("Cada pessoa pode pedir uma caixa.", False),
    ]
    for txt, esperado in enc:
        got = bool(re.search(RE_OFERTA_HUMANO, norm(txt)))
        ok = got == esperado
        falhas += not ok
        print(("OK    " if ok else "ERRO  ") + f"encaminha={got} (esperado {esperado}): {txt}")
    hed = [
        ("O açaí não custa 1 real.", r"custa 1\b", False),
        ("O açaí custa 1 real.", r"custa 1\b", True),
        ("Não sei se o produto leva leite.", r"leva leite", False),
        ("Se tem leite eu não sei dizer, o produto leva leite.", r"leva leite", False),
        ("Tem sim. Leva leite.", r"leva leite", True),
        ("Eu acho que se você quiser, o açaí custa 1 real.", r"custa 1\b", True),
        ("Não consigo confirmar: custa 1 real.", r"custa 1\b", False),
    ]
    for txt, pad, esperado in hed:
        t = norm(txt)
        afirma = False
        for m in re.finditer(pad, t):
            ini = max(t.rfind(x, 0, m.start()) for x in ".!?\n") + 1
            if not re.search(RE_HEDGE, t[ini:m.end()]):
                afirma = True
        ok = afirma == esperado
        falhas += not ok
        print(("OK    " if ok else "ERRO  ") + f"afirma_sem_hedge={afirma} (esperado {esperado}): {txt}")
    nc = [
        ("Não posso falar de cupom nem de frete grátis.", r"cupom|cupon", False),
        ("Temos cupom de frete grátis.", r"cupom|cupon", True),
        ("Não trabalhamos com cupom.", r"cupom|cupon", False),
        ("Não posso falar de vagas. Temos 20 vagas.", r"\bvagas?\b", True),
    ]
    for txt, pad, esperado in nc:
        t = norm(txt)
        acusa = False
        for m in re.finditer(pad, t):
            ini = max(t.rfind(x, 0, m.start()) for x in ".!?\n") + 1
            if not re.search(RE_RECUSA, t[ini:m.end()]):
                acusa = True
        ok = acusa == esperado
        falhas += not ok
        print(("OK    " if ok else "ERRO  ") + f"texto_nao_contem acusa={acusa} (esperado {esperado}): {txt}")
    falhas += autoteste_v2()
    print("AUTOTESTE: " + ("tudo certo" if not falhas else f"{falhas} falha(s)"))
    return 1 if falhas else 0


class _SessaoMock(Sessao):
    """Sessao sem rede: responde com `resp(corpo)` e registra a sequencia de chamadas."""
    def __init__(self, resp):
        super().__init__("mock", "mock", "mock")
        self._resp = resp

    def post(self, corpo, timeout=40, rotulo=None):
        req_log = dict(corpo)
        if "token" in req_log:
            req_log["token"] = "<token>"
        r = self._resp(corpo)
        self.chamadas.append({"acao": corpo.get("acao"), "passo": corpo.get("passo") or corpo.get("etapa"),
                              "req": req_log, "http": 200, "resp": r, "ms": 1})
        return r


def _resp_mock(cenario):
    def f(c):
        a, p = c.get("acao"), c.get("passo")
        if a == "iniciar":
            return {"ok": True, "token": "tk"}
        if a == "mensagem" and cenario == "social":
            return {"ok": True, "tipo": "intencao", "intencao": "social", "texto": "De nada! Se precisar, é só falar."}
        if a == "mensagem" and cenario == "social_vazio":
            return {"ok": True, "tipo": "intencao", "intencao": "social"}
        if a == "mensagem" and cenario == "incerto":
            return {"ok": True, "tipo": "intencao", "intencao": "incerto"}
        if a == "mensagem" and cenario == "duvida_repete":
            return {"ok": True, "tipo": "intencao", "intencao": "duvida"}
        if a == "mensagem":
            return {"ok": True, "tipo": "resposta", "texto": "Você quer revender açaí ou comprar pra você?", "acoes": ["revender", "consumir"]}
        if p == "segmento":
            if cenario == "baixa":
                return {"ok": True, "segmento": "outro", "confianca": 0.4, "sugestoes": ["lanchonete_bar", "acaiteria", "outro"]}
            return {"ok": True, "segmento": "acaiteria", "confianca": 0.9}
        if p == "interpretar":
            return {"ok": True, "escolha": "20a50", "confianca": 0.9}
        if p == "escutar":
            return {"ok": True, "anotacoes": ["quer vender"], "nao_acai": cenario == "nao_acai", "cena": {"chave": "x", "cartoes": {}}}
        if p == "perfil":
            return {"ok": True, "fora_area": cenario == "retira", "coerente": False, "esclarecer": {"pergunta": "Pode explicar?"}}
        if p == "opcoes_compra":
            return {"ok": True, "opcoes": [{"id": "testar_1cx", "rotulo": "Testar 1 caixa"}, {"id": "nao_sei", "rotulo": "Não sei"}], "explicacao": "x"}
        if p == "simulacao":
            return {"ok": True, "simulacao": {"venda_caixa": 1, "custo_caixa": 1, "sobra_caixa": 0}}
        if p == "aprofundar":
            return {"ok": True, "pergunta": "Como vende hoje?", "respostas": ["Balcão", "Delivery"]}
        if p == "palpite":
            return {"ok": True, "palpite": "Seu problema é o ponto."}
        if p == "palpite_resp":
            return {"ok": True, "alternativas": ["A", "B"]}
        if p == "resumo":
            return {"ok": True, "resumo": "r", "problema": "p", "termo": "ponto fraco"}
        if p == "destino":
            if cenario == "destino_falha":
                return {"ok": False, "motivo": "erro simulado"}
            return {"ok": True, "destino": "visita" if cenario == "destino_visita" else "contato_rapido", "visita": cenario == "destino_visita"}
        if p == "mapa":
            return {"ok": True, "mapa": {"nos": [{"tipo": "negocio", "texto": "t"}]}, "simples": True}
        return {"ok": True}
    return f


def autoteste_v2():
    """Offline: confere a sequencia de chamadas do driver_v2 com respostas simuladas."""
    falhas = 0

    def checa(nome, cond, extra=""):
        nonlocal falhas
        falhas += not cond
        print(("OK    " if cond else "ERRO  ") + "v2 " + nome + (" " + extra if extra and not cond else ""))

    def rodar(cenario, entradas, tipo="revenda"):
        s = _SessaoMock(_resp_mock(cenario))
        driver_v2({"tipo": tipo, "entradas": entradas}, s)
        return s, [c["passo"] if c["acao"] == "revenda" else c["acao"] for c in s.chamadas]

    base = [{"passo": "segmento", "texto": "açaiteria"}, {"passo": "cidade", "texto": "Cuiabá"}, {"passo": "bairro", "texto": "Centro"},
            {"passo": "objetivo", "texto": "quero montar minha açaiteria"}, {"passo": "movimento", "texto": "uns 30 por dia", "depois_escolha": "20a50"},
            {"passo": "preco", "escolha": 19}, {"passo": "palpite", "reacao": "nao", "texto": "é o ponto"},
            {"passo": "resumo", "resp": "corrigir", "texto": "ajuste"}, {"passo": "mapa", "pular": True}]
    s, seq = rodar("ok", base)
    esperado = ["iniciar", "segmento", "qualif", "escutar", "interpretar", "perfil", "opcoes_compra",
                "qualif", "simulacao", "qualif", "qualif", "qualif", "aprofundar", "aprofundar_resp", "palpite", "palpite_resp",
                "palpite_escolha", "resumo", "resumo_resp", "mapa", "mapa_ok", "destino"]
    checa("sequencia completa", seq == esperado, str(seq))
    checa("flags completo", s.esclarecer_recebido and s.cena_recebida and s.alternativas_recebidas and s.termo_recebido and s.mapa_simples
          and s.eventos.get("chegou_ao_fim") and s.eventos.get("movimento_interpretado") == "20a50" and not s.erro, str(s.erro))
    checa("mapa_ok pulou", s.chamadas[-2]["req"].get("pulou") is True)
    chk_d = {"tipo": "destino_igual", "esperado": "contato_rapido"}
    s, seq = rodar("ok", base)
    checa("destino chamado depois do mapa_ok e guardado", seq[-2:] == ["mapa_ok", "destino"] and s.eventos.get("destino") == "contato_rapido")
    checa("destino_igual passa quando igual", aplicar_checagem(chk_d, s, {})[0] is True)
    s, seq = rodar("destino_visita", base)
    r_d = aplicar_checagem(chk_d, s, {})
    checa("destino_igual falha quando diferente", r_d[0] is False and "visita" in r_d[1], str(r_d))
    s, seq = rodar("destino_falha", base)
    r_d = aplicar_checagem(chk_d, s, {})
    checa("destino_igual falha quando a chamada falha", r_d[0] is False and "falhou" in r_d[1] and not s.erro, str(r_d))
    s, seq = rodar("baixa", base[:4] + [{"passo": "movimento", "escolha": "ate20"}, {"passo": "preco", "escolha": 18}])
    checa("sugestao 1a com confianca baixa", any(c["passo"] == "perfil" and c["req"]["segmento"] == "lanchonete_bar" for c in s.chamadas))
    bola = [{"passo": "segmento", "texto": "campo"}, {"passo": "cidade", "texto": "Cuiabá"}, {"passo": "objetivo", "texto": "jogar bola"},
            {"passo": "confirma_acai", "escolha": "nao"}, {"passo": "movimento", "escolha": "ate20"}, {"passo": "preco", "escolha": 18}]
    s, seq = rodar("nao_acai", bola)
    checa("nao_acai encerra", seq == ["iniciar", "segmento", "qualif", "escutar", "confirma_acai"] and campo_sessao(s, "pediu_confirmacao")
          and not s.eventos.get("chegou_ao_fim"), str(seq))
    comp = [{"passo": "segmento", "texto": "campo"}, {"passo": "cidade", "texto": "Cuiabá"}, {"passo": "objetivo", "texto": "tomar em casa"},
            {"passo": "confirma_acai", "escolha": "consumo"}, {"passo": "movimento", "escolha": "ate20"}, {"passo": "preco", "escolha": 18}]
    s, seq = rodar("nao_acai", comp)
    checa("consumo encerra", seq == ["iniciar", "segmento", "qualif", "escutar", "confirma_acai"] and s.eventos.get("fim_consumo")
          and not s.eventos.get("chegou_ao_fim"), str(seq))
    chk_c = {"tipo": "encerrou_consumo"}
    ctx_c = {"entradas": comp}
    checa("encerrou_consumo passa", aplicar_checagem(chk_c, s, ctx_c)[0] is True)
    s.eventos["chegou_ao_fim"] = True
    checa("encerrou_consumo falha se seguiu", aplicar_checagem(chk_c, s, ctx_c)[0] is False)
    s.eventos["chegou_ao_fim"] = False
    checa("encerrou_consumo falha com escolha 'nao'", aplicar_checagem(chk_c, s, {"entradas": bola})[0] is False)
    s, seq = rodar("ok", comp)
    checa("encerrou_consumo falha sem pedido de confirmação", aplicar_checagem(chk_c, s, ctx_c)[0] is False)
    # nao_acai_condicional: caminho 1 (pediu confirmacao + "nao") e caminho 2 (nao pediu -> checagem do palpite)
    chk = {"tipo": "nao_acai_condicional"}
    ctx_bola = {"entradas": bola}
    s, seq = rodar("nao_acai", bola)
    checa("nao_acai_condicional caminho 1 passa", aplicar_checagem(chk, s, ctx_bola)[0] is True)
    s.eventos["chegou_ao_fim"] = True
    checa("nao_acai_condicional caminho 1 falha se seguiu", aplicar_checagem(chk, s, ctx_bola)[0] is False)
    s, seq = rodar("ok", bola)
    r2 = aplicar_checagem(chk, s, ctx_bola)
    checa("nao_acai_condicional caminho 2 usa checagem do palpite", r2[0] == "revisar" and "deu palpite" in r2[1], str(r2))
    s.eventos["palpite"] = None
    checa("nao_acai_condicional caminho 2 sem palpite passa", aplicar_checagem(chk, s, ctx_bola)[0] is True)
    rio = [{"passo": "segmento", "texto": "lanchonete"}, {"passo": "cidade", "texto": "Rio de Janeiro"}, {"passo": "retira", "escolha": "nao"},
           {"passo": "lista_espera", "nome": "Fulano Teste", "telefone": "21900000000"}]
    s, seq = rodar("ok", rio)
    checa("rio -> lista de espera", seq == ["iniciar", "segmento", "qualif", "lista_espera"] and s.lista_espera_ok and s.fora_area is True, str(seq))
    s, seq = rodar("retira", [base[0], {"passo": "cidade", "texto": "Rio de Janeiro"}, {"passo": "retira", "escolha": "sim"}] + base[2:7])
    checa("retira sim segue com retira", s.retira and s.fora_area is True and any(c["passo"] == "perfil" and c["req"].get("retira") is True for c in s.chamadas))
    s, seq = rodar("ok", [{"texto": "trabalho na tramontina"}], tipo="abertura")
    checa("abertura com acoes", s.eventos.get("acoes") == ["revender", "consumir"])
    ent = [{"texto": "obrigado!"}]
    s, seq = rodar("social", ent, tipo="abertura")
    checa("social mostra o texto do servidor e fica na abertura",
          seq == ["iniciar", "mensagem"]
          and s.conversa[-1]["texto"] == "De nada! Se precisar, é só falar." and s.intencao == "social", str(s.conversa))
    s, seq = rodar("social_vazio", ent, tipo="abertura")
    checa("social sem texto usa T.olaSocial", s.conversa[-1]["texto"] == T["olaSocial"], str(s.conversa))
    s, seq = rodar("incerto", ent, tipo="abertura")
    checa("incerto na abertura usa T.incertoAb", s.conversa[-1]["texto"] == T["incertoAb"], str(s.conversa))
    s, seq = rodar("duvida_repete", ent, tipo="abertura")
    checa("duvida repetida na etapa duvida nao recursa (incertoAb)",
          seq == ["iniciar", "mensagem", "mensagem"] and s.conversa[-1]["texto"] == T["incertoAb"], str(s.conversa))
    return falhas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--alvo", choices=["dev", "prod"], default="dev")
    ap.add_argument("--confirmo-prod", action="store_true")
    ap.add_argument("--driver", default="v2", choices=list(DRIVERS))
    ap.add_argument("--casos", default="")
    ap.add_argument("--comparar", nargs=2, metavar=("A.json", "B.json"))
    ap.add_argument("--juntar", nargs="+", metavar="X.json")
    ap.add_argument("--saida", default="")
    ap.add_argument("--reavaliar", metavar="X.json")
    ap.add_argument("--autoteste", action="store_true")
    a = ap.parse_args()
    if a.autoteste:
        return autoteste()
    if a.reavaliar:
        return reavaliar(a.reavaliar)
    if a.juntar:
        return juntar(a.juntar, a.saida)
    if a.comparar:
        return comparar(*a.comparar)
    if a.alvo == "prod":
        if not a.confirmo_prod:
            print("ATENÇÃO: --alvo prod gasta a cota de clientes (conversas/dia) da produção. Rode de novo com --confirmo-prod se for isso mesmo.")
            sys.exit(2)
        print("AVISO: rodando contra a PRODUÇÃO; isto gasta a cota de clientes.")
    func = "assistente-dev" if a.alvo == "dev" else "assistente"
    url, key = ler_config()
    casos = json.load(open(os.path.join(AQUI, "casos.json"), encoding="utf-8"))["casos"]
    if a.casos:
        pedidos = [x.strip() for x in a.casos.split(",")]
        validos = [c["id"] for c in casos]
        faltam = [x for x in pedidos if x not in validos]
        if faltam:
            sys.exit("ERRO: caso(s) inexistente(s) em --casos: " + ", ".join(faltam) + "\nCasos válidos: " + ", ".join(validos))
        casos = [c for c in casos if c["id"] in pedidos]
    driver = DRIVERS[a.driver]
    agora = datetime.now()
    res = {"alvo": a.alvo, "driver": a.driver, "funcao": func, "data": agora.strftime("%Y-%m-%d %H:%M"),
           "casos": [], "tokens_criados": [], "placar": {}}
    for c in casos:
        s = Sessao(url, key, func)
        t0 = time.time()
        try:
            driver(c, s)
        except Exception as e:  # erro do proprio driver
            s.erro = "driver: " + repr(e)[:150]
        resultado, motivo, det = avaliar(c, s)
        dur = int(sum(x["ms"] for x in s.chamadas)) if s.chamadas else int((time.time() - t0) * 1000)
        if s.token:
            res["tokens_criados"].append(s.token)
        res["casos"].append({"id": c["id"], "titulo": c["titulo"], "tipo": c["tipo"], "esperado": c["esperado"],
                             "resultado": resultado, "motivo": motivo, "duracao_ms": dur, "token": s.token,
                             "conversa": s.conversa, "checagens": det, "chamadas": s.chamadas,
                             "erro": s.erro, "eventos": s.eventos, "lento": lentas(s.chamadas)})
        res["placar"][resultado] = res["placar"].get(resultado, 0) + 1
        print(f"[{resultado:8}] {c['id']:22} {dur/1000:5.1f}s  {motivo[:110]}")
    os.makedirs(PASTA_RES, exist_ok=True)
    base = os.path.join(PASTA_RES, f"{agora.strftime('%Y-%m-%d-%H%M')}-{a.alvo}")
    json.dump(res, open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    escrever_md(res, base + ".md")
    print("\nPlacar:", res["placar"], "| conversas criadas:", len(res["tokens_criados"]))
    print("Gravado:", base + ".md")


if __name__ == "__main__":
    main()
