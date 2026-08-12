# Lead Finder Brasil — Autonomous Agent Team

The team is logical. Agents may be separate Codex tasks/worktrees or sequential specialist passes depending on platform capacity.

## 1. Coordinator / Tech Lead

Owns state, sequencing and promotion gates.

Responsibilities:

- read `AGENTS.md`, `MASTER_PLAN.md`, `CURRENT_STATE.md` and `GATES.md` first;
- reconcile actual Git/GitHub/Supabase/Render state;
- select the next blocker;
- delegate bounded tasks;
- prevent overlapping mutations;
- review specialist evidence;
- merge only exact approved PR heads;
- persist state after every completed gate;
- continue automatically until a Human Stop Condition.

The Coordinator should avoid editing implementation code when a specialist can do the work independently.

## 2. Database / Backend Specialist

Owns:

- PostgreSQL migrations;
- RLS/ACL;
- SECURITY DEFINER boundaries;
- transactions;
- leases;
- quota/idempotency persistence;
- API/database contracts.

Must prove positive and negative authorization paths and preserve migration history.

## 3. Security Reviewer

Read-only first. Owns:

- auth/permissions;
- PII/logging;
- secret exposure;
- opt-out/DNC/NAO_CONTATAR;
- hard-bounce suppression;
- cross-lead suppression;
- SSRF/egress boundaries;
- fail-closed behavior;
- replay/idempotency abuse cases.

Does not widen privileges as a convenience fix.

Any valid P0/P1/P2 affecting the current changed behavior blocks autonomous merge.

## 4. CI / Infrastructure Specialist

Owns:

- GitHub Actions;
- exact-SHA CI;
- workflow dispatch safety;
- Render HML deployment;
- health/readiness;
- environment configuration presence-only checks;
- deploy/log evidence.

Never prints secret values.

## 5. QA / E2E Specialist

Owns:

- PostgreSQL integration;
- concurrency tests;
- rollback/restart tests;
- discovery E2E;
- provider call accounting;
- accuracy audit;
- compliance synthetic/hosted validation;
- quota and replay tests;
- canary evidence.

Cannot convert `NOT_RUN` into PASS.

## 6. Outreach Safety Specialist

Becomes active only after discovery produces real candidates.

Owns:

- business identity evidence;
- active-business evidence;
- public business email association;
- non-inferred contact verification;
- current official-site search confidence;
- suppression/duplicate/prior-contact checks;
- email copy invariants and explicit opt-out.

Does not negotiate or send WhatsApp.

## 7. Reply Router

Becomes active only after real email is operational.

Owns deterministic routing:

```text
POSITIVE_INTEREST -> NEEDS_BRUNO
COMMERCIAL_QUESTION -> NEEDS_BRUNO
QUOTE_REQUEST -> NEEDS_BRUNO
MEETING_REQUEST -> NEEDS_BRUNO
NEGATIVE -> CLOSED
OPT_OUT -> PERMANENT_SUPPRESSION
BOUNCE -> BOUNCE_SUPPRESSION
AUTO_REPLY -> RECORD_ONLY
OUT_OF_OFFICE -> RECORD_ONLY
AMBIGUOUS -> HOLD
```

Never auto-negotiates price, discount, scope, payment or delivery promises.

## Concurrency policy

Allowed:

- one mutating implementation lane plus one independent read-only security/review lane;
- two mutating lanes only when files/domains are demonstrably independent.

Forbidden:

- two concurrent migrations;
- two agents editing the same workflow;
- two agents altering the same auth/ACL surface;
- parallel real provider calls;
- parallel merges into the same base without coordinator reconciliation.

## Worktree policy

When multiple Codex agents run simultaneously:

- one worktree/branch per mutating specialist;
- base each worktree on a known exact SHA;
- never share uncommitted changes;
- Coordinator reconciles before merge;
- abandoned worktrees must not be treated as project state.

## Model allocation

Use the cheapest model that safely handles the task, but security/architecture may be escalated.

Recommended operational mapping:

```text
Coordinator: Luna/Extra High when complex cross-system state is active
Database/Security: Luna/Extra High for critical migrations and authorization
CI/Infra: Terra or equivalent unless incident is complex
QA: Terra for deterministic tests; Luna for concurrency/security ambiguity
Documentation/state updates: Lua/Terra
```

Model capacity failure is recoverable: persist/reload state and resume with an available capable model.