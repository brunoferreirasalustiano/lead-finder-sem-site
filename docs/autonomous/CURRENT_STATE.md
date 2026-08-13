# Lead Finder Brasil — Current Autonomous State

Last reconciled: 2026-08-13T02:39Z.

This file is the resume point after model capacity errors, disconnects, context compaction or agent handoff. Current external state always wins over this file; update this file after every completed gate.

## Repository

```text
PROJECT=Lead Finder Brasil
REPO=brunoferreirasalustiano/lead-finder-sem-site
HML_BRANCH=hml/render-supabase-plan-b
HML_SHA=6fa783adb2bf3a4a405a563ef20659a8dfaf4cd7
MAIN_SHA=8181c3e007ef8dee7117f81fc7f07ca16a05d002
LAST_MERGED_PR=266
PR262_HEAD=f8203dac4b25ca67755e1f76f5feec6620aac0dc
PR262_MERGE=d7c4181fa1a661cf9323e455642598fddcf96a27
PR263_HEAD=2313198cd465acb7fd47d27e67bc422de2c85f01
PR263_MERGE=56d9a468f67b6187988bf555d4606f79af94ade8
PR264_HEAD=b997bc5d9227549f5c9aecd0ecf2db3f71c3aee5
PR264_MERGE=f23bb6962c0435cd97c0f13ffdca5c6e40cf038e
PR265_HEAD=b9fca0b30383e863ac945feffe60f1e1d3e62b38
PR265_MERGE=894c136dba8e869d8a27433efd256f40d5062331
PR266_HEAD=9de93fc17b8a4d0b8c3e129d0f583d9d1bf93815
PR266_MERGE=6fa783adb2bf3a4a405a563ef20659a8dfaf4cd7
EXACT_SHA_CI_RUN=31661064775
EXACT_SHA_CI=PASS
PR266_EXACT_HEAD_CI_RUN=31660764607
PR266_EXACT_HEAD_CI=PASS
PR262_CI_RUN=31649854222
DEPLOYMENT_SMOKE_RUN=31649840784
POSTMERGE_DEPLOYMENT_SMOKE_RUN=31652985173
```

PR #260's normalization P1 was fixed by PR #262. PR #262 was merged only after its exact-head checks passed and exact merged-SHA CI run 31650521308 completed successfully. PR #264 is documentation-only; its merge SHA f23bb696 was revalidated by exact-SHA CI run 31652985214 and deployment smoke run 31652985173, both successful. PR #265 reconciled this file to HML merge SHA 894c136 and exact merged-SHA CI run 31659193151, which passed.

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
RENDER_SHA=6fa783adb2bf3a4a405a563ef20659a8dfaf4cd7
RENDER_DEPLOY_ID=dep-d9uir57qj5pc73fn1m20
RENDER_STATUS=UPDATE_FAILED_STARTUP_INVALID_CONFIGURATION
RENDER_HEALTH=NOT RUN (deploy dep-d9uir57qj5pc73fn1m20 exited status 1 at 2026-08-13T02:36:54Z)
RENDER_READINESS=NOT RUN (startup emitted INVALID_CONFIGURATION; last prior 200 logged 2026-08-12T23:48Z)
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

The failed request identity `2026-08-12|16|campinas-sp|daily6-v1` is terminal and remains untouched: `FAILED`, `attempt_count=1`, `error=SOURCE_RATE_LIMITED`. Recovery always creates a fresh request identity; it never requeues or edits this row.

## Fixed blockers

PR #259 fixed the direct-table least-privilege incompatibility by adding the narrow `lead_finder_internal.enqueue_collection_job(text,jsonb)` function.

PR #260 / migration 0058 closed the original nullable-JSON fail-open and most normalization drift by adding explicit null-safe authorization checks and an incremental function replacement.

## Resolved enqueue blocker — migration 0059

The historical migration 0058 defect affected uppercase accented cities such as `Águas de Lindóia`: its translation occurred before lowercasing, diverging from canonical TypeScript normalization.

Migration 0059 is now applied and the original P1 is resolved. Applied migrations 0057/0058 are byte-unchanged. The exact merged SHA CI, hosted ACL/RLS checks, reversible normalization/replay/negative transaction and Render live/readiness checks all passed.

## Current blocker — discovery provider rate limit

The single controlled discovery dispatch passed all preflight and enqueue checks, but its bounded worker failed closed with `SOURCE_RATE_LIMITED`. The enrichment provider returned no usable evidence; no send path was reached. The exact provider remains UNKNOWN until provider-specific telemetry from a fresh bounded run proves it; historical provider call counts are UNKNOWN and are not inferred from aggregate rows.

Recovery is executable and fail-closed:

1. recover the reviewed HML runtime configuration or obtain authorized configuration evidence; do not change secrets ad hoc;
2. revalidate health/readiness on the deployed merge SHA;
3. validate the provider health/usage probes;
4. dispatch exactly one fresh Campinas/SP identity after checking it does not already exist;
5. require complete PII-safe accounting and terminal `COMPLETED`; never requeue the failed identity.

Pacing evidence used by the bounded policy: Tavily search is paced at least 1 second between calls, with retry-after honored only up to the explicit 10-second discovery cap; CNPJ.ws public API is capped at 3 requests/minute. These limits are not reused for Gmail or commercial email.

## Immediate next gate

```text
NEXT_PHASE=B
NEXT_TASK=RECOVER_HML_INVALID_CONFIGURATION_THEN_HEALTH_PROBE_AND_ONE_FRESH_DISCOVERY
BASE_SHA=6fa783adb2bf3a4a405a563ef20659a8dfaf4cd7
DISCOVERY_E2E=FAIL_PROVIDER_RATE_LIMITED
ACCURACY=NOT_RUN_PROVIDER_UNKNOWN
AUTOMATED_COMPLIANCE=NOT_RUN
QUOTAS_AND_IDEMPOTENCY=NOT_RUN
REAL_OUTREACH_BLOCKED=true
PROJECT_BLOCKED=true
CURRENT_PROVIDER=UNKNOWN_UNTIL_PROOF
PROVIDER_CALL_COUNTS=UNKNOWN_UNTIL_FRESH_PII_SAFE_ACCOUNTING
RATE_LIMIT_PROVIDER_IDENTIFIABLE=NOT RUN
PROVIDER_CALL_ACCOUNTING=NOT RUN
PROVIDER_HEALTH_OR_USAGE_EVIDENCE=NOT RUN
FAILED_JOB_REQUEUE=false
STOP_CONDITION=RENDER_STARTUP_INVALID_CONFIGURATION_MISSING_AUTHORIZED_CONFIG
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
3. keep the single-dispatch invariant; do not retry run 31651324092 or requeue its terminal job;
4. require provider-identifiable telemetry, complete PII-safe accounting and health/usage evidence before the one authorized fresh identity;
5. if HML startup is invalid, recover only through a reviewed configuration/deploy change and revalidate health/readiness;
6. never enable real outreach, Daily-6 or reply routing while any recovery or provider gate is not PASS.
