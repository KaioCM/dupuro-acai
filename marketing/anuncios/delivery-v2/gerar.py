"""Gera feed.html e story.html do anúncio v2 (rode e depois `sh render.sh`)."""
import random
LOGO='../../../assets/img/brand/logo-branco-slogan.png'
GRAO='<svg class="grao" xmlns="http://www.w3.org/2000/svg"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>'
FIBRA=lambda cls,i:f'<svg class="{cls}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><filter id="f{i}"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="4" seed="{4+i}"/><feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.42  0 0 0 0 0.25  0 0 0 0.55 0"/></filter><rect width="100%" height="100%" filter="url(#f{i})"/></svg>'
MAO='<filter id="mao"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" result="d"/><feDisplacementMap in="SourceGraphic" in2="d" scale="3.5"/></filter>'
CARIMBO='''<svg class="carimbo" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
 <defs><filter id="tinta"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>
  <feComponentTransfer in="n" result="m"><feFuncA type="discrete" tableValues="0 1 1 1 1 1"/></feComponentTransfer>
  <feComposite in="SourceGraphic" in2="m" operator="in" result="t"/><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="9" result="d"/>
  <feDisplacementMap in="t" in2="d" scale="3"/></filter>
  <path id="cima" d="M 24,100 A 76,76 0 0 1 176,100"/><path id="baixo" d="M 30,104 A 70,70 0 0 0 170,104"/></defs>
 <g filter="url(#tinta)" fill="none" stroke="#601050">
  <circle cx="100" cy="100" r="94" stroke-width="6"/><circle cx="100" cy="100" r="86" stroke-width="2"/>
  <text font-family="Klinko" font-size="17" fill="#601050" stroke="none" letter-spacing="1" text-anchor="middle"><textPath href="#cima" startOffset="50%">DIRETO DA FÁBRICA</textPath></text>
  <text font-family="Klinko" font-size="17" fill="#601050" stroke="none" letter-spacing="2" text-anchor="middle" dominant-baseline="hanging"><textPath href="#baixo" startOffset="50%">CUIABÁ · MT</textPath></text>
  <text x="100" y="109" text-anchor="middle" font-family="Klinko" font-size="27" fill="#601050" stroke="none">DUPURO</text>
 </g></svg>'''
# folha de palmeira estilizada (folíolos em leque), verde da marca
def folha(x,y,w,rot,flip=False,cls="folha"):
    """Folha pinada de palmeira de açaí: ráquis curva com folíolos finos e caídos."""
    import math
    pts=[(i/24) for i in range(1,24)]
    fol=''
    for t in pts:
        # ponto na ráquis (curva quadrática de (0,200) a (200,20) com controle (60,40))
        px=(1-t)**2*0+2*(1-t)*t*60+t**2*200; py=(1-t)**2*200+2*(1-t)*t*40+t**2*20
        L=70*(1-abs(t-0.45)*1.1)+10
        for lado in (-1,1):
            ang=math.radians(-35+lado*55+t*20)
            ex=px+L*math.cos(ang); ey=py+L*math.sin(ang)+L*0.35
            cx=px+L*0.5*math.cos(ang); cy=py+L*0.5*math.sin(ang)
            fol+=f'<path d="M{px:.1f},{py:.1f} Q{cx:.1f},{cy-4*lado:.1f} {ex:.1f},{ey:.1f}" stroke="url(#gf)" stroke-width="{5.5-3*t:.1f}" fill="none" stroke-linecap="round"/>'
    sx=-1 if flip else 1
    return (f'<svg class="{cls}" style="left:{x}px;top:{y}px;width:{w}px;height:{w}px;transform:rotate({rot}deg) scaleX({sx})" viewBox="-20 -20 300 300">'
            '<defs><linearGradient id="gf" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2F4A0C"/><stop offset=".55" stop-color="#4D7012"/><stop offset="1" stop-color="#7FA82B"/></linearGradient></defs>'
            '<path d="M0,200 Q60,40 200,20" stroke="#2F4A0C" stroke-width="4" fill="none"/>'+fol+'</svg>')
def fruto(x,y,r):
    return (f'<svg class="fruto" style="left:{x}px;top:{y}px;width:{2*r}px;height:{2*r}px" viewBox="0 0 40 40">'
            '<defs><radialGradient id="gb" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#6B3A72"/><stop offset=".45" stop-color="#2A0E2C"/><stop offset="1" stop-color="#0E040F"/></radialGradient></defs>'
            '<circle cx="20" cy="20" r="18" fill="url(#gb)"/><ellipse cx="14" cy="12" rx="5" ry="3" fill="#fff" opacity=".35"/>'
            '<path d="M20,4 l2,3 l3,-1 l-1,3 l3,2 l-4,1 l-3,-1 l-3,1 l-4,-1 l3,-2 l-1,-3 l3,1 z" fill="#3B2410" opacity=".85"/></svg>')
