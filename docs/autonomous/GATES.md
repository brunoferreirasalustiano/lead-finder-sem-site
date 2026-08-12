# Lead Finder Brasil — Autonomous Gates

This document defines non-negotiable promotion gates for autonomous work.

## Gate states

Allowed states:

- `PASS`
- `PASS_WITH_NOTES`
- `FAIL`
- `BLOCKED`
- `NOT_RUN`
- `NOT_APPLICABLE`

`NOT_RUN` is never equivalent to `PASS`.

## G0 — State reconciliation

Before any mutation:

```text
LOCAL_SHA=
HML_SHA=
MAIN_SHA=
PR_HEAD_SHA=
RENDER_SHA=
CI_CHECKED_SHA=
SUPABASE_MIGRATION_STATE=
```

Current state wins over stale documentation.

PASS requires no unexplained SHA/environment mismatch.

## G1 — Code change quality

Applicable to every runtime/security/database change.

Required when applicable:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm audit --audit-level=high
git diff --check
```

Database changes additionally require real PostgreSQL integration and migration preflight.

## G2 — PR safety

PASS requires:

- isolated scope;
- known exact head SHA;
- mergeable;
- required CI PASS;
- no valid unresolved P0/P1/P2 thread affecting the changed behavior;
- no unrelated diff;
- security/privacy invariants preserved.

Autonomous merge must be protected by exact expected head SHA or equivalent.

## G3 — Exact merged SHA

After merge:

- identify merge SHA;
- run or verify CI on that exact SHA;
- all required gates PASS.

No HML promotion from PR-head-only evidence.

## G4 — Hosted database

For migrations/security supplements:

- canonical migration mechanism only;
- no fabricated migration registry history;
- hosted ACL checks;
- RLS checks;
- positive path;
- negative unauthorized path;
- concurrency/replay/rollback when applicable;
- no synthetic leftovers.

Secrets and PII must not appear in evidence.

## G5 — Render HML

PASS requires:

```text
RENDER_SHA=APPROVED_MERGED_SHA
DEPLOY_STATUS=LIVE
HEALTH=200
READINESS=200
```

No crash loop, fatal config error or unexplained migration mismatch.

## G6 — Discovery E2E

Exactly one controlled dispatch.

Required:

- approved SHA;
- secrets presence;
- readiness;
- collection auth/egress preflight;
- enqueue;
- one bounded worker;
- provider call accounting;
- no email provider calls;
- no WhatsApp.

Ambiguous dispatch result => inspect runs before any retry. Never duplicate blindly.

## G7 — Accuracy

A candidate can proceed only when all applicable facts are current and high confidence.

Reject/defer on:

- UNKNOWN;
- MEDIUM confidence;
- inferred email;
- ambiguous identity;
- provider unavailable;
- missing site evidence;
- uncertain business activity.

## G8 — Automated compliance

No send occurs in this gate.

PASS requires all commercial eligibility/suppression/duplicate/current-evidence conditions in `MASTER_PLAN.md`.

## G9 — Quota/idempotency

Synthetic only.

PASS requires:

```text
3 same batch => accepted <= 2
7 same date => accepted <= 6
same identity => 1 logical reservation
same recipient fingerprint => 1 logical reservation
concurrency => hard limits never exceeded
synthetic cleanup => 0 leftovers
```

## G10 — HUMAN_GATE: one real canary

This gate is special. The project owner has authorized the completion path toward real sends, but the coordinator must still prove G0-G9 immediately before creating exactly one real provider call.

Requirements:

- exactly one qualified recipient;
- first-contact email only;
- no WhatsApp;
- no follow-up;
- explicit opt-out;
- compliance PASS;
- quotas PASS;
- Gmail healthy;
- no pending/ambiguous attempt for recipient;
- provider call count begins at zero for the canary transaction.

On timeout/ambiguous provider/persistence state: STOP, no retry.

## G11 — Canary replay/no duplicate

PASS requires:

```text
initial providerCalls=1
attempt/event/ledger persisted
replay providerCalls=0
duplicate sends=0
```

Scheduler remains disabled until PASS.

## G12 — Daily-6 scheduler

Only after G11 PASS.

Hard limits:

```text
09:00 <=2
13:00 <=2
16:00 <=2
hard max <=6/day
America/Sao_Paulo
no catch-up
no backfill
DB ledger source of truth
```

Failure to find safe candidates means fewer sends, never relaxed qualification.

## G13 — Reply routing

PASS requires conservative classification and permanent handling for opt-out/hard bounce.

Positive/commercial/quote/meeting replies route to Bruno. Negotiation is never automated.

## Human stop conditions

Stop only when one of these applies:

- missing secret/credential/OAuth the agent cannot provision;
- billing/payment/plan upgrade;
- irreversible production/data-loss risk;
- ambiguous provider state that could duplicate a real action;
- unresolved security conflict;
- commercial negotiation/price/scope/contract decision;
- positive reply requiring Bruno;
- action explicitly marked HUMAN_GATE.

## Non-stop conditions

These should trigger recovery/resume, not abandonment:

- model at capacity;
- stream disconnected;
- context compacted;
- flaky development provider;
- deterministic CI failure with diagnosable cause;
- review finding that can be fixed safely;
- transient network failure before a mutation is known to have happened.

For ambiguous mutations, inspect authoritative state before deciding whether retry is safe.