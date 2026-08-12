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
- Não iniciar funcionalidades futuras automaticamente, exceto quando `AUTONOMOUS_COMPLETION_MODE=true` estiver explicitamente ativado pela missão e o próximo gate estiver descrito em `docs/autonomous/MASTER_PLAN.md`.
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

## Pull requests — modo padrão

- Abrir PR como **Draft** e relacionar a issue com `Relates to #N`, salvo tarefa documental conduzida diretamente pela supervisão.
- Não marcar Ready for Review.
- Não fazer merge.
- Não fechar issues.
- Parar após push e abertura/atualização da PR.
- A supervisão externa revisará diff, threads, head SHA, CI, mergeabilidade e pós-merge.
- O merge autorizado será squash merge protegido pelo head SHA exato.

## Autonomous Completion Mode

Este modo só existe quando a missão declarar literalmente `AUTONOMOUS_COMPLETION_MODE=true`.

Nesse modo, o agente coordenador NÃO deve parar apenas porque terminou uma correção isolada. Após cada gate concluído ele deve:

1. persistir o estado factual em `docs/autonomous/CURRENT_STATE.md`;
2. revalidar Git local, GitHub, CI, HML, Supabase e Render quando aplicável;
3. escolher o próximo blocker exclusivamente a partir de `docs/autonomous/MASTER_PLAN.md` e `docs/autonomous/GATES.md`;
4. delegar trabalho independente a agentes especializados quando isso reduzir risco ou tempo;
5. continuar automaticamente para o próximo gate seguro e autorizado;
6. manter no máximo duas frentes mutantes simultâneas e nunca duas migrations concorrentes;
7. registrar SHAs, run IDs, deploy IDs, migrations e provider call accounting antes de avançar.

No Autonomous Completion Mode, a regra "parar após abrir PR" é substituída por este fluxo controlado:

`implementação -> testes -> PR -> review -> CI -> merge por SHA exato -> CI do SHA merged -> migration/deploy HML -> validação hospedada -> atualização de estado -> próximo gate`.

O coordenador pode fazer merge somente quando TODOS os requisitos abaixo forem verdadeiros:

- PR não é draft;
- CI obrigatório está verde no HEAD exato;
- não existem threads P0/P1/P2 válidas e não resolvidas sobre o escopo alterado;
- diff não contém mudanças não relacionadas;
- merge usa `expected_head_sha` ou proteção equivalente;
- o próximo passo está explicitamente dentro do MASTER_PLAN.

### Stop conditions do modo autônomo

Parar e solicitar intervenção humana somente se houver:

- credencial, senha, OAuth, secret ou autorização externa que o agente não possa obter;
- cobrança, compra, upgrade de plano ou consumo pago não previamente autorizado;
- risco irreversível de produção ou perda de dados;
- provider retornando estado ambíguo que possa causar duplicidade;
- conflito de segurança que não possa ser resolvido fail-closed;
- decisão comercial, preço, desconto, escopo, contrato ou negociação;
- resposta positiva de lead que requeira Bruno;
- ação explicitamente marcada `HUMAN_GATE` em `docs/autonomous/GATES.md`.

Falhas transitórias de CI, testes, model capacity, desconexão, contexto compactado ou provider de desenvolvimento NÃO são motivo para abandonar o plano. Persistir evidência, retomar do último gate seguro e continuar quando possível, sem repetir operações ambíguas.

## Regra especial para outreach real

Mesmo em `AUTONOMOUS_COMPLETION_MODE=true`, nenhum agente pode habilitar envio real em massa por antecipação.

A sequência obrigatória é:

`discovery E2E -> accuracy -> automated compliance -> quota/idempotency -> exatamente 1 canário real -> replay/no-duplicate -> scheduler Daily-6`.

Antes do canário, manter:

- `REAL_EMAIL_SENT=0`;
- `WHATSAPP_SENT=0`;
- `DAILY_6_PILOT_ENABLED=false`;
- `REAL_OUTREACH_BLOCKED=true`.

O canário deve ser exatamente um destinatário qualificado, com compliance e quotas PASS. Qualquer timeout, persistência ambígua, erro de provider ou idempotência incerta implica STOP sem retry.

Após o canário PASS, o scheduler só pode ser habilitado com hard limits: 09/13/16 em `America/Sao_Paulo`, máximo 2 por slot, máximo 6 por dia, sem catch-up/backfill e com PostgreSQL como fonte de verdade.

## Resposta final do agente

Ao concluir uma missão ou atingir um Stop Condition, informar de forma objetiva:

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
- HML/Supabase/Render quando aplicável;
- provider call accounting;
- riscos residuais;
- próximo gate do MASTER_PLAN.

Não ocultar validações bloqueadas ou não executadas.