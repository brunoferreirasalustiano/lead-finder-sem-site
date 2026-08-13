# Lead Finder Brasil — Current Autonomous State

Last reconciled: 2026-08-13T12:48Z.

This file is the resume point after model capacity errors, disconnects, context compaction or agent handoff. Current external state always wins over this file; update this file after every completed gate.

## Repository

```text
PROJECT=Lead Finder Brasil
REPO=brunoferreirasalustiano/lead-finder-sem-site
HML_BRANCH=hml/render-supabase-plan-b
HML_SHA=3ac05d56610cd860d0560a7e26fc9554011ed95a
MAIN_SHA=8181c3e007ef8dee7117f81fc7f07ca16a05d002
LAST_MERGED_PR=275
PR270_MERGE=b98ac833de4a9e582659861e13ed5ed1fb164655
PR272_MERGE=ea228eb49c1c54c7bed7c43a6fb91a2cc2f865f1
PR273_MERGE=5b178489303e7c95fe81a81584e877a7f2f3436e
PR274_MERGE=4d9ac303324fc89db482883b0d26670ca0ce9dfc
PR275_HEAD=1cbdeea17151f7f41f50d7b9f5b353ffc961dca5
PR275_MERGE=3ac05d56610cd860d0560a7e26fc9554011ed95a
PR275_EXACT_HEAD_CI_RUN=31701150328
PR275_EXACT_HEAD_CI=PASS
PR275_POSTMERGE_CI_RUN=31701587730
PR275_POSTMERGE_CI=IN_PROGRESS_AT_RECONCILIATION
PR272_POSTMERGE_CI_RUN=31696445463
PR272_POSTMERGE_CI=PASS
PR273_POSTMERGE_CI_RUN=31698068105
PR273_POSTMERGE_CI=PASS
PR274_POSTMERGE_CI_RUN=31699364698
PR274_POSTMERGE_CI=PASS
```

PR #270 added PII-safe startup diagnostics that report only the startup stage and invalid configuration field names. PR #272 made expired dedicated HML discovery/Daily-6 credentials request-denied without taking public health/readiness down. PR #273 separated provider health probing from full discovery and added PII-safe provider accounting. PR #274 restored hosted readiness plus authenticated no-enqueue `/collect` preflight before G6. PR #275 added conservative worker-only CNPJ.ws operational pacing after the single G6 identified the provider-specific rate limit.

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

Hosted least-privilege boundaries previously validated for `lead_finder_api_runtime` remain the intended contract:

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

The discovery runtime role uses the narrow hosted discovery path and no Daily-6 ledger access. No failed collection row is to be requeued or edited for recovery.

## Render HML

```text
SERVICE=lead-finder-api-hml
SERVICE_ID=srv-d9fbpp6rnols73bko9f0
WORKSPACE=Bruno's workspace
WORKSPACE_ID=tea-d72o44oule4c73cut1l0
RENDER_LIVE_SHA=4d9ac303324fc89db482883b0d26670ca0ce9dfc
RENDER_DEPLOY_ID=dep-d9urekfqj5pc738atu10
RENDER_STATUS=LIVE
RENDER_HEALTH=200
RENDER_READINESS=200
```

The API intentionally remains on `4d9ac303...`: PR #275 changed only worker operational pacing, not the Render API runtime. Do not redeploy the API merely to make its SHA equal the worker-only HML head.

Expired dedicated HML authentication no longer causes a startup outage. Expired credentials remain unusable for their protected routes.

## Provider health evidence

A provider-only probe was separated from collection credentials and database credentials before G6.

```text
PROVIDER_HEALTH_OR_USAGE_EVIDENCE=PASS
TAVILY_USAGE_SCOPE=account_plan
TAVILY_PLAN_USAGE_OBSERVED=10
TAVILY_PLAN_LIMIT_OBSERVED=1000
CNPJ_WS_HEALTH_HTTP=200
PROVIDER_PROBE_DISCOVERY_DISPATCHED=false
PROVIDER_PROBE_COLLECTION_JOB_CREATED=false
```

The one-time provider probe workflow was removed after evidence capture.

## Discovery workflow history

Historical runs before provider-identifiable telemetry:

```text
RUN_1=31614291037  # failed before provider call: HML_DATABASE_URL absent
RUN_2=31615733632  # failed before provider call: HML_DATABASE_URL absent
RUN_3=31617067686  # failed before provider call: API runtime privilege boundary
RUN_4=31651324092  # one historical dispatch; FAILED SOURCE_RATE_LIMITED
```

Historical terminal row remains untouched:

```text
REQUEST_IDENTITY=2026-08-12|16|campinas-sp|daily6-v1
STATUS=FAILED
ATTEMPT_COUNT=1
ERROR=SOURCE_RATE_LIMITED
REQUEUE=false
```

### Current G6 sequence

