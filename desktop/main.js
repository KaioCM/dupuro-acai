// ==========================================================================
// Dupuro Caixa — processo principal do app da loja (Electron)
// ==========================================================================
// A "casca": abre o caixa DO SITE (sempre a versão mais nova quando online; o
// service worker do site serve o cache quando offline) e adiciona o que o
// navegador não faz — IMPRIMIR A COMANDA SEM JANELA, direto na impressora.
//
// A impressão usa o silent print nativo do Electron (webContents.print com
// silent:true), que manda o HTML de 80mm pra impressora escolhida sem diálogo
// nenhum. Não precisa de módulo nativo (nada de compilar node-gyp).
// ==========================================================================

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const CAIXA_URL = 'https://www.dupuroacai.com/area-cliente/caixa.html';
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); } catch (e) { return {}; }
}
function gravarConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2)); } catch (e) { /* ignora */ }
}

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#601050',
    title: 'Dupuro Caixa',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null); // sem menu de navegador — é um "programa"
  janela.loadURL(CAIXA_URL);

  // Se abrir totalmente offline logo de cara e o cache ainda não existir, mostra
  // um aviso simples em vez de tela branca.
  janela.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame) {
      janela.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<body style="font-family:sans-serif;background:#601050;color:#FFF7EC;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px">' +
        '<div><h1>Sem conexão</h1><p>Abra o app uma vez com internet para ele guardar o caixa offline.</p>' +
        '<p><a style="color:#FFD34D" href="' + CAIXA_URL + '">Tentar de novo</a></p></div></body>'
      ));
    }
  });
}

// ---- Impressão silenciosa da comanda ----
// O site manda o HTML da comanda (80mm). Abrimos numa janela oculta, carregamos
// o HTML e imprimimos sem diálogo na impressora configurada (ou na padrão).
ipcMain.handle('dupuro-print', async (evt, html) => {
  const cfg = lerConfig();
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((resolve, reject) => {
      const opts = {
        silent: true,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: 80000, height: 200000 } // 80mm x 200mm (microns) — ajustável
      };
      if (cfg.printerName) opts.deviceName = cfg.printerName;
      win.webContents.print(opts, (ok, motivo) => ok ? resolve() : reject(new Error(motivo || 'falha na impressão')));
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    win.close();
  }
});

// Lista de impressoras instaladas (pra uma tela de configuração escolher a Sweda).
ipcMain.handle('dupuro-listar-impressoras', async () => {
  try {
    const lista = await janela.webContents.getPrintersAsync();
    return lista.map(p => ({ nome: p.name, descricao: p.displayName || p.name, padrao: !!p.isDefault }));
  } catch (e) { return []; }
});

ipcMain.handle('dupuro-config', async (evt, patch) => {
  const cfg = lerConfig();
  if (patch && typeof patch === 'object') { Object.assign(cfg, patch); gravarConfig(cfg); }
  return cfg;
});

// ---- TEF (cartão) ----
// tefTipo (config): 'manual' (PADRÃO), 'simulacao', 'sitef' ou 'paygo'.
//  - manual    → o app NÃO cobra: a atendente passa o cartão na maquininha como
//                hoje e o app só registra a forma de pagamento. (retorna manual:true)
//  - simulacao → finge a cobrança e aprova. SÓ pra testar o fluxo; NUNCA usar
//                em produção achando que cobrou de verdade.
//  - sitef/paygo → ponto onde o integrador pluga a lib real (ainda não feito).
// A assinatura de retorno é sempre a mesma pro caixa:
//   { aprovado, nsu, autorizacao, bandeira, mensagem, erro, manual, simulacao }
ipcMain.handle('dupuro-tef-estado', async () => {
  const cfg = lerConfig();
  return { tipo: cfg.tefTipo || 'manual', servidor: cfg.tefServidor || null, loja: cfg.tefLoja || null, terminal: cfg.tefTerminal || null };
});

ipcMain.handle('dupuro-tef-cobrar', async (evt, payload) => {
  const cfg = lerConfig();
  const tipo = cfg.tefTipo || 'manual';
  const valor = Number(payload && payload.valor) || 0;
  const modalidade = (payload && payload.tipo) || 'credito';

  if (tipo === 'manual') {
    // App não cobra: cartão é passado à parte, só registramos a forma.
    return { aprovado: true, manual: true };
  }

  if (tipo === 'simulacao') {
    // Finge a conversa com a maquininha (aprova). Serve pra testar o fluxo todo.
    await new Promise((r) => setTimeout(r, 1200));
    const nsu = 'SIM' + Date.now().toString().slice(-8);
    return { aprovado: true, nsu, autorizacao: '000000', bandeira: 'SIMULACAO', mensagem: 'Aprovado (simulação)', simulacao: true };
  }

  // TODO (integração real): aqui o integrador do TEF pluga a chamada da lib.
  //  - SiTef  → CliSiTef (via FFI/koffi ou executável auxiliar), usando
  //             cfg.tefServidor (endereço do servidor SiTef), cfg.tefLoja e
  //             cfg.tefTerminal fornecidos pela Sicredi/Software Express.
  //  - PayGo  → PayGo Integrado (protocolo de pasta/porta local).
  // Enquanto não estiver implementado, avisa em vez de fingir aprovação.
  return {
    aprovado: false,
    erro: 'TEF "' + tipo + '" ainda não integrado. Fale com o técnico ou use o modo manual/simulação.',
    valor, modalidade
  };
});

app.whenReady().then(criarJanela);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
