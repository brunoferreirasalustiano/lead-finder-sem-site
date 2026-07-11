# Regras técnicas

- Node.js 22, TypeScript estrito e módulos ESM.
- Validar toda entrada externa com Zod; nunca aceitar consultas Overpass arbitrárias.
- Preservar a separação entre API, worker e pacotes de domínio.
- Nunca versionar segredos ou arquivos `.env`.
- Não expor PostgreSQL, n8n ou serviços administrativos publicamente.
- Preferir mudanças pequenas, tipadas e acompanhadas de testes.
- Manter deduplicação por `(osm_type, osm_id)` no banco.
- Executar typecheck, lint, testes e build antes de commits.
- Não adicionar serviços pagos, Google scraping ou automação de mensagens.
