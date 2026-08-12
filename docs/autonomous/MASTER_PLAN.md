# Lead Finder Brasil — Autonomous Completion Master Plan

Objetivo operacional: chegar de forma controlada ao piloto real Daily-6, mantendo segurança, idempotência, opt-out, hard-bounce suppression, quotas e handoff humano somente para respostas comerciais positivas.

Este plano é normativo quando a missão declara `AUTONOMOUS_COMPLETION_MODE=true`.

## Estado-alvo

```text
ZERO_TOUCH_PROSPECTING=true
HUMAN_HANDOFF_ONLY_ON_POSITIVE_REPLY=true
ACTIVE_CITY=Campinas/SP
TARGET_DAILY_SENDS=6
BATCHES_PER_DAY=3
SLOTS=09,13,16
MAX_PER_SLOT=2
HARD_MAX_PER_DAY=6
TIMEZONE=America/Sao_Paulo
NO_CATCH_UP=true
NO_BACKFILL=true
WHATSAPP_AUTOMATION=false
```

## Sequência obrigatória

### Fase A — P2 hardening do enqueue

Objetivo: fechar os dois P2 remanescentes da migration 0057 sem reescrever migration aplicada.

Entregas:

- migration incremental 0058;
- validação fail-closed de campos JSON ausentes/null;
- paridade exata da normalização `collectionCityId` entre TypeScript e PostgreSQL;
- testes de replay, concorrência e rollback;
- ACL least-privilege inalterada;
- PR/CI/merge exact-head;
- exact merged SHA CI PASS;
- migration HML aplicada canonicamente;
- Render HML LIVE no mesmo SHA;
- P2 threads resolvidas com evidência.

Exit criteria:

```text
P2_NULL_FAIL_OPEN=CLOSED
P2_NORMALIZATION_DRIFT=CLOSED
API_RUNTIME_DIRECT_TABLE_ACCESS=false
API_RUNTIME_ENQUEUE_EXECUTE=true
HEALTH=200
READINESS=200
```

Proibição: nenhum discovery E2E nesta fase.

### Fase B — Discovery E2E controlado

Executar exatamente um `workflow_dispatch` de `discovery-pilot.yml` com Campinas/SP, `saloes-de-beleza`, um slot válido e o SHA operacional aprovado.

Exit criteria:

- SHA gate PASS;
- secrets PASS;
- readiness PASS;
- auth/egress preflight PASS;
- enqueue PASS;
- bounded one-shot worker PASS;
- provider call accounting completo;
- nenhum email/WhatsApp;
- provider unavailable/429/5xx/timeout => UNKNOWN, nunca evidência negativa.

### Fase C — Accuracy audit

Auditar os candidatos gerados sem editar dados para melhorar score.

Exigir por candidato elegível:

- business identity confirmed;
- business active confirmed;
- public business email confirmado e associado;
- email não inferido;
- `OFFICIAL_SITE_FOUND=false` somente com busca atual e `SITE_SEARCH_CONFIDENCE=HIGH`.

Qualquer `UNKNOWN`, `MEDIUM`, `AMBIGUOUS` ou provider indisponível => rejeição/defer, nunca envio.

### Fase D — Automated compliance hosted

Executar sem envio.

Contrato obrigatório:

```text
BUSINESS_IDENTITY_CONFIRMED=true
BUSINESS_ACTIVE=PASS
PUBLIC_BUSINESS_EMAIL_PRESENT=true
EMAIL_BUSINESS_ASSOCIATION=PASS
EMAIL_INFERRED=false
OFFICIAL_SITE_FOUND=false
SITE_SEARCH_CONFIDENCE=HIGH
PRIOR_CONTACT=false
DUPLICATE=false
PENDING_OR_AMBIGUOUS_SEND=false
SUPPRESSED=false
HARD_BOUNCE=false
OPT_OUT=false
DO_NOT_CONTACT=false
NAO_CONTATAR=false
DAILY_QUOTA_AVAILABLE=true
BATCH_QUOTA_AVAILABLE=true
GMAIL_HEALTHY=true
AUTOMATED_COMPLIANCE_GATE=PASS
```

