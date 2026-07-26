# Operator channel test core

The OPERATOR_TEST core stores only fixed template identity, timestamps, and
SHA-256/HMAC fingerprints. It never persists a phone number, message body,
WhatsApp URL, recipient value, principal value, idempotency key, or generic JSON
payload. PostgreSQL integration tests attempt those raw values through both table
inserts and the SQL write functions, then inspect every persisted row to prove
they are absent.

Application authorization is the boundary for `operator-test:prepare`,
`operator-test:open`, `operator-test:confirm`, and `operator-test:response`.
PostgreSQL independently enforces scalar data shape, the preparation/principal
relationship, append-only history, and the event state machine. Database write
access is exposed only through allowlisted-parameter functions; it does not
evaluate application permissions.

## HTTP API surface

The API routes are separate from pilots, leads, campaigns, manual commercial
messaging, outbox processing and providers:

- `POST /operator-tests/whatsapp/preparations`;
- `POST /operator-test-preparations/:id/open`;
- `POST /operator-test-preparations/:id/confirm`;
- `POST /operator-test-preparations/:id/response`.

Every route requires its matching `operator-test:*` permission and an
`Idempotency-Key` containing only 16–128 ASCII letters, digits, `_` or `-`.
`pilot:*` and `manual-messaging:*` permissions do not authorize these routes.
The API does not call Meta, WhatsApp, SMTP, OpenAI, a webhook or any messaging
provider. Preparation responses contain only technical state, the fixed template
identity, timestamps and replay information. They never return the phone,
recipient fingerprint, message body or `wa.me` URL. The localhost console must
reconstruct the approved fixed message and canonical link from its own private,
untracked operator configuration, then use the API only to persist preparation
and human-confirmed events.

Configuration is fail-closed:

- `OPERATOR_TEST_ENABLED=false` by default;
- `OPERATOR_TEST_KILL_SWITCH_ENABLED=true` by default;
- `OPERATOR_TEST_WHATSAPP_E164` and `OPERATOR_TEST_FINGERPRINT_KEY` are required
  only when the feature is explicitly enabled;
- partial private configuration is rejected at startup;
- the phone and fingerprint key must exist only in an untracked environment or
  hosted secret manager.

Adding the API surface does not authorize applying migration `0021`, changing
Render variables, deploying the branch or performing a real test.

## Privileged runtime limitation

The current homologation runtime uses a privileged PostgreSQL connection. A
privileged database owner can bypass table grants and can alter database objects;
therefore this core must not claim complete isolation against privileged SQL. No
database URL, role, password, or hosted environment configuration is changed by
this runbook. Moving the API to a dedicated least-privilege runtime role is a
separate architecture and deployment task.
