# Lead Finder Brasil — Current Autonomous State

Last reconciled: 2026-08-12T23:36Z.

This file is the resume point after model capacity errors, disconnects, context compaction or agent handoff. Current external state always wins over this file; update this file after every completed gate.

## Repository

```text
PROJECT=Lead Finder Brasil
REPO=brunoferreirasalustiano/lead-finder-sem-site
HML_BRANCH=hml/render-supabase-plan-b
HML_SHA=56d9a468f67b6187988bf555d4606f79af94ade8
MAIN_SHA=8181c3e007ef8dee7117f81fc7f07ca16a05d002
LAST_MERGED_PR=263
PR262_HEAD=f8203dac4b25ca67755e1f76f5feec6620aac0dc
PR262_MERGE=d7c4181fa1a661cf9323e455642598fddcf96a27
PR263_HEAD=2313198cd465acb7fd47d27e67bc422de2c85f01
PR263_MERGE=56d9a468f67b6187988bf555d4606f79af94ade8
EXACT_SHA_CI_RUN=31652065388
EXACT_SHA_CI=PASS
PR262_CI_RUN=31649854222
DEPLOYMENT_SMOKE_RUN=31649840784
POSTMERGE_DEPLOYMENT_SMOKE_RUN=31652429249
```

PR #260's normalization P1 was fixed by PR #262. PR #262 was merged only after its exact-head checks passed and exact merged-SHA CI run 31650521308 completed successfully.

## Supabase HML

```text
PROJECT_ID=ondvzdvlwntrnieodifi
REGION=sa-east-1
POSTGRES=17.6
MIGRATION_0057=APPLIED_NATIVE_REGISTRY
MIGRATION_0058=APPLIED_NATIVE_REGISTRY
MIGRATION_0059=APPLIED_NATIVE_REGISTRY (20260812232902)
PUBLIC_SCHEMA_MIGRATION_HISTORY=HISTORICALLY_DIVERGENT_DO_NOT_FABRICATE
```

Hosted ACL facts for `lead_finder_api_runtime` remain least-privilege:

```text
DAILY6_BATCHES_SELECT=false
DAILY6_BATCHES_INSERT=false
COLLECTION_JOBS_SELECT=false
COLLECTION_JOBS_INSERT=false
ENQUEUE_COLLECTION_JOB_EXECUTE=true
ENQUEUE_FUNCTION_SECURITY_DEFINER=true
PUBLIC_EXECUTE=false
ANON_EXECUTE=false
AUTHENTICATED_EXECUTE=false
```

Discovery runtime role has been validated with TLS, RLS, narrow direct discovery-table access and no Daily-6 ledger access.

Migration 0059 was validated on HML with a reversible transaction covering uppercase NFC normalization, decomposed NFD normalization, replay idempotency and city-mismatch rejection. The transaction rolled back and synthetic_jobs_remaining=0, synthetic_batches_remaining=0. Direct table privileges remain false; RLS remains true.

## Render HML

```text
SERVICE=lead-finder-api-hml
SERVICE_ID=srv-d9fbpp6rnols73bko9f0
WORKSPACE=Bruno's workspace
WORKSPACE_ID=tea-d72o44oule4c73cut1l0
RENDER_SHA=d7c4181fa1a661cf9323e455642598fddcf96a27
RENDER_DEPLOY_ID=dep-d9ug3ndbedkc73a3u180
RENDER_STATUS=LIVE
RENDER_HEALTH=200
RENDER_READINESS=200
```

Discovery-only hosted profile remains the intended state until canary authorization gates are satisfied.

## Discovery workflow history

Historical controlled discovery runs:

```text
RUN_1=31614291037  # failed: HML_DATABASE_URL absent
RUN_2=31615733632  # failed: HML_DATABASE_URL absent
RUN_3=31617067686  # failed: API runtime direct daily6_batches privilege boundary
RUN_4=31651324092  # exact SHA/secrets/readiness/auth/build/enqueue PASS; worker FAILED SOURCE_RATE_LIMITED
```

