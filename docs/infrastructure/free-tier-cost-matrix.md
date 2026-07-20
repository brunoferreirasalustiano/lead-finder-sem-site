# Free-tier cost matrix

Limits change. Verify the linked official pages immediately before provisioning; this repository does not enable billing or register a card.

| Service | Purpose | Free-limit risk / behavior | Alert / alternative / upgrade point |
|---|---|---|---|
| Oracle Always Free | Plan A compute | Capacity may be unavailable; tenancy rules apply | capacity alert; use Plan B; upgrade only by approval |
| Supabase Free | PostgreSQL/Cron/Edge | Quotas, inactivity and egress may constrain pilot | dashboard alerts; VPS PostgreSQL fallback; upgrade before sustained load |
| Render Free | API | Spins down and cold-starts; quotas may suspend service | health/error alert; Oracle API fallback; upgrade for availability |
| GitHub Actions/Pages | CI/static frontend | minute/storage/bandwidth policies vary | usage alerts; local/other static host |
| DNS | routing | provider-specific | TTL/change monitoring; alternate provider |
| Email/WhatsApp | disabled | no free allowance assumed | remain blocked; commercial approval required |
| Backups/logs | operator-managed | retention/storage exhaustion | encrypted rotation and restore drills; approved object storage |

Official references: Oracle Free Tier, Supabase Pricing, Render Free, and GitHub Billing documentation. Record the checked date and exact quota in the deployment ticket rather than freezing mutable numbers here.
