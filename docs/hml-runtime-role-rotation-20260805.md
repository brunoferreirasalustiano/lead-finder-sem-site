# HML runtime role rotation — 2026-08-05

## Result

`LEAST_PRIVILEGE_RUNTIME_ROTATION_ACTIVE_HEALTHY`

## Hosted evidence

- Supabase project: `lead-finder-brasil-homologacao` (`ondvzdvlwntrnieodifi`);
- runtime role: `lead_finder_api_runtime`;
- role is login-enabled, `NOINHERIT`, non-superuser, without `CREATEDB`, `CREATEROLE`, `REPLICATION` or `BYPASSRLS`;
- no parent role is inherited by the runtime;
- PostgreSQL administrator membership exists only so Supavisor can manage the custom user;
- Render service: `lead-finder-api-hml`;
- deployed commit: `05a2696cf03ada5bc4d71cd0a94cd9dfd6bb3dec`;
- successful deploy: `dep-d9ppmq5ai2ds73boru1g`;
- session pooler endpoint family: `aws-1-sa-east-1.pooler.supabase.com`;
- repeated `/health/ready`: HTTP 200;
- effective PostgreSQL session user: `lead_finder_api_runtime`;
- no application errors or HTTP 5xx observed after the successful rotation.

## Allowlist verified

- migration registries: read-only;
- `OPERATOR_TEST` preparations/events: read-only;
- e-mail and WhatsApp HML writes: approved `SECURITY DEFINER` functions only;
- prospecting runs and rejection reasons: `SELECT, INSERT`;
- prospecting city transitions: `SELECT` only;
- prospecting city state: `SELECT, INSERT` plus column-level update for `consecutive_low_yield_runs`, `version` and `updated_at`;
- city transition writes remain available only through `advance_prospecting_city_state`;
- no broad `campaign_outbox` read;
- no schema or database `CREATE` privilege.

## Negative tests

The runtime was denied:

- DDL;
- migration registry writes;
- direct e-mail/WhatsApp audit-table reads;
- outbox payload reads;
- direct city transition inserts;
- direct `current_city` updates;
- grant escalation.

## Operational state

- prospecting runs: 0;
- rejection reasons: 0;
- city state rows: 0;
- city transitions: 0;
- collection not enabled;
- providers not enabled;
- messages sent: 0.

## Rollout note

An initial rollout using the wrong regional pooler family (`aws-0`) failed its isolated healthcheck and did not replace the previous live instance. The corrected `aws-1` rollout became live and healthy. No credential values are recorded in this document.
