// ==========================================================================
// Ponte segura entre o caixa (site) e o processo principal do app.
// Expõe window.DupuroDesktop — o printer.js detecta isso e usa a impressão
// nativa (sem janela). Em navegador comum, window.DupuroDesktop não existe e
// o caixa segue no fluxo normal (serial / diálogo do Windows).
// ==========================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DupuroDesktop', {
  versao: '1.1.0',
  // Recebe o HTML da comanda (80mm) e imprime sem diálogo. Retorna {ok, error}.
  imprimir: (html) => ipcRenderer.invoke('dupuro-print', html),
  listarImpressoras: () => ipcRenderer.invoke('dupuro-listar-impressoras'),
  // patch = { printerName, tefTipo, tefServidor, tefLoja, tefTerminal };
  // sem patch, só lê a config.
  config: (patch) => ipcRenderer.invoke('dupuro-config', patch || null)
});

// Ponte do TEF (cartão). O caixa chama DupuroTEF.cobrar({valor,tipo}) e o processo
// principal conversa com o TEF configurado. Enquanto o TEF real (SiTef/PayGo) não
// está ligado, roda em modo 'simulacao' (aprova sozinho) pra dar pra testar o
// fluxo inteiro. O técnico do TEF depois é só apontar a config.
contextBridge.exposeInMainWorld('DupuroTEF', {
  cobrar: (payload) => ipcRenderer.invoke('dupuro-tef-cobrar', payload || {}),
  estado: () => ipcRenderer.invoke('dupuro-tef-estado')
});
