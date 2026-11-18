# WhatsApp Mining — Fase 1 (Mineração + Anonimização)

Parser e anonimizador de exports do WhatsApp Business para análise qualitativa.
Extrai mensagens dos clientes, substituindo telefones, CPFs, emails, CNPJs e números longos por placeholders (`⟨tel⟩`, `⟨cpf⟩`, `⟨email⟩`, `⟨cnpj⟩`, `⟨num⟩`). Mensagens da Dupuro são descartadas integralmente (só contabilizadas).

**Execução:** `python parse_anon.py [--smoke]` processa as conversas do diretório de origem.
**Saídas:** `$OPENCODE_SESSION_TEMP/wa-mining/` (NUNCA no repo): `anon/C*.json`, `stats.csv`, `mapa-local.csv`, `perguntas-dedup.txt`.
**Segurança:** dados brutos nunca saem da máquina local. Padrões conhecidos de auto-apresentação são scrubados (`⟨nome⟩`) e testados no self-test; nome grafado fora desses padrões é residual raro — ver docs/especificacao-chat-qualificacao.md LGPD. Apenas textos anonimizados podem ser enviados a terceiros (TypeSafe, Fase 2). O `mapa-local.csv` contém o mapeamento ID→origem e deve permanecer offline.
