# Campaign dead-letter hardening

This hardening phase is intentionally split into small, independently verifiable changes.

## PR 1 — database failure-code allowlist

- Replace the length-only `campaign_dead_letters.error_code` constraint with a closed allowlist.
- Keep `UNCLASSIFIED` only as a legacy compatibility sentinel for rows created before typed failure codes.
- Preserve migration idempotency.

## Follow-up work

1. Persist an immutable `maxAttempts` snapshot per dead-letter cycle.
2. Add bounded batch finalization for expired final leases.
3. Add operational metrics for creation, recovery, reconciliation and identity conflicts.
4. Add an authenticated administrative CLI with inspect, dry-run and recover commands.
5. Define retention/minimization policy for duplicated dead-letter payloads.

No provider integration, real delivery, external network call or credential handling is included in this phase.