Run `31700024125` revalidated provider health, exact SHA, readiness and collection auth/egress. It failed in the local `psql` precheck before the POST `/collect` because the SQL client did not interpolate the variable inside the command form used. Supabase authoritatively confirmed that the fresh identity did not exist after this run. Therefore this run was a pre-dispatch script failure, not a discovery dispatch.

Run `31700292036` corrected only that deterministic SQL-client issue and performed the single fresh controlled G6 dispatch.

```text
G6_ACTUAL_DISPATCH_RUN=31700292036
REQUEST_IDENTITY=2026-08-13|09|campinas-sp|daily6-v1
STATUS=FAILED
ATTEMPT_COUNT=1
ERROR=CNPJ_WS_RATE_LIMITED
FAILED_JOB_REQUEUE=false
```

Provider accounting from that worker is complete and PII-safe:

```text
TAVILY_ATTEMPTED_CALLS=5
TAVILY_SUCCESSFUL_CALLS=5
TAVILY_RATE_LIMITED_429_CALLS=0
CNPJ_WS_ATTEMPTED_CALLS=4
CNPJ_WS_SUCCESSFUL_CALLS=3
CNPJ_WS_RATE_LIMITED_429_CALLS=1
CNPJ_WS_RETRY_AFTER_SECONDS=60
RATE_LIMIT_PROVIDER_IDENTIFIABLE=PASS
PROVIDER_CALL_ACCOUNTING=PASS
CURRENT_PROVIDER=CNPJ_WS
```

The one-time G6 push workflow was removed immediately after the terminal stop. Its removal created no replacement workflow run. No second real G6 dispatch is authorized by this state.

## CNPJ.ws pacing hardening

The public-provider contract used by this project recognizes a documented ceiling of 3 requests/minute. Hosted G6 evidence showed that the fourth request under the previous nominal 3-RPM pacing still received HTTP 429 with `Retry-After=60`. The project does not infer the provider's internal rate-limit window model from that observation.

PR #275 adds a worker-only conservative operational policy:

```text
CNPJ_WS_DOCUMENTED_PUBLIC_MAX_RPM=3
CNPJ_WS_OPERATIONAL_SAFE_RPM=2
HTTP_429_RETRY=false
```

The policy preserves any stricter configured limit. It has unit coverage and exact-head CI. It does not authorize a new provider call or a new discovery dispatch.

## Current gates

```text
NEXT_PHASE=B
BASE_SHA=3ac05d56610cd860d0560a7e26fc9554011ed95a
DISCOVERY_E2E=FAIL_CNPJ_WS_RATE_LIMITED
RATE_LIMIT_PROVIDER_IDENTIFIABLE=PASS
PROVIDER_CALL_ACCOUNTING=PASS
PROVIDER_HEALTH_OR_USAGE_EVIDENCE=PASS
ACCURACY=NOT_RUN
AUTOMATED_COMPLIANCE=NOT_RUN
QUOTAS_AND_IDEMPOTENCY=NOT_RUN
CANARY=NOT_RUN
DAILY6_SCHEDULER=DISABLED
REPLY_ROUTING=NOT_RUN
REAL_OUTREACH_BLOCKED=true
PROJECT_BLOCKED=true
FAILED_JOB_REQUEUE=false
STOP_CONDITION=CNPJ_WS_RATE_LIMITED_AFTER_SINGLE_G6
NEXT_TASK=HOLD_G6_NO_RETRY_UNTIL_NEW_EXPLICIT_AUTHORIZATION_AND_FRESH_PROVIDER_WINDOW
```

A failed G6 does not unlock later gates. `NOT_RUN` never means `PASS`. Do not start Accuracy, Automated Compliance, quota/idempotency hosted execution, canary, scheduler or reply routing while G6 remains failed.

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

No Gmail send, WhatsApp send, commercial canary, scheduler activation or reply-routing activation occurred during the recovery/G6 sequence.

## Resume instruction

An autonomous coordinator resuming work must:

1. revalidate HML/Main/Render/Supabase/GitHub state; current external state wins over this document;
2. preserve both terminal failed collection rows and their `attempt_count=1`; never requeue or edit them for recovery;
3. treat run `31700292036` as the single actual G6 dispatch in this sequence; do not create another discovery identity without new explicit authorization after the Stop Condition;
4. preserve `RATE_LIMIT_PROVIDER_IDENTIFIABLE=PASS`, `PROVIDER_CALL_ACCOUNTING=PASS` and the exact observed provider counters as evidence, not as authorization to retry;
5. keep the CNPJ.ws operational worker pace at or below the reviewed safe policy unless a new reviewed change supersedes it;
6. do not advance G7/G8/G9, canary, Daily-6, Gmail, WhatsApp or reply routing while `DISCOVERY_E2E` is failed;
7. never expose secrets, raw provider response bodies, email addresses or other PII in state/recovery logs.
