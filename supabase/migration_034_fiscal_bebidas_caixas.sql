-- ==========================================================================
-- migration_034 — Classificação fiscal de bebidas e caixas/potes de açaí
-- ==========================================================================
-- Fecha a pendência do mapeamento fiscal (ver [[dupuro-fiscal-nfce]]). Base:
-- cadastros do Naja (prints do Kayo) + orientação dele.
--   - Caixas/potes de açaí/creme (grupo COZINHA): "mesmos códigos dos copos"
--     → NCM 21050010, CSOSN 500, CFOP 5405 (ST substituído). Print da "Caixa
--     Creme Banana 10L" confirma NCM 21050010.
--   - Água (grupo BEBIDAS): NCM 22011000 (água mineral), ST → CSOSN 500/CFOP 5405.
--   - Refrigerante (Coca/Coca Zero): NCM 22021000 (refrigerante, decisão do Kayo
--     pelo NCM correto em vez de copiar o da água), mesmo ST 500/5405.
-- CEST continua NÃO enviado (a nota autorizada, mesmo item ST, sai sem CEST).
-- A taxa de entrega usa os códigos dos adicionais (08119000/102/5102) — mas é
-- linha sem produto, tratada no emitir-nfce quando fizermos o fiscal dela.
-- ==========================================================================

-- Caixas/potes de açaí e creme = igual aos copos (sorvete ST).
update public.products
   set ncm = '21050010', csosn = '500', cfop = '5405', icms_origem = '0'
 where id in (4, 13, 14, 15, 16, 18, 19, 21, 22, 23, 24);

-- Água (mineral, com/sem gás) — ST.
update public.products
   set ncm = '22011000', csosn = '500', cfop = '5405', icms_origem = '0'
 where id in (28, 29);

-- Refrigerante (Coca / Coca Zero) — ST.
update public.products
   set ncm = '22021000', csosn = '500', cfop = '5405', icms_origem = '0'
 where id in (26, 27);
