# Oracle VPS deployment

1. Provision an ARM64-capable host and install Docker using the existing setup script; do not expose PostgreSQL.
2. Create external secrets and set `DEPLOYMENT_PROFILE=oracle-vps`, dry-run/shadow true, all real/provider/egress switches false, and `PROCESSOR_ROLE=standby`.
   When using an external database, allow outbound traffic only to its approved PostgreSQL host/port in the Oracle security list or host firewall.
3. Validate `docker compose -f deploy/oracle/docker-compose.oracle.yml config` (add `--profile local-database` only for local PostgreSQL).
4. Run `migrate`, start API, verify `/health` then `/ready`, start worker as standby.
5. Transfer leadership using the failover runbook, then set only the chosen worker primary.
6. Validate logs contain aggregate identifiers only, restart API/worker, and confirm queue state is preserved.

Rollback: return worker to standby, wait for leases, restore the prior image/config, run readiness and only then reacquire leadership. Database rollback requires a tested backup and explicit operator approval.
