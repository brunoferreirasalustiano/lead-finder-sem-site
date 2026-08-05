# Security invariants

The HML metrics principal must preserve all of the following properties:

- disabled by default;
- homologation only;
- one fixed permission: `prospecting:metrics:read`;
- no write, collection, campaign, CRM, pilot, messaging, operator, e-mail, WhatsApp, provider, or operational permission;
- SHA-256 token hash only; no plaintext token in configuration files or logs;
- future expiry no longer than one hour;
- token and principal identity isolated from API, smoke, and operator credentials;
- expired or malformed configuration blocks API startup;
- valid authentication does not bypass `PROSPECTING_METRICS_ENABLED=false`;
- a disabled metrics route does not query PostgreSQL;
- attempts against routes outside the single permission return HTTP 403;
- no database migration or hosted privilege is required for this principal.
