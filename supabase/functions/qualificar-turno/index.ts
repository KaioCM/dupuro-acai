// Dupuro Açaí — Edge Function `qualificar-turno`: DESATIVADA em 2026-11-19.
// Substituída pela Edge `assistente` (assistente Puri). Esta versão é só um
// stub: responde 410 a qualquer requisição e NÃO toca no banco, para que a
// URL antiga (anônima, verify_jwt=false) não crie mais linhas em
// `qualificacao_leads`. Nenhum código do site chama esta função.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve((_req: Request) =>
  new Response(JSON.stringify({ ok: false, motivo: 'desativada' }), {
    status: 410,
    headers: { ...cors, 'Content-Type': 'application/json' },
  }))
