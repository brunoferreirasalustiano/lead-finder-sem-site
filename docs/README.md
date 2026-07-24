# Documentação do Lead Finder Brasil

Este índice organiza as fontes técnicas e operacionais do projeto. O `README.md` da raiz apresenta a visão geral; os documentos abaixo registram decisões, runbooks, riscos e gates específicos.

## Fonte de estado atual

- [Estado operacional consolidado](current-operational-status.md) — ambiente, capacidades ativas, integrações desligadas, bloqueios e prioridades atuais.
- [Atualização pós-PR #121](issue-117-post-121-update.md) — adendo que substitui o estado de compatibilidade de migrations até a consolidação integral do documento operacional.
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
- [Política de seleção do primeiro lote](first-batch-selection-policy.md) — política v2 para múltiplos nichos, presença digital fraca e amostras maiores.
- [Política de canais de prospecção v2](outreach-channel-policy-v2.md) — uso de dados públicos, e-mail profissional, aquisição de opt-in e limites do WhatsApp.
- [Laboratório sintético de comunicação](communication-experiment-lab.md) — soluções multicanal, 1.080 testes nomeados, matriz de 14.580 cenários e limites de interpretação.
- [Aviso de privacidade para contatos comerciais](privacy-notice-commercial-outreach.md) — transparência, dados, finalidades, direitos e opt-out durante o piloto.
- [Evidências do ensaio sintético do primeiro lote](first-batch-synthetic-rehearsal-evidence.md) — mapeamento dos gates de mensageria manual, concorrência, restart e zero efeito externo.
- [Controle de execução, incidentes e métricas](first-batch-execution-control.md) — estados, registros mínimos, métricas permitidas e runbook de interrupção do lote.
- [Métricas de sucesso do primeiro lote](first-batch-success-metrics.md) — separa envio confirmado, resposta comercial e qualidade operacional; define fórmulas, rubrica de copy e gates duros.
- [Qualificação de canais do primeiro lote](lead-channel-qualification-runbook.md) — hierarquia de fontes, classificação empresarial, opt-in de WhatsApp, supressões e decisão final.
- [Pacote de aprovação final por lead](first-batch-final-approval-packet.md) — ficha privada, gates técnicos e decisão individual antes do contato.

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
- [Compatibilidade dos registros de migrations](migration-registry-compatibility.md) — causa raiz do registro dividido entre o runner local e o Supabase MCP, riscos e caminhos seguros.
- [Evidências da homologação externa](external-homologation-evidence-runbook.md) — níveis de prova, GitHub Pages, Render, health checks, flags, kill switch e restart.
- [Probe externo de homologação](../scripts/external-homologation-probe.mjs) — valida Pages, aviso público, demonstração, health checks e proteção do endpoint interno sem credenciais ou escrita.
- [Operação com dois perfis](runbooks/dual-deployment-operations.md) — liderança, failover e prevenção de split-brain.
- [Variáveis de ambiente](infrastructure/environment-variables.md) — variáveis ativas, secrets e defaults seguros.
- [Gate sintético de batch](infrastructure/synthetic-batch-gate.md) — processamento determinístico em PostgreSQL descartável.
- [Backup e restore](infrastructure/backup-and-restore.md) — cópia, restauração, validação e reconciliação de supressões.
- [Runbook Oracle](ORACLE_DEPLOY.md) — perfil self-hosted com Docker Compose, Caddy e PostgreSQL privado.
- [Matriz de custos free-tier](infrastructure/free-tier-cost-matrix.md) — limites e trade-offs dos ambientes suportados.

## Estratégia de produto

- [Escopo futuro do produto](FUTURE_PRODUCT_SCOPE.md) — visão de prospecção ativa, qualificação por IA, handoff humano, pesquisa territorial ampliada e meta de 60 empresas analisadas por dia.
- [Roadmap estratégico](PRODUCT_ROADMAP.md) — evolução desde o piloto manual até uma plataforma multicanal.
- [Issue #98 — gate de viabilidade do segmento](https://github.com/brunoferreirasalustiano/lead-finder-sem-site/issues/98) — amostra de 30 barbearias concluída com decisão `PIVOT_RECOMMENDED`.

## Regras de manutenção

Toda PR que alterar arquitetura, ambiente, flags, provider, segurança, piloto ou estado de uma fase deve revisar:

1. [estado operacional consolidado](current-operational-status.md);
2. `README.md` da raiz;
3. este índice, quando documentos forem criados, movidos ou removidos;
4. runbook e registro de riscos afetados;
5. issue, PR e evidências de CI correspondentes.

Documentação pública nunca deve conter tokens, senhas, connection strings, PII de leads, mensagens integrais, payloads brutos ou prints com dados pessoais.