### Fase E — Quota, concorrência e idempotência

Somente fixtures sintéticas, sem Gmail.

Provar:

- 3 contenders mesma batch => máximo 2 reservas;
- 7 contenders mesmo dia => máximo 6 reservas;
- mesma identidade => uma reserva lógica;
- mesmo recipient fingerprint => uma reserva lógica;
- concorrência não excede limites;
- limpeza das fixtures deixa zero resíduos sintéticos.

### Fase F — Um canário real

HUMAN_GATE de autorização já satisfeita para exatamente um canário somente quando A-E estiverem PASS; o coordenador deve revalidar imediatamente antes do envio.

Requisitos:

- exatamente 1 destinatário real qualificado;
- primeiro contato somente por email;
- sem CC/BCC/anexo/WhatsApp/follow-up;
- compliance PASS;
- quotas PASS;
- Gmail health PASS;
- provider call accounting explícito;
- persistência de attempt/event/ledger PASS;
- replay após sucesso deve gerar `providerCalls=0` e nenhum duplicado.

Timeout, persistência ambígua, provider ambiguous ou idempotência incerta => STOP sem retry.

Exit criteria:

```text
CANARY_REAL_EMAIL_SENT=1
CANARY_PROVIDER_CALLS=1
CANARY_PERSISTENCE=PASS
CANARY_REPLAY_PROVIDER_CALLS=0
CANARY_DUPLICATES=0
```

### Fase G — Scheduler Daily-6

Somente após canário PASS.

Habilitar:

```text
09:00 max 2
13:00 max 2
16:00 max 2
America/Sao_Paulo
hard max 6/day
no catch-up
no backfill
PostgreSQL ledger = source of truth
```

Manter qualidade acima de quantidade: se houver menos candidatos seguros, enviar menos.

Piloto inicial: máximo 7 dias / 42 emails, sem auto-scale.

### Fase H — Reply classification e Bruno handoff

Classificar respostas:

- POSITIVE_INTEREST
- COMMERCIAL_QUESTION
- QUOTE_REQUEST
- MEETING_REQUEST
- NEGATIVE
- OPT_OUT
- OUT_OF_OFFICE
- BOUNCE
- AUTO_REPLY
- AMBIGUOUS

Routing:

- positive/commercial/quote/meeting => `INTERESTED -> NEEDS_BRUNO`;
- opt-out => suppression permanente;
- hard bounce => bounce suppression;
- negative/no-interest => close;
- auto reply => record/no action;
- OOO => record/no auto follow-up inicialmente;
- ambiguous => HOLD conservador.

Nunca negociar automaticamente preço, desconto, escopo, pagamento, promessa ou prazo.

## Proibições permanentes

- WhatsApp automático antes de migração explícita para Cloud API oficial e nova autorização;
- scraping de Google não autorizado;
- retry após provider/persistência ambígua;
- alterar quotas para compensar falhas;
- classificar ausência de fonte como ausência de site;
- expor secrets/PII em logs, issues ou reports;
- escalar automaticamente acima de 6/dia durante o piloto.

## Definição de conclusão

Esta etapa do projeto é considerada concluída quando:

```text
P2_HARDENING=PASS
DISCOVERY_E2E=PASS
ACCURACY=PASS
AUTOMATED_COMPLIANCE=PASS
QUOTAS_AND_IDEMPOTENCY=PASS
CANARY=PASS
DAILY6_SCHEDULER=ENABLED_WITH_LIMITS
REPLY_ROUTING=PASS
BRUNO_HANDOFF_ONLY_ON_POSITIVE=true
```

Após isso, a atividade autônoma passa de construção para operação monitorada.