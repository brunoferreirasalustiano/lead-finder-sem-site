# Prospecting city persistence

This increment adds an operational, aggregate-only record of prospecting runs. It does not collect leads, contact businesses, call a provider, or schedule work.

## Storage model

Migration `0027_prospecting_city_metrics` creates four protected tables:

- `prospecting_runs`: immutable counters for one run, keyed by a safe execution fingerprint.
- `prospecting_run_rejection_reasons`: one row for every allow-listed reason and run.
- `prospecting_city_state`: the current city, consecutive low-yield count, and optimistic version.
- `prospecting_city_transitions`: immutable, one-step transition history.

All values are aggregate counters or fixed labels. No lead, contact, e-mail, phone, message, source URL, or provider payload is stored. RLS is enabled; public, anonymous, and authenticated roles receive no access. Runtime access is limited to these tables and the operations required by the persistence service.

## City state and saturation

The fixed order is Campinas, Valinhos, Paulínia, Hortolândia, Sumaré, Indaiatuba. A state update can stay in place or move exactly one position forward. The database trigger and the pure TypeScript transition evaluator enforce the same rule. Indaiatuba is terminal.

Structural reasons are `PREVIOUS_CONTACT`, `OFFICIAL_SITE`, `BUSINESS_EMAIL_NOT_FOUND`, `BUSINESS_EMAIL_UNCERTAIN`, `DUPLICATE`, `INACTIVE`, and `AMBIGUOUS`. Safety reasons such as opt-out, block, complaint, and audit failure do not count as market saturation.

The deterministic index is:

```text
structuralRate = structuralRejected / found       (0 when found is zero)
lowYield = approved <= 2
saturationIndex = clamp(structuralRate * 70 + (lowYield ? 30 : 0), 0, 100)
```

Advancement requires two consecutive low-yield runs, structural predominance, an index of at least 70, and no audit or ambiguous result. A replayed execution fingerprint returns the original run without mutating history.

## Internal snapshot

`GET /internal/prospecting/city-metrics` requires `prospecting:metrics:read`. It returns `503 PROSPECTING_METRICS_DISABLED` unless `PROSPECTING_METRICS_ENABLED=true`. The default is false. When enabled, the response contains only city counters, rates, status, saturation, and top rejection reason labels.

## Validation and rollback

Unit tests cover the pure saturation and transition rules, persistence validation, and the disabled/authenticated API contract. PostgreSQL integration tests cover idempotent replay, concurrent claims, append-only history, monotonic transition, migration presence, and snapshot output. The integration script requires `DATABASE_URL`; without PostgreSQL it is reported as not run rather than treated as passing.

The migration is forward-only. To roll back application exposure, set `PROSPECTING_METRICS_ENABLED=false` and deploy the prior application SHA. Do not delete or mutate run or transition history. Any schema rollback must be a separately reviewed corrective migration; no hosted rollback is performed by this change.
