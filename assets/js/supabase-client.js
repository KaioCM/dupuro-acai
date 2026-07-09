// ==========================================================================
// Dupuro Açaí — Instância única do cliente Supabase
// Compartilhada entre cliente.js e admin.js para evitar duas instâncias de
// GoTrueClient (auth) divergindo sobre o estado da sessão no localStorage.
// ==========================================================================

window.DupuroSupabaseClient = window.supabase.createClient(
  window.DUPURO_SUPABASE_URL,
  window.DUPURO_SUPABASE_ANON_KEY
);
