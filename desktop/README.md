# Dupuro Caixa — app do PC da loja

App nativo (Electron) que abre o caixa do site (`www.dupuroacai.com/area-cliente/caixa.html`),
imprime a comanda **direto na Sweda, sem a janela de impressão**, e funciona **offline**
(o site guarda um cache; as vendas feitas sem internet sincronizam quando ela volta).

Por que um app em vez do navegador: só o app consegue imprimir **sem diálogo**. A casca
carrega o site ao vivo, então o caixa continua se atualizando sozinho a cada deploy — o
`.exe` só muda quando mexermos nesta pasta.

## Rodar em modo teste (no PC com Node instalado)

```bash
cd desktop
npm install
npm start
```

## Gerar o instalador (.exe) para levar pra loja

```bash
cd desktop
npm install
npm run dist
```

O instalador sai em `desktop/dist/` (ex.: `Dupuro Caixa Setup 1.0.0.exe`). Leve esse arquivo
pro PC da loja e instale normalmente — ele cria o atalho **Dupuro Caixa** na área de trabalho.

## Configurar a impressora

1. Deixe a **Sweda** instalada no Windows (não precisa ser a padrão).
2. Abra o app **uma vez com internet** (pra ele guardar o caixa offline).
3. Na tela do caixa, em **Nova venda → barra da impressora**, escolha a Sweda na lista de
   impressoras do app e faça um **Imprimir teste**. A comanda deve sair sem nenhuma janela.

> Se a comanda sair cortada ou com margem errada, é ajuste de `pageSize`/`margins` em
> `main.js` (o tamanho do papel 80&nbsp;mm às vezes precisa de acerto fino na máquina real).

## Ícone

Coloque um `assets/icon.ico` (256×256) nesta pasta antes de gerar o `.exe`. Sem ele o
Electron usa um ícone genérico (não impede o build de teste).
