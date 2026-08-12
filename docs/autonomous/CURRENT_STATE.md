# Lead Finder Brasil — Current Autonomous State

Last reconciled: 2026-08-12.

This file is the resume point after model capacity errors, disconnects, context compaction or agent handoff. Current external state always wins over this file; update this file after every completed gate.

## Repository

```text
PROJECT=Lead Finder Brasil
REPO=brunoferreirasalustiano/lead-finder-sem-site
HML_BRANCH=hml/render-supabase-plan-b
HML_SHA=5792eecb307fa2287f2e1df1c95da9751f265741
MAIN_SHA=8181c3e007ef8dee7117f81fc7f07ca16a05d002
LAST_MERGED_PR=260
PR260_HEAD=ac67c5b1804944d2269dd642f67546eed9f77cf0
PR260_MERGE=5792eecb307fa2287f2e1df1c95da9751f265741
EXACT_SHA_CI_RUN=31645554495
EXACT_SHA_CI=PASS
```

PR #260 was merged while one valid P1 review thread remained unresolved. Autonomous mode MUST NOT repeat that promotion mistake.

## Supabase HML

```text
PROJECT_ID=ondvzdvlwntrnieodifi
REGION=sa-east-1
POSTGRES=17.6
MIGRATION_0057=APPLIED_NATIVE_REGISTRY
MIGRATION_0058=APPLIED_NATIVE_REGISTRY
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

## Render HML

```text
SERVICE=lead-finder-api-hml
SERVICE_ID=srv-d9fbpp6rnols73bko9f0
WORKSPACE=Bruno's workspace
WORKSPACE_ID=tea-d72o44oule4c73cut1l0
RENDER_SHA=5792eecb307fa2287f2e1df1c95da9751f265741
RENDER_DEPLOY_ID=dep-d9uf2mu417fc73d7sfig
RENDER_STATUS=LIVE
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

`HML_DATABASE_URL` is present in the GitHub Environment `hml-discovery`.

## Fixed blockers

PR #259 fixed the direct-table least-privilege incompatibility by adding the narrow `lead_finder_internal.enqueue_collection_job(text,jsonb)` function.

PR #260 / migration 0058 closed the original nullable-JSON fail-open and most normalization drift by adding explicit null-safe authorization checks and an incremental function replacement.

## Current blocker — valid unresolved P1 after PR #260

The merged migration 0058 still has a valid normalization defect for an uppercase accented city such as `Águas de Lindóia`.

Current SQL effectively translates accented characters before lowercasing, but its translation map contains only lowercase accented characters. Canonical TypeScript `collectionCityId()` lowercases/normalizes the city first. The two paths can therefore disagree and produce `COLLECTION_IDENTITY_CITY_MISMATCH` for otherwise valid input.

Required remediation:

- DO NOT edit applied migrations 0057 or 0058;
- create incremental migration 0059;
- make SQL city normalization exactly match canonical `collectionCityId()` for uppercase/lowercase Portuguese accents and separators;
- add canonical TypeScript-generated test cases, including `Águas de Lindóia / SP`;
- preserve all null-safe authorization checks from 0058;
- preserve least-privilege ACLs;
- validate replay/concurrency/rollback and invalid input;
- resolve the outstanding P1 thread with evidence after hosted validation.

## Immediate next gate

```text
NEXT_PHASE=A
NEXT_TASK=P1_NORMALIZATION_HARDENING_0059
BASE_SHA=5792eecb307fa2287f2e1df1c95da9751f265741
DISCOVERY_E2E=BLOCKED_UNTIL_0059_PASS
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

1. revalidate HML/Main/Render/Supabase/GitHub state;
2. update this file if facts changed;
3. fix the current P1 via 0059 first;
4. do not dispatch discovery until Phase A has no valid unresolved P0/P1/P2 affecting enqueue;
5. then continue through MASTER_PLAN without asking merely for permission to continue.