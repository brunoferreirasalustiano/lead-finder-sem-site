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

## Privileged runtime limitation

The current homologation runtime uses a privileged PostgreSQL connection. A
privileged database owner can bypass table grants and can alter database objects;
therefore this core must not claim complete isolation against privileged SQL. No
database URL, role, password, or hosted environment configuration is changed by
this runbook. Moving the API to a dedicated least-privilege runtime role is a
separate architecture and deployment task.
