# HML migration safety controls

This runbook documents code-level safeguards only. It does not authorize a hosted migration, restore, role change, deployment, or production promotion.

## Exact migration target

`MIGRATION_ONLY_VERSION` is optional.

- When absent, `npm run db:migrate` preserves the existing local and CI behavior and evaluates all migration files in lexical order.
- When present, the value is trimmed and must exactly match one migration filename without the `.sql` suffix.
- A blank or unknown value fails before a database connection is opened.
- Every predecessor must already be recorded as `LOCAL` or `IMPORTED`; a pending predecessor blocks the run.
- Applied predecessors are parity-checked and are not executed again.
- The target migration remains wrapped in the existing database transaction together with its local registry insertion.

Example syntax for a separately approved, controlled environment:

```text
MIGRATION_ONLY_VERSION=0033_manual_message_lifecycle
```

Do not place `DATABASE_URL`, passwords, tokens, or other secrets in commands, logs, issues, pull requests, or documentation.

## Contact resolver role provisioning

`database/security/create_lead_finder_contact_resolver_runtime.sql` uses `ON_ERROR_STOP` and one explicit outer `BEGIN`/`COMMIT` transaction. The transaction includes:

- role creation or reconciliation;
- `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS` attributes;
- restricted `search_path` and session timeouts;
- revocation of table, sequence, and broad function access;
- the single allowlisted contact-resolution function grant;
- removal of inherited role memberships.

Any late failure must roll back the complete provisioning attempt.

## Runtime grants after migrations

The migration runner deliberately ends with a deny/revoke boundary. When an
existing `lead_finder_api_runtime` role is present, migrations `0042` through
`0047` revoke the restricted manual-email `EXECUTE` grants. The HML deployment
sequence therefore has two explicit, fail-closed stages:

```text
npm run db:migrate
  -> npm run db:provision:hml-runtime
  -> verify runtime allowlist and restricted-table denial
  -> start or release the API
```

`db:provision:hml-runtime` runs the generic role descriptor first and the HML
supplement second, then verifies the role attributes, the seven restricted
email function grants, and the absence of direct access to restricted tables.
It is safe to replay, but any error terminates the process; do not append
`|| true` or continue deployment after a failed stage. This repository change
does not authorize or perform a hosted migration, role change, Render deploy,
or Supabase operation.

## Hosted execution gates

Before any future hosted mutation, require a separate owner authorization and evidence for:

1. exact backup identity;
2. successful isolated restore rehearsal;
3. migration registry parity;
4. stopped consumers and active sessions reviewed;
5. expected migration target and predecessor status;
6. post-apply schema, grants, RLS, readiness, and application checks;
7. explicit stop on timeout, ambiguity, or unexpected output.

No automatic retry is permitted after a timeout or ambiguous result until logs and database state prove that the target was not applied.
