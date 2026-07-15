# Auditoria de segurança e privacidade operacional

Base auditada: `2533e7e40f1b633fc05c83e23576858b09da7630`. Escopo: operação shadow com dados reais, sem provider, webhook, SDK ou envio real.

## Classificação de dados

| Dado | Origem | Finalidade | Persistência | Exposição | Retenção | Risco | Controle existente | Controle faltante / decisão |
|---|---|---|---|---|---|---|---|---|
| Nome empresarial, endereço e localização | Overpass/API | qualificação | `leads`, snapshots | APIs de leads/CSV | enquanto necessário ao piloto | PII/comercial | Zod, paginação, dedupe OSM | exclusão formal e perímetro autenticado |
| Nome de contato, telefone, WhatsApp e e-mail | API/qualificação | validar contato | `lead_contacts`, snapshots | APIs autorizadas; nunca observabilidade | enquanto consentido/necessário | alto | flags de validade, bloqueio e opt-out | autenticação antes de exposição pública |
| CNPJ e identificadores externos | fonte de lead | dedupe/rastreio | identificadores de lead quando presentes | APIs operacionais | enquanto necessário | correlação | dedupe e IDs internos | CNPJ não possui fluxo dedicado atual |
| Payload bruto, mensagem e template | campanha/simulação | evidência e replay | recipient/attempt snapshots, outbox/dead-letter | não deve sair em endpoints internos agregados | mínima para replay/incidente | alto | projeções seguras após esta auditoria | política de anonimização histórica |
| Tokens, leases e idempotency keys | worker/API | concorrência e replay | outbox/audit | somente banco; nunca resposta/log | vida operacional/auditoria mínima | alto | fencing e logs allowlisted | rotação/expurgo por política |
| Opt-out, bloqueio e histórico | API/CRM/campanha | impedir contato | leads, opt-outs, timeline | somente motivo seguro/agregado | opt-out permanente; histórico mínimo | crítico | opt-out imutável, transações e precedência | reconciliação pós-restore |

Não existe fluxo de PDF. CSV de leads é exportação com PII por contrato e deve permanecer atrás de perímetro protegido; snapshots e relatórios operacionais são agregados.

## Findings

| ID | Severidade | Evidência e impacto | Explorabilidade/escopo | Correção e teste | Risco residual |
|---|---|---|---|---|---|
| SEC-01 | P1 | audit/failures devolviam linhas integrais com payload e metadata | remoto no modo público suportado | projeções explícitas e canaries de não divulgação | endpoints ainda exigem proteção de perímetro |
| SEC-02 | P2 | exceção bruta alcançava log e resposta 500 | erro alcançável pela API | handler/serialização seguros e testes com PII/segredo | correlação detalhada fica apenas em telemetria segura futura |
| SEC-03 | P2 | shadow podia iniciar sem guard/config | chamada interna/deploy | default true, guard obrigatório, Compose explícito e regressão sem bypass | nenhum provider existe; alteração para false é proibida no piloto |
| SEC-04 | P2 | update genérico limpava bloqueios | API de qualificação | transição true→false rejeitada e testes | desbloqueio futuro requer comando dedicado e autorização |
| SEC-05 | P2 | opt-out após autorização não revogava execução | corrida transacional | rechecagem/invalidação antes de confirmação e teste PostgreSQL | provider real continua proibido |
| SEC-06 | P2 | relatório/CLI copiava campos livres e path arbitrário | operador/artefato local | projeção agregada, validação, ID estrito e contenção | acesso ao diretório de evidência deve ser restrito |

P0 aberto: nenhum. P1/P2 aberto após os testes desta PR: nenhum. P3 e informativos permanecem na seção de riscos residuais.

## Riscos residuais

- P3: `OVERPASS_URL` é configuração de operador e deve usar somente o endpoint aprovado; não é entrada remota da API.
- P3: cobertura e lint ainda podem ser ampliados para scripts e todos os entrypoints.
- Informativo: retenção/anonimização de snapshots históricos requer projeto próprio e testes destrutivos.
- Bloqueador operacional: os endpoints internos e a API de PII não podem ser publicados sem autenticação/autorização de perímetro.
- Bloqueador operacional: restore exige reconciliação de exclusões e opt-outs posteriores ao backup.

