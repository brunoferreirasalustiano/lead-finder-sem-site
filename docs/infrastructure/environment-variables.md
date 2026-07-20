# Environment variables

| Variable | A | B | Surface | Visibility | Required/default |
|---|---:|---:|---|---|---|
| `DEPLOYMENT_PROFILE` | yes | yes | server/CI | public | `oracle-vps` |
| `DATABASE_URL` | yes | yes | server | secret | required |
| `DIRECT_DATABASE_URL` | optional | migrations | CI/operator | secret | no default |
| `DATABASE_SSL_MODE` | optional | yes | server | public | `disable`; B=`require` |
| `DATABASE_POOL_MAX` | yes | yes | server | public | `10`; B starts at `3` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | no | optional | frontend | public/minimal | no default |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF` | no | operator | server/CI | secret | no default; never frontend |
| `INTERNAL_CRON_SECRET` | no | yes | API/Edge | secret | no default |
| `CRON_AUTH_AUDIENCE` | no | yes | API/Edge | public | `lead-finder-batch` |
| `PUBLIC_API_URL` | yes | yes | frontend | public | environment-specific |
| `CORS_ALLOWED_ORIGINS` | yes | yes | API | public | explicit allowlist |
| `DAILY_LEAD_LIMIT` | yes | yes | server | public | `60`, max 60 |
| `LEAD_BATCH_SIZE` | yes | yes | server | public | `5`, max 10 |
| `PROCESSING_TIME_BUDGET_MS` | yes | yes | server | public | `45000`, max 50000 |
| `WORKER_POLL_INTERVAL_MS` | yes | no | worker | public | `60000` |
| `PROCESSOR_ROLE` | yes | yes | executor | public | `standby` except active processor |
| `DRY_RUN`, `SHADOW_MODE_ENABLED` | yes | yes | server | public | `true` |
| `REAL_SEND_ENABLED`, `REAL_PROVIDERS_ENABLED`, `COLLECTION_EGRESS_ENABLED` | yes | yes | server | public | `false` |
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | yes | yes | server | public | platform-specific |

The API retains existing bearer variables. Secret values have no fallback. `supabase-render` refuses unsafe switches at startup.
