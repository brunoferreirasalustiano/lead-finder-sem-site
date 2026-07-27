# Safe API PII contracts

This change minimizes personally identifying data at the HTTP boundary. It does
not change database schema, stored history, campaign snapshots, worker behavior,
or PostgreSQL roles.

## Changed contracts

- `GET /leads` and `GET /leads/:id` now expose an explicit business-operational
  projection. Raw phone, WhatsApp, email, address, coordinates, and normalized
  identity fields are excluded by the SQL query.
- `GET /leads/export.csv` uses the same safe projection and retains CSV formula,
  quoting, comma, line-break, authorization, and 100-row protections.
- `GET` and `PUT /leads/:id/contacts` return contact metadata only. Contact
  normalization and deduplication still occur internally.
- `GET /leads/:id/history` returns immutable audit metadata without
  `previousValue`, `newValue`, reasons, notes, or nested persisted JSON.
- `GET /leads/:id/crm` uses the safe lead projection and minimizes free-text CRM
  aggregates. CRM transitions and idempotency are unchanged.
- Campaign eligibility, recipient, attempt, and simulation responses expose
  operational IDs, states, channel, versions, and timestamps without raw
  contacts, persisted snapshots, or rendered message content.

Instagram and Facebook are not part of the new lead DTO because this change
does not yet establish that every stored value represents a public business
channel.

## Compatibility and sequencing

These are intentional response-contract removals. Versioned repository
consumers were checked and updated; no versioned frontend exists in this
revision. External consumers must stop depending on removed fields before
promotion.

No migration or backfill is included. Historical qualification JSON, CRM
idempotency results, campaign recipient/attempt snapshots, outbox payloads, and
dead letters remain unchanged at rest and require PR B.

Do not deploy this contract change before the planned persistence, readiness,
narrow contact-resolution, and PostgreSQL role work in PRs B through E has been
reviewed and the homologation sequence has been approved.
