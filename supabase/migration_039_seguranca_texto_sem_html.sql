-- migration_039 — Segurança: texto vindo de fora não pode carregar HTML (2026-10-20)
-- ============================================================================
-- Achado na auditoria (skill impeccable + varredura): o admin montava as telas
-- de Aprovações/Revendedores com innerHTML SEM escapar empresa/telefone/e-mail/
-- cidade. Qualquer um podia se cadastrar como revendedor com um <script> no
-- campo "empresa" e, quando o admin abrisse Aprovações, o código rodava logado
-- como admin (roubo de sessão). Duas camadas de correção:
--   1) aqui no banco: os campos preenchidos por quem está de fora não aceitam
--      < nem > (nunca aparecem em nome/cidade/endereço reais) — o cadastro
--      malicioso falha já no signup;
--   2) no front (admin/caixa/dashboard): esc() em tudo que vai pro innerHTML.
-- Conferido antes: nenhum dado existente tinha < ou >.
-- ============================================================================
alter table public.profiles
  add constraint profiles_texto_sem_html check (
    coalesce(nome,'') !~ '[<>]' and coalesce(empresa,'') !~ '[<>]' and
    coalesce(cidade,'') !~ '[<>]' and coalesce(telefone,'') !~ '[<>]');
alter table public.delivery_pedidos
  add constraint delivery_pedidos_texto_sem_html check (
    coalesce(cliente_nome,'') !~ '[<>]' and coalesce(endereco,'') !~ '[<>]' and coalesce(complemento,'') !~ '[<>]');
alter table public.caixa_pedidos_abertos
  add constraint caixa_pedidos_abertos_texto_sem_html check (coalesce(label,'') !~ '[<>]');
