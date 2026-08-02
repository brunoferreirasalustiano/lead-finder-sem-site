# HML temporary smoke authentication

The HML-only smoke principal is disabled by default and is fail-closed unless all
of these variables are present in the HML service:

- `DEPLOYMENT_ENVIRONMENT=homologation`;
- `HML_SMOKE_AUTH_ENABLED=true`;
- a SHA-256 hex digest in `HML_SMOKE_AUTH_TOKEN_HASH`;
- a future ISO-8601 timestamp in `HML_SMOKE_AUTH_EXPIRES_AT`;
- a principal id beginning with `hml-smoke-` in `HML_SMOKE_AUTH_PRINCIPAL_ID`.

The plaintext token is generated and held only by the operator. It must never be
committed, logged, placed in a migration, or stored in the database. The fixed
permission set is limited to preparing, opening, cancelling, and recording a
non-send result; `SENT_CONFIRMED` is explicitly denied. It cannot send, collect,
export, or access production data.

After the smoke, set `HML_SMOKE_AUTH_ENABLED=false`, clear the hash, expiry, and
principal variables, redeploy HML, and verify that the old token receives `401`.
Natural expiry is not a substitute for explicit revocation.
