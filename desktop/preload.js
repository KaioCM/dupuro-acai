// ==========================================================================
// Ponte segura entre o caixa (site) e o processo principal do app.
// Expõe window.DupuroDesktop — o printer.js detecta isso e usa a impressão
// nativa (sem janela). Em navegador comum, window.DupuroDesktop não existe e
// o caixa segue no fluxo normal (serial / diálogo do Windows).
// ==========================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DupuroDesktop', {
  versao: '1.0.0',
  // Recebe o HTML da comanda (80mm) e imprime sem diálogo. Retorna {ok, error}.
  imprimir: (html) => ipcRenderer.invoke('dupuro-print', html),
  listarImpressoras: () => ipcRenderer.invoke('dupuro-listar-impressoras'),
  // patch = { printerName } pra escolher a impressora; sem patch, só lê a config.
  config: (patch) => ipcRenderer.invoke('dupuro-config', patch || null)
});
