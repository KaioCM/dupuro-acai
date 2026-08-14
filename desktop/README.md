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

## Jeito fácil: baixar pronto (sem instalar Node)

Toda vez que uma **tag `v*`** é enviada (ex.: `git tag v1.0.1 && git push origin v1.0.1`),
o GitHub monta o `.exe` sozinho (workflow `.github/workflows/build-desktop.yml`) e publica
num **Release**. O botão **"⬇️ Baixar o app"** dentro do caixa (aba Nova venda) sempre baixa
a versão mais recente:

```
https://github.com/KaioCM/dupuro-acai/releases/latest/download/Dupuro-Caixa-Setup.exe
```

Para lançar uma nova versão: suba o `version` no `package.json`, crie a tag e faça o push
da tag. Em poucos minutos o botão passa a servir a versão nova.

## Gerar o instalador (.exe) manualmente (opcional, precisa de Node)

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

## Cartão / TEF (maquininha da loja)

O app pode cobrar direto na maquininha (pinpad) que já está cabeada no PC, usando o
**agente Elgin TEF Web local** — a mesma que o sistema antigo usa. O caixa web não fala com
`http://localhost` (bloqueio de conteúdo misto do HTTPS); quem fala é o app (Electron).

Modos (em `config.json` na pasta de dados do app — `%AppData%/Dupuro Caixa/config.json`):

- `"tefTipo": "manual"` (padrão) — não cobra; a atendente passa o cartão à parte.
- `"tefTipo": "elgin"` — cobra pelo agente Elgin TEF Web local.
  - `"tefUrl"` opcional; padrão `http://localhost:2001/tef/v1`. **Conferir a porta no PC**
    (o legado da Dupuro usava `60906` → nesse caso `"tefUrl": "http://localhost:60906/tef/v1"`).
- `"tefTipo": "simulacao"` — só pra testar o fluxo (aprova sozinho; NUNCA em produção).

Para descobrir a porta certa no PC da loja: `netstat -ano | findstr LISTENING | findstr "2001 60906"`
e ver qual serviço Elgin TEF está rodando. Depois é só setar `tefTipo`/`tefUrl` e testar uma
venda no crédito/débito pelo caixa.

## Ícone

Coloque um `assets/icon.ico` (256×256) nesta pasta antes de gerar o `.exe`. Sem ele o
Electron usa um ícone genérico (não impede o build de teste).
