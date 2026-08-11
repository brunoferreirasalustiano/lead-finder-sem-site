# Discovery and enrichment contract

The collection worker treats Overpass/OSM as discovery input only. A missing
`website` tag is persisted as `website_status=UNKNOWN`; it is never proof that a
business has no official site.

Enrichment is a separate, injectable `BusinessContactEnrichmentProvider`. It is
disabled by default and is bounded by an explicit HML-only egress flag, provider
endpoint, timeout, retry count, per-run candidate cap, and minimum request
interval. No provider is contacted when `ENRICHMENT_EGRESS_ENABLED=false`.

The provider response is validated before persistence and carries evidence for
identity, activity, website, and public business email. `lead_evidence` maps the
contract fields as follows:

| Contract field | Persisted field |
| --- | --- |
| `source_type` | `source` |
| `source_locator` | `reference` |
| `observed_at` | `observed_at` |
| `evidence_type` | `evidence_type` |
| `confidence` | `confidence` |
| `verification_status` | `verification_status` |
| normalized value | SHA-256 `fingerprint` (raw email is not duplicated in evidence) |

Only a public HTTP(S) source, `businessAssociation=PASS`, and
`inferred=false` can verify an email contact. Human approval remains a separate
gate; enrichment never writes `contact_email_business_evidence` approval.

`NO_OFFICIAL_SITE_CONFIRMED` is assigned only when the enrichment source says
no official site was found with confidence at least 0.85. Campaign, CRM, pilot,
and outreach-eligibility queries require that status, plus the existing
suppression, opt-out, DNC, and verified-contact checks.

Repeated enrichment is idempotent through the existing `(lead_id, fingerprint)`
evidence key and `(lead_id, type, normalized_value)` contact key. The worker
processes candidates serially and caps each job's enrichment count.

The HML Render service remains fail-closed until an approved enrichment provider
and a separately deployed worker are configured. This change does not enable
collection or enrichment egress and does not send email or WhatsApp.
