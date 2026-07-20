# Failover and rollback

```mermaid
sequenceDiagram
  participant O as Operator
  participant Old as Old primary
  participant DB as PostgreSQL authority
  participant New as New primary
  O->>Old: set standby and stop cron/worker
  O->>DB: wait for leadership and claim leases to expire
  O->>New: set primary and start one batch
  New->>DB: acquire generation N+1
  O->>O: redirect API/frontend/DNS
```

Preconditions: current backup validated by restore; migrations identical; old cron paused; queue and dead-letter counts recorded; new `/ready` healthy. Abort if both sources report primary, migrations differ, or lease expiry cannot be proven.

Rollback uses the same sequence in reverse. Never delete leadership or outbox rows. Wait for expiration rather than forcing tokens. Restore database only into a reviewed target, compare integrity, then redirect. Real sends/providers/collection remain blocked throughout.