BARB='<svg class="barbante" viewBox="0 0 30 40" preserveAspectRatio="none"><path d="M15,0 C 9,12 21,24 15,40" stroke="#B08A55" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M15,0 C 9,12 21,24 15,40" stroke="#7A5A30" stroke-width="1" stroke-dasharray="2 3" fill="none"/></svg>'
CAMINHAO='''<svg class="caminhao" viewBox="0 0 170 100" xmlns="http://www.w3.org/2000/svg"><defs>'''+MAO.replace('id="mao"','id="mao2"')+'''</defs>
 <g filter="url(#mao2)" fill="none" stroke="#FFF7EC" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8,30 h28 M2,46 h26 M10,62 h20"/>
  <path d="M44,18 h72 v56 h-72 z"/>
  <path d="M116,36 h24 l18,20 v18 h-42"/>
  <path d="M124,40 h14 l12,14 h-26 z"/>
  <circle cx="68" cy="80" r="11" fill="#380C2F"/><circle cx="138" cy="80" r="11" fill="#380C2F"/>
  <circle cx="68" cy="80" r="3.5" fill="#FFF7EC" stroke="none"/><circle cx="138" cy="80" r="3.5" fill="#FFF7EC" stroke="none"/>
 </g>
 <g filter="url(#mao2)"><path d="M54,32 h56 v30 h-56 z" fill="#F5B301" stroke="#FFF7EC" stroke-width="3"/>
 <text x="82" y="52" text-anchor="middle" font-family="Klinko" font-size="10.5" fill="#380C2F">DUPURO</text></g></svg>'''
def rabiscos(fmt):
    # sublinhado de pincel sob "favorito" + estrelinhas
    if fmt=='feed': sx,sy,w=395,392,290; st=[(338,300,26),(745,292,20),(772,340,14)]
    else: sx,sy,w=380,660,320; st=[(326,548,28),(770,538,22),(798,590,15)]
    out=(f'<svg class="rabisco" style="left:{sx}px;top:{sy}px;width:{w}px;height:26px" viewBox="0 0 330 40" preserveAspectRatio="none"><defs>{MAO}</defs>'
         '<path d="M6,26 C 80,10 190,8 324,16 C 230,20 140,24 40,34" stroke="#F5B301" stroke-width="7" fill="none" stroke-linecap="round" filter="url(#mao)" opacity=".95"/></svg>')
    for x,y,t in st:
        out+=(f'<svg class="rabisco" style="left:{x}px;top:{y}px;width:{t}px;height:{t}px" viewBox="-10 -10 20 20">'
              '<path d="M0,-9 L2,-2 L9,0 L2,2 L0,9 L-2,2 L-9,0 L-2,-2 Z" fill="#E28F00"/></svg>')
    return out
def pagina(fmt):
    random.seed(7)
    itens=''
    for n,p in [(1,25),(2,45),(5,85),(10,175)]:
        cls='num tres' if p>=100 else 'num'
        itens+=(f'<div class="item i{n}"><div class="caixa"><img src="../briefing-delivery/material/caixa-{n}l-estudio-recorte.webp" alt="Caixa {n} {"litro" if n==1 else "litros"}"><div class="sombra"></div></div>'
                f'{BARB}<div class="etiqueta"><div class="corpo"></div>{FIBRA("fibra2",n)}<div class="furo"></div>'
                f'<div class="preco"><span class="lit">{n}L</span><span class="rs">R$</span><span class="{cls}">{p}</span></div></div></div>')
    if fmt=='feed':
        decor=folha(-30,568,320,-8)+folha(800,528,320,-8,True)+''.join(fruto(x,y,r) for x,y,r in [(20,903,22),(58,920,18),(36,930,15),(1005,898,22),(1040,918,17),(985,926,14)])
    else:
        decor=folha(-30,770,340,-8)+folha(780,730,340,-8,True)+''.join(fruto(x,y,r) for x,y,r in [(20,1105,22),(58,1122,18),(36,1132,15),(1005,1100,22),(1040,1120,17),(985,1128,14)])
    return f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800&family=Caveat+Brush&display=swap" rel="stylesheet">
<link rel="stylesheet" href="peca.css"><title>Dupuro Delivery v2 — {fmt}</title></head>
<body class="{fmt}">{GRAO}
<img class="logo" src="{LOGO}" alt="Dupuro Açaí">
<div class="faixa"><div class="papel"></div>{FIBRA("fibra",0)}</div>
<div class="titulo"><div class="a">Seu açaí</div><div class="mao">favorito</div><div class="b">agora chega na sua casa</div></div>
{rabiscos(fmt)}
{CARIMBO}
{decor}
<div class="fila">{itens}</div>
<div class="rodape"><div class="area">Entregamos em Cuiabá e Várzea Grande<svg class="seta" style="right:-62px;top:22px" viewBox="0 0 70 56"><path d="M6,8 C 34,6 54,18 58,44" stroke="#FFD34D" stroke-width="4" fill="none" stroke-linecap="round" filter="url(#mao3)"/><path d="M48,36 L58,48 L66,35" stroke="#FFD34D" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#mao3)"/><defs><filter id="mao3"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="11" result="d"/><feDisplacementMap in="SourceGraphic" in2="d" scale="2.5"/></filter></defs></svg></div><div class="linha-cta"><span class="cta">Peça agora</span>{CAMINHAO}</div><div class="info">Entrega a partir de <i>R$ 5</i> · dupuroacai.com/delivery</div></div>
</body></html>'''
for fmt in ['feed','story']: open(fmt+'.html','w').write(pagina(fmt))
