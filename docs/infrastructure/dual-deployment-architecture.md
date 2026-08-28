# Dual deployment architecture

Both profiles use the same TypeScript domain, PostgreSQL migrations, transactional outbox and bounded batch processor. Supabase is a PostgreSQL/cron adapter, never a domain dependency.

```mermaid
flowchart TD
  D[Domain and application services] --> P[Persistence and execution ports]
  P --> PG[(PostgreSQL)]
  P --> B[processLeadBatch]
  B --> W[Oracle continuous worker]
  B --> R[Render bounded endpoint]
  C[Supabase Cron] --> E[Authenticated Edge Function]
  E --> G[GitHub pinned Daily-6 workflow]
  G --> R
```

`processor_leadership` is the single database authority. A primary renews a lease; a standby cannot claim work. Expired leadership can be taken over with an incremented generation. Outbox claim tokens/generations prevent stale acknowledgements. `deployment_daily_lead_allocations` uniquely assigns an outbox cycle to a UTC day, while a database check makes 60 an absolute ceiling.

```mermaid
sequenceDiagram
  participant X as Executor
  participant L as Leadership
  participant O as Outbox
  participant Q as UTC quota
  X->>L: acquire or renew lease
  X->>O: FOR UPDATE SKIP LOCKED claim
  X->>Q: idempotent allocation
  X->>O: simulated dry-run completion
```
