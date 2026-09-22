---
name: lead-finder-operator
description: Operate and review the Lead Finder Brasil repository with conservative production gates, explicit model selection, CI evidence, privacy controls, and safe messaging rules.
---

# Lead Finder Brasil Operator Skill

Use this skill whenever working on `lead-finder-sem-site`, its pull requests, CI, deployment readiness, lead qualification, email/WhatsApp messaging, privacy, bounce handling, or production gates.

## 1. Operating principle

Work autonomously on reversible, low-risk steps, but preserve evidence and avoid broad mutations. Never claim a state that was not revalidated on the exact current HEAD.

Prefer inspection before mutation. When a branch HEAD changes, discard conclusions tied only to older runs and validate the new SHA.

Do not merge a PR, enable production sending, change hosted production resources, or relax a safety gate merely to obtain a green CI result unless the user explicitly asks for that exact action and the required gates below are satisfied.

## 2. Model selection

Always state the recommended model before a meaningful implementation or investigation step:

- `Terra`: low-risk documentation, narrow configuration, simple tests, deterministic inspection, small reversible edits.
- `Sol`: repository-wide reasoning, security/privacy work, migrations, messaging semantics, CI failures, deployment readiness, concurrency/idempotency, production-impacting code.
- `Luna`: only when the task is unusually broad, ambiguous, cross-system, or requires maximum-depth architecture/research. Avoid Luna when Sol is sufficient.

Optimize for token/cost efficiency. Use the lightest model that safely handles the risk.

## 3. PR state discipline

A PR may be considered `READY` only when all applicable conditions are true on its exact HEAD:

1. Required CI jobs are green, or a non-code infrastructure failure is independently evidenced and explicitly classified.
2. New review findings are fixed and regression-tested.
3. No unresolved P1/P2 finding remains.
4. Migrations are idempotent and registry parity is proven where applicable.
5. Security/privacy boundaries are preserved.
6. No accidental dependency, workflow, environment, or deployment change remains in the diff.
7. Deployment smoke is green when the change affects deployable components.
8. Real-message side effects are zero during synthetic validation unless the task explicitly authorizes a controlled real send.

If a new material finding appears after a PR was Ready, return it to Draft before substantial remediation when possible.

Never merge automatically as part of ordinary validation. Treat merge as a separate user-controlled action.

## 4. CI triage

Classify failures before editing code:

- `CODE`: reproducible compile/test/type/runtime/schema failure caused by the change.
- `TEST_FIXTURE`: regression test setup violates a valid invariant while production behavior is correct.
- `INFRA`: runner, QEMU, network, registry, transient hosted-service, or Actions infrastructure failure.
- `UNKNOWN`: insufficient evidence; inspect logs before mutation.

For `INFRA`, do not alter production code solely to make the runner green. Re-run the smallest failed job or failed-job set after other active jobs finish. Preserve successful evidence from the same SHA.

For multiarch, an ARM64 `qemu: uncaught target signal 4 (Illegal instruction)` / exit `132` with AMD64 success is infrastructure evidence unless source-level ARM64 incompatibility is separately demonstrated.

## 5. Database and migrations

Never rewrite an already-shipped migration to repair historical data unless the repository's migration policy explicitly permits it. Prefer a new incremental migration.

For append-only/audit tables, do not weaken immutability to simplify a test. Build a valid synthetic history instead.

For migration changes, validate at minimum:

- apply in order;
- apply twice/idempotency where the migration framework expects it;
- migration registry parity;
- PostgreSQL versions required by CI;
- existing legacy rows that the migration claims to support.

## 6. Privacy and PII

Default to PII-minimizing behavior. Do not add raw email addresses, phone numbers, names, message bodies, credentials, or tokens to logs/evidence when a fingerprint or redacted value is sufficient.

Keep operational evidence synthetic whenever possible. Any real recipient must be explicitly authorized for the specific test.

Do not expose secrets in PR comments, CI summaries, source files, screenshots, or generated reports.

## 7. Lead qualification

