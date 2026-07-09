// ==========================================================================
// Dupuro Açaí — Instância única do cliente Supabase
// Compartilhada entre cliente.js e admin.js para evitar duas instâncias de
// GoTrueClient (auth) divergindo sobre o estado da sessão.
//
// "Manter-me conectado": o Supabase persiste a sessão por padrão (localStorage),
// o que mantém o login mesmo após fechar o navegador. Para dar controle disso
// ao usuário, usamos um storage dinâmico que decide, na hora de gravar, entre
// localStorage (mantém conectado) e sessionStorage (cai ao fechar o navegador).
// A escolha vive na flag abaixo, gravada pela tela de login antes do signIn.
// ==========================================================================

window.DUPURO_PERSIST_KEY = 'dupuro.persistLogin';

// Padrão: manter conectado (só não mantém se a flag for explicitamente 'false').
window.DupuroPersistLogin = {
  get: function () {
    try { return window.localStorage.getItem(window.DUPURO_PERSIST_KEY) !== 'false'; }
    catch (e) { return true; }
  },
  set: function (manter) {
    try { window.localStorage.setItem(window.DUPURO_PERSIST_KEY, manter ? 'true' : 'false'); }
    catch (e) { /* storage indisponível (aba anônima restrita): ignora */ }
  }
};

// Lê dos dois storages (a sessão pode ter sido gravada em qualquer um deles);
// grava apenas no escolhido e limpa o outro, pra nunca haver sessão duplicada.
var dupuroAuthStorage = {
  getItem: function (key) {
    try {
      var v = window.localStorage.getItem(key);
      if (v !== null && v !== undefined) return v;
      return window.sessionStorage.getItem(key);
    } catch (e) { return null; }
  },
  setItem: function (key, value) {
    try {
      var manter = window.DupuroPersistLogin.get();
      (manter ? window.localStorage : window.sessionStorage).setItem(key, value);
      (manter ? window.sessionStorage : window.localStorage).removeItem(key);
    } catch (e) { /* ignora */ }
  },
  removeItem: function (key) {
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch (e) { /* ignora */ }
  }
};

window.DupuroSupabaseClient = window.supabase.createClient(
  window.DUPURO_SUPABASE_URL,
  window.DUPURO_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: dupuroAuthStorage
    }
  }
);
