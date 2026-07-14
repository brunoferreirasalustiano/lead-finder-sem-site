# AGENTS.md — Lead Finder Sem Site

Estas regras valem para qualquer agente ou sessão de Codex que altere este repositório.

## Ambiente e arquitetura

- Usar Node.js 22, TypeScript estrito e módulos ESM.
- Preservar a separação entre API, worker, pacotes de domínio, persistência e scripts operacionais.
- Validar entradas externas com Zod.
- Nunca aceitar consultas Overpass arbitrárias.
- Manter a deduplicação de leads por `(osm_type, osm_id)` no PostgreSQL.
- Tratar PostgreSQL como autoridade para concorrência, leases, cotas, idempotência e transições persistentes.

## Segurança permanente

Não adicionar, habilitar ou simular como real sem autorização explícita e escopo próprio:

- providers reais de e-mail ou WhatsApp;
- SDKs de envio, webhooks públicos ou chamadas de rede externa;
- scraping do Google ou automação não oficial de WhatsApp Web;
- credenciais, tokens, chaves, cookies, arquivos `.env` ou segredos;
- exposição pública de PostgreSQL, n8n ou interfaces administrativas;
- serviços pagos ou dependências externas desnecessárias;
- envio real de mensagens.

Nunca registrar payloads sensíveis, contatos completos ou segredos em logs, issues, PRs ou artefatos de CI.

## Escolha do modelo Codex

Sempre informar o modelo recomendado antes de iniciar uma tarefa:

- **Lua:** documentação, texto, renomeações, ajustes de configuração sem risco, testes unitários pequenos e mudanças isoladas.
- **Terra:** modelo padrão para features médias, correções em vários arquivos, migrations controladas, integração interna e testes PostgreSQL.
- **Sol:** apenas para arquitetura complexa, concorrência crítica, segurança, incidentes difíceis, migrations destrutivas ou investigação sem causa conhecida.

Começar pelo modelo mais econômico capaz de executar com segurança. Escalar de Lua para Terra ou de Terra para Sol somente após identificar uma limitação concreta, registrando o motivo.

## Escopo e paralelismo

- Implementar apenas o escopo solicitado.
- Não iniciar funcionalidades futuras automaticamente.
- Não refatorar áreas não relacionadas.
- Não alterar regras de negócio ou arquitetura sem necessidade demonstrada.
- Manter no máximo **duas PRs funcionais simultâneas**, e somente quando modificarem domínios independentes.
- Evitar PRs paralelas que alterem as mesmas migrations, tabelas, contratos compartilhados ou workflows.
- Commits devem ser pequenos, objetivos e com um único assunto.

## Banco de dados e migrations

Toda migration deve:

- ser incremental e idempotente;
- preservar compatibilidade com dados históricos;
- declarar estratégia de backfill, inclusive para estados em andamento;
- proteger invariantes no PostgreSQL quando apropriado;
- aplicar com sucesso duas vezes no ambiente de CI;
- incluir teste de upgrade quando alterar semântica de registros preexistentes;
- ser validada com integração PostgreSQL real, concorrência quando aplicável e restart lógico.

Nunca depender apenas da configuração atual do processo para interpretar ciclos históricos já iniciados.

## Testes e gates obrigatórios

Antes de publicar uma entrega, executar quando aplicável:

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`
5. `npm run test:coverage`
6. `npm run build`
7. `npm audit --audit-level=high`
8. `git diff --check`
9. migrations aplicadas duas vezes em PostgreSQL real
10. integração em duas passagens isoladas
11. restart lógico
12. builds de imagens e `multiarch` quando o workflow determinar

Não declarar PASS para algo que não executou. Usar apenas `PASS`, `FAIL`, `SKIPPED` ou `NOT RUN`, com a causa factual.

Check Runs do GitHub Actions são evidência válida mesmo quando o Commit Status legado estiver vazio.

## Pull requests

- Abrir PR como **Draft** e relacionar a issue com `Relates to #N`, salvo tarefa documental conduzida diretamente pela supervisão.
- Não marcar Ready for Review.
- Não fazer merge.
- Não fechar issues.
- Parar após push e abertura/atualização da PR.
- A supervisão externa revisará diff, threads, head SHA, CI, mergeabilidade e pós-merge.
- O merge autorizado será squash merge protegido pelo head SHA exato.

## Resposta final do agente

Ao concluir, informar de forma objetiva:

- modelo utilizado;
- base;
- SHA final;
- branch;
- PR;
- arquivos alterados;
- invariantes preservadas;
- testes executados;
- cobertura;
- CI;
- riscos residuais.

Não ocultar validações bloqueadas ou não executadas.