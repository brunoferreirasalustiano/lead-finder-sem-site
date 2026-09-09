# Discovery worker ACL repair

Migration 0071 grants only UPDATE(city,state) on leads and EXECUTE on the
existing collection failure reconciler to the discovery role. Provisioning
reapplies the same grants. No delivery table privilege is added.

The owner-only recovery function refuses active/incomplete leases, recent
updates, non-pending batches and send evidence. It terminalizes both records
atomically and never requeues. Batch lock contention raises 55P03 with no
changes; an operator must re-audit state before another attempt. It is not
called by a scheduler or this migration. Existing failed identities must not
be reused. Applied migrations remain unchanged.

Local PostgreSQL validation (synthetic database only):

    npx tsx scripts/daily6-discovery-acl-recovery.integration.ts

The test rejects non-loopback databases, reproduces missing privileges,
applies 0071 twice, exercises role permissions, denies delivery/recovery
access to discovery, tests active leases, ambiguity, lock contention,
atomic terminalization and replay. Run it after normal migrations.

Hosted rollout requires review, exact release CI, reviewed migration,
runtime privilege validation and the control-plane capability preflight.
This patch does not enable scheduling or execute owner recovery.