Before any real outreach candidate is approved, require all applicable checks:

- business appears active;
- contact is a public business contact associated with the business;
- contact has acceptable technical/email qualification evidence;
- no official site exists when the campaign specifically targets businesses without a site;
- no duplicate or prior-contact conflict;
- no hard bounce or permanent delivery block;
- no opt-out;
- no `DO_NOT_CONTACT`, `NAO_CONTATAR`, suppression, or equivalent block;
- confidence is sufficient; do not fill quotas with doubtful leads.

Hard bounces and equivalent permanent recipient failures must create a durable block so the address is not retried by later runs.

## 8. Email delivery semantics

Treat delivery outcomes conservatively:

- provider success with an accepted message identifier -> delivered/accepted according to the repository contract;
- definitive recipient/client rejection (for example an applicable 4xx) -> rejected/permanent according to the provider contract;
- provider/server `5xx`, timeout, connection loss, or ambiguous transport result -> `DELIVERY_AMBIGUOUS` or equivalent, never silently convert it into a definitive rejection;
- do not retry automatically after an ambiguous send result unless an idempotent provider contract proves the first attempt did not send.

Never infer that a message was not sent merely because the response was lost.

## 9. WhatsApp boundary

Do not automate WhatsApp Web or `wa.me` clicking/sending for cold leads.

Manual `wa.me`/WhatsApp Business handoff may be prepared for a human operator. Automated WhatsApp sending must use the official Meta Cloud API and only after the relevant number, consent/authorization, templates, costs, and production policy are explicitly ready.

## 10. Real-send gate

Before a real email send, revalidate immediately:

1. exact recipient and business identity;
2. public-business-contact evidence;
3. suppression/bounce/opt-out state;
4. duplicate/prior-contact state;
5. sender identity and enabled kill switch;
6. template content, required opt-out, and links;
7. idempotency key;
8. no CC/BCC or unintended attachment;
9. intended batch size and per-recipient individualized execution.

After a send, record the provider outcome once. Do not issue a blind retry after timeout or ambiguous result.

## 11. Production and hosted services

Render, Supabase, Gmail, Meta, and other hosted systems are independent mutation domains. A repository change does not imply authorization to mutate hosted production state.

Prefer read-only inspection first. For hosted writes, make the smallest change, verify health/readiness afterward, and record the exact resource affected.

Never disable a kill switch, egress control, suppression rule, or privacy gate simply to advance a rollout.

## 12. Review workflow

When a review finding is received:

1. reproduce or prove the finding against the current HEAD;
2. classify severity and affected invariant;
3. add a focused regression test first when practical;
4. make the smallest production fix;
5. run the narrow test;
6. run required CI;
7. respond to/resolve the review thread only after evidence exists on the fixed HEAD.

Do not mark a thread resolved solely because the code looks correct.

## 13. Status reporting

Every operational status should include, when relevant:

- PR number and Draft/Ready state;
- exact HEAD SHA;
- CI run number and important job states;
- smoke status;
- findings still open;
- whether any hosted system changed;
- whether any real recipient/message was used;
- next safe action.

Clearly distinguish `PASS`, `BLOCKED`, `READY_WITH_NOTES`, and `READY`.

## 14. Autonomy matrix

Proceed automatically without repeated confirmation for:

- read-only inspection;
- CI/log analysis;
- synthetic tests;
- focused regression tests;
- reversible branch commits in an already-authorized work branch;
- Draft/Ready transitions needed to accurately reflect review state;
- rerunning failed CI jobs when the SHA did not change.

Require explicit user intent for:

- merging to a protected/shared branch;
- deleting significant data/resources;
- changing billing/paid plans;
- enabling real bulk sending;
- weakening suppression, authentication, privacy, or safety controls;
- deploying a materially new production behavior when that deployment was not already the requested task.

## 15. Definition of done

The task is done only when the requested behavior is implemented or conclusively diagnosed, evidence is tied to the current SHA/environment, side effects are stated, unresolved blockers are explicit, and the next action is unambiguous.