Runs 1-3 made no provider discovery calls. Run 4 reached the external enrichment provider but sent no email/WhatsApp.

`HML_DATABASE_URL` is present in the GitHub Environment `hml-discovery`.

Run 31651324092 was the single authorized dispatch. The collection job reached `FAILED` with `attempt_count=1` and `SOURCE_RATE_LIMITED` during enrichment. Hosted aggregate evidence since dispatch: 30 leads collected, 1 enriched, 0 verified evidence rows, 0 valid email contacts, 0 campaign outbox rows and 0 Daily-6 send-ledger rows. This is provider-unavailable/UNKNOWN evidence, never evidence of absence.

## Fixed blockers

PR #259 fixed the direct-table least-privilege incompatibility by adding the narrow `lead_finder_internal.enqueue_collection_job(text,jsonb)` function.

PR #260 / migration 0058 closed the original nullable-JSON fail-open and most normalization drift by adding explicit null-safe authorization checks and an incremental function replacement.

## Resolved enqueue blocker — migration 0059

The historical migration 0058 defect affected uppercase accented cities such as `Águas de Lindóia`: its translation occurred before lowercasing, diverging from canonical TypeScript normalization.

Migration 0059 is now applied and the original P1 is resolved. Applied migrations 0057/0058 are byte-unchanged. The exact merged SHA CI, hosted ACL/RLS checks, reversible normalization/replay/negative transaction and Render live/readiness checks all passed.

## Current blocker — discovery provider rate limit

The single controlled discovery dispatch passed all preflight and enqueue checks, but its bounded worker failed closed with `SOURCE_RATE_LIMITED`. The enrichment provider returned no usable evidence; no send path was reached. Per the coordinator contract, this remains UNKNOWN and cannot be converted into a negative accuracy result or retried blindly. No second discovery dispatch is authorized in this completion sequence.

## Immediate next gate

```text
NEXT_PHASE=B
NEXT_TASK=WAIT_FOR_PROVIDER_RECOVERY_THEN_REVALIDATE_DISCOVERY_GATE
BASE_SHA=56d9a468f67b6187988bf555d4606f79af94ade8
DISCOVERY_E2E=FAIL_PROVIDER_RATE_LIMITED
ACCURACY=NOT_RUN_PROVIDER_UNKNOWN
AUTOMATED_COMPLIANCE=NOT_RUN
QUOTAS_AND_IDEMPOTENCY=NOT_RUN
REAL_OUTREACH_BLOCKED=true
PROJECT_BLOCKED=true
STOP_CONDITION=PROVIDER_UNAVAILABLE_SOURCE_RATE_LIMITED
```

## Commercial/operation invariants

```text
ACTIVE_CITY=Campinas/SP
TARGET_DAILY_SENDS=6
MAX_PER_SLOT=2
SLOTS=09,13,16
TIMEZONE=America/Sao_Paulo
NO_CATCH_UP=true
NO_BACKFILL=true
QUALITY_OVER_QUANTITY=true
WHATSAPP_AUTOMATION=false
ZERO_TOUCH_PROSPECTING=true
HUMAN_HANDOFF_ONLY_ON_POSITIVE_REPLY=true
```

## Real-send counters at this state

```text
REAL_EMAIL_PROVIDER_CALLS_FROM_CURRENT_COMPLETION_SEQUENCE=0
REAL_EMAIL_SENT_FROM_CURRENT_COMPLETION_SEQUENCE=0
WHATSAPP_SENT=0
CANARY=NOT_RUN
DAILY_6_PILOT_ENABLED=false
DAILY6_SCHEDULER=DISABLED
REPLY_ROUTING=NOT_RUN
```

## Resume instruction

An autonomous coordinator resuming work must:

1. revalidate HML/Main/Render/Supabase/GitHub state;
2. update this file if facts changed;
3. keep the single-dispatch invariant; do not retry run 31651324092 blindly;
4. resume only after the external enrichment provider is demonstrably available, then revalidate the failed discovery gate before any later gate;
5. never enable real outreach, Daily-6 or reply routing while the provider blocker remains.
