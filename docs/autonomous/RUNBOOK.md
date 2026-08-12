# Lead Finder Brasil — Autonomous Completion Runbook

## Coordinator loop

Repeat until a Human Stop Condition or project completion:

1. Read `AGENTS.md`.
2. Read `docs/autonomous/CURRENT_STATE.md`.
3. Reconcile actual Git/GitHub/CI/Supabase/Render state.
4. Read `MASTER_PLAN.md` and identify the earliest incomplete phase.
5. Read `GATES.md` for the promotion requirements.
6. Decide whether work is read-only, one-lane mutation or safe parallel work.
7. Delegate bounded specialist tasks.
8. Collect evidence; never trust a specialist's PASS without identifiers.
9. Fix deterministic findings with the smallest safe change.
10. PR -> CI -> review -> exact-head merge -> exact-merge-SHA CI.
11. Apply HML migration/deploy only after exact-SHA CI PASS.
12. Validate hosted state.
13. Update `CURRENT_STATE.md` with SHAs, run IDs, deploy IDs and next gate.
14. Continue automatically.

## Required evidence identifiers

When applicable, persist:

```text
BASE_SHA
BRANCH
PR_NUMBER
PR_HEAD_SHA
MERGE_SHA
CI_RUN_ID
CI_CHECKED_SHA
MIGRATION_NAME
SUPABASE_PROJECT_ID
RENDER_DEPLOY_ID
RENDER_SHA
WORKFLOW_RUN_ID
PROVIDER_CALL_COUNTS
```

## Mutation protocol

Before a mutation, state internally:

```text
CURRENT_STATE
TARGET_STATE
ROOT_CAUSE
PLANNED_MUTATION
INVARIANTS
RECOVERY
VALIDATION
```

Do not mutate to discover whether a theory is correct when read-only evidence can prove it.

## Ambiguity protocol

If a mutation API times out or disconnects:

1. do not retry immediately;
2. inspect authoritative state;
3. if the mutation happened, continue from its resulting state;
4. if it provably did not happen, retry once if safe;
5. if state remains ambiguous and duplicate effects matter, STOP.

This is mandatory for workflow dispatches, migrations, provider calls and real sends.

## PR protocol

Autonomous completion PRs should:

- have one coherent objective;
- include why/safety/validation in body;
- link the central project issue when applicable;
- avoid unrelated cleanup;
- run all required CI;
- receive a security/review pass on critical database/auth changes.

Merge only with exact-head protection and no valid unresolved P0/P1/P2 for changed behavior.

## Database protocol

- Never rewrite an already applied migration.
- Use the next incremental migration.
- Prefer narrow SECURITY DEFINER functions over broad runtime table grants when that matches the architecture.
- Preserve RLS and NOBYPASSRLS boundaries.
- Run negative ACL tests.
- Verify concurrency and rollback for quota/idempotency paths.
- Keep canonical migration registries honest; never fabricate history.

## Discovery protocol

One controlled run at a time.

Before dispatch:

```text
approved SHA known
Render LIVE and ready
required secrets present at runtime or safely preflighted
real send disabled
WhatsApp disabled
scheduler disabled
```

After dispatch, count every external provider call including failed calls.

## Candidate accuracy protocol

For each candidate, independently verify:

- identity;
- active status;
- public business email ownership/association;
- email not inferred;
- current site/no-site evidence.

Do not use missing OSM website as proof of no official site.

## Real canary protocol

Exactly one real email.

Before provider call:

```text
compliance=PASS
quota=PASS
Gmail health=PASS
prior contact=false
pending/ambiguous send=false
suppression=false
hard bounce=false
opt-out=false
DNC=false
NAO_CONTATAR=false
```

After call:

- persist attempt/event/ledger;
- capture non-PII provider fingerprint/message evidence;
- replay once through the idempotent path without causing a provider call;
- prove duplicate count zero.

Any ambiguous provider/persistence result => no retry.

## Scheduler protocol

Only after canary replay PASS.

Use durable DB ledger as source of truth. Never use a process-local counter for commercial hard limits.

No catch-up: if a slot is missed, it is missed.

## Reply protocol

Automated system handles only deterministic administrative outcomes. Commercial interest hands off to Bruno.

No automatic follow-up initially.

## Recovery from Codex interruptions

For:

```text
Selected model is at capacity
stream disconnected
context compacted
session ended
```

The replacement/resumed coordinator must not reconstruct state from memory. It must read `CURRENT_STATE.md`, then revalidate external state and continue from the earliest incomplete gate.

## Completion report

When the whole build reaches operational Daily-6, persist a final report containing:

```text
FINAL_HML_SHA
FINAL_RENDER_SHA
MIGRATION_LAST
DISCOVERY_E2E
ACCURACY
AUTOMATED_COMPLIANCE
QUOTAS
CANARY
CANARY_REPLAY
SCHEDULER
REPLY_ROUTING
REAL_EMAILS_SENT
WHATSAPP_SENT
KNOWN_RISKS
```

The autonomous construction phase then ends; monitoring/operation becomes a separate controlled mode.