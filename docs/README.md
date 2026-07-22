# Documentação do Lead Finder Brasil

Este índice organiza as fontes técnicas e operacionais do projeto. O `README.md` da raiz apresenta a visão geral; os documentos abaixo registram decisões, runbooks, riscos e gates específicos.

## Fonte de estado atual

- [Estado operacional consolidado](current-operational-status.md) — ambiente, capacidades ativas, integrações desligadas, bloqueios e prioridades atuais.
- [README principal](../README.md) — visão do produto, arquitetura, execução local, segurança e mapa de documentação.

## Piloto e operação comercial

- [Pacote operacional do piloto manual](pilot-manual-operations-pack.md) — critérios de elegibilidade, lote inicial, revisão humana, resultados, incidentes e métricas sem PII.
- [Primeiro ciclo real controlado](pilot-real-controlled-runbook.md) — homologação isolada, gates, backup/restore, rollback e kill switch sem efeitos externos.
- [Template de mensagem manual v1](pilot-real-manual-message-v1.md) — texto e checklist de aprovação humana; não autoriza envio.
- [Checklist de piloto manual](pilot-manual-checklist.md) — verificação operacional antes de cada contato.
- [Checklist de shadow mode](pilot-shadow-mode-checklist.md) — controles para execução sem efeitos externos.
- [Matriz de prontidão comercial](commercial-readiness-matrix.md) — gates comerciais e técnicos.
- [Métricas de qualidade de leads](lead-quality-metrics.md) — definições de qualidade sem inferir ausência real de site.
- [Métricas do funil](commercial-funnel-metrics.md) — definições reconciliáveis de etapas e conversões.
- [Política de recuperação de leads](lead-recovery-policy.md) — tratamento seguro de estados e retomadas.
- [Avaliação de legítimo interesse do primeiro contato](first-outreach-legitimate-interest-assessment.md) — finalidade, necessidade, balanceamento, salvaguardas e decisão condicional.
- [Ficha individual de revisão de lead](first-lead-review-sheet.md) — template privado para validar negócio, canal, supressões, mensagem e resultado.
- [Política de seleção do primeiro lote](first-batch-selection-policy.md) — critérios de inclusão/exclusão, triagem e regra de canal.
- [Aviso de privacidade para contatos comerciais](privacy-notice-commercial-outreach.md) — transparência, dados, finalidades, direitos e opt-out durante o piloto.
- [Evidências do ensaio sintético do primeiro lote](first-batch-synthetic-rehearsal-evidence.md) — mapeamento dos gates de mensageria manual, concorrência, restart e zero efeito externo.
- [Controle de execução, incidentes e métricas](first-batch-execution-control.md) — estados, registros mínimos, métricas permitidas e runbook de interrupção do lote.

## WhatsApp e IA

- [Arquitetura de mensageria WhatsApp + IA](whatsapp-ai-messaging-architecture.md) — providers, revisão humana, idempotência, webhooks e kill switch.
- [Checklist de implementação WhatsApp + IA](whatsapp-ai-implementation-checklist.md) — fundação, manual assistido, shadow, sandbox e gate real.
- [Registro de riscos de WhatsApp e IA](whatsapp-ai-risk-register.md) — riscos, controles, evidências e estados.
- [Issue #79 — onboarding Meta e OpenAI](https://github.com/brunoferreirasalustiano/lead-finder-sem-site/issues/79) — contas, IDs, secrets, sandbox, retenção e gates externos.

## Segurança, privacidade e dados

- [Auditoria de segurança e privacidade](security-privacy-audit.md) — superfície de dados, autenticação, logs e controles.
- [Threat model operacional](operational-threat-model.md) — ativos, fronteiras, ameaças e mitigação.
- [Retenção e exclusão](data-retention-and-deletion.md) — minimização, retenção, exclusão e restauração.
- [Segurança da Data API Supabase](supabase-data-api-security.md) — postura deny-all, grants efetivos, RLS e gates para acesso público futuro.
- [Runtime shadow](shadow-mode-runtime.md) — isolamento de efeitos externos e evidências sanitizadas.

## Infraestrutura e implantação

- [Plano B Supabase + Render](infrastructure/supabase-render-plan-b.md) — arquitetura free-tier com processamento limitado e fail-closed.
- [Runbook Supabase + Render](runbooks/supabase-render-deployment.md) — migrations, Render Blueprint, Edge Function opcional, Cron e desligamento.
- [Operação com dois perfis](runbooks/dual-deployment-operations.md) — liderança, failover e prevenção de split-brain.
- [Variáveis de ambiente](infrastructure/environment-variables.md) — variáveis ativas, secrets e defaults seguros.
- [Gate sintético de batch](infrastructure/synthetic-batch-gate.md) — processamento determinístico em PostgreSQL descartável.
- [Backup e restore](infrastructure/backup-and-restore.md) — cópia, restauração, validação e reconciliação de supressões.
- [Runbook Oracle](ORACLE_DEPLOY.md) — perfil self-hosted com Docker Compose, Caddy e PostgreSQL privado.
- [Matriz de custos free-tier](infrastructure/free-tier-cost-matrix.md) — limites e trade-offs dos ambientes suportados.

## Estratégia de produto

- [Roadmap estratégico](PRODUCT_ROADMAP.md) — evolução desde o piloto manual até uma plataforma multicanal.

## Regras de manutenção

Toda PR que alterar arquitetura, ambiente, flags, provider, segurança, piloto ou estado de uma fase deve revisar:

1. [estado operacional consolidado](current-operational-status.md);
2. `README.md` da raiz;
3. este índice, quando documentos forem criados, movidos ou removidos;
4. runbook e registro de riscos afetados;
5. issue, PR e evidências de CI correspondentes.

Documentação pública nunca deve conter tokens, senhas, connection strings, PII de leads, mensagens integrais, payloads brutos ou prints com dados pessoais.
