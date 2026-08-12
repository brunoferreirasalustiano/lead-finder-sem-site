# Lead Finder Brasil — Current Autonomous State

Last reconciled: 2026-08-12.

This file is the resume point after model capacity errors, disconnects, context compaction or agent handoff. Current external state always wins over this file; update this file after every completed gate.

## Repository

```text
PROJECT=Lead Finder Brasil
REPO=brunoferreirasalustiano/lead-finder-sem-site
HML_BRANCH=hml/render-supabase-plan-b
HML_SHA=8f6841fd840e3d03efe340bed8dc22e5024050d4
MAIN_SHA=8181c3e007ef8dee7117f81fc7f07ca16a05d002
LAST_MERGED_PR=259
PR259_HEAD=0d0d799c0902682643b452e556edc1f9e79e1305
PR259_MERGE=8f6841fd840e3d03efe340bed8dc22e5024050d4
EXACT_SHA_CI_RUN=31642639040
EXACT_SHA_CI=PASS
```

## Supabase HML

```text
PROJECT_ID=ondvzdvlwntrnieodifi
REGION=sa-east-1
POSTGRES=17.6
MIGRATION_0057=APPLIED_NATIVE_REGISTRY
PUBLIC_SCHEMA_MIGRATION_HISTORY=HISTORICALLY_DIVERGENT_DO_NOT_FABRICATE
```

Hosted ACL facts for `lead_finder_api_runtime`:

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

## Render HML

```text
SERVICE=lead-finder-api-hml
SERVICE_ID=srv-d9fbpp6rnols73bko9f0
WORKSPACE=Bruno's workspace
WORKSPACE_ID=tea-d72o44oule4c73cut1l0
RENDER_SHA=8f6841fd840e3d03efe340bed8dc22e5024050d4
RENDER_DEPLOY_ID=dep-d9uefplbedkc73a49psg
RENDER_STATUS=LIVE
HEALTH=200
READINESS=200
```

Discovery-only hosted profile remains the intended state until canary authorization gates are satisfied.

## Discovery workflow history

Historical controlled discovery runs:

```text
RUN_1=31614291037  # failed: HML_DATABASE_URL absent
RUN_2=31615733632  # failed: HML_DATABASE_URL absent
RUN_3=31617067686  # failed: API runtime direct daily6_batches privilege boundary
```

No provider discovery calls occurred in those failed runs. No email/WhatsApp was sent.

`HML_DATABASE_URL` is now present in the correct GitHub Environment `hml-discovery`.

## Fixed blocker

PR #259 fixed the direct-table least-privilege incompatibility by adding:

```text
lead_finder_internal.enqueue_collection_job(text,jsonb)
```

The API runtime receives EXECUTE only; direct access to `daily6_batches` and `collection_jobs` remains denied.

## Current blocker — P2 hardening required

Two valid P2 findings remain in migration/function 0057 and MUST be fixed before the next discovery dispatch.

### P2-A NULL fail-open

Nullable JSON comparisons use `<>` for authorization fields. Missing/null values can produce SQL NULL and avoid the fail-closed branch.

Required fix: incremental migration 0058 using null-safe validation (`IS DISTINCT FROM` or equivalent) and explicit object/field presence checks before any INSERT.

### P2-B normalization drift

SQL city/state normalization does not exactly reproduce canonical TypeScript `collectionCityId(city,state)` semantics for accented/separator state names.

Required fix: 0058 must make database validation semantically identical to the canonical shared implementation and test accented/separator cases.

## Immediate next gate

```text
NEXT_PHASE=A
NEXT_TASK=P2_HARDENING_0058
BASE_SHA=8f6841fd840e3d03efe340bed8dc22e5024050d4
DISCOVERY_E2E=BLOCKED_UNTIL_0058_PASS
REAL_OUTREACH_BLOCKED=true
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
```

## Resume instruction

An autonomous coordinator resuming work must:

1. verify HML/Main/Render/Supabase current state instead of trusting this file blindly;
2. update this file if facts changed;
3. solve P2-A and P2-B first;
4. do not dispatch discovery until Phase A exit criteria are PASS;
5. then continue through MASTER_PLAN without asking merely for permission to continue.