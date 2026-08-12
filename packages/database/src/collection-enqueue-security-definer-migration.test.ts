import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../database/migrations/0057_collection_enqueue_security_definer.sql', import.meta.url),
  'utf8',
);
const hardeningMigration = readFileSync(
  new URL('../../../database/migrations/0058_collection_enqueue_fail_closed_hardening.sql', import.meta.url),
  'utf8',
);
const normalizationParityMigration = readFileSync(
  new URL('../../../database/migrations/0059_collection_enqueue_city_normalization_parity.sql', import.meta.url),
  'utf8',
);
const hmlSupplement = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);

describe('collection enqueue security-definer boundary', () => {
  it('keeps the function narrow, atomic, and fail-closed', () => {
    expect(migration).toContain('lead_finder_internal.enqueue_collection_job(text, jsonb)');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain('ON CONFLICT (batch_id) DO NOTHING');
    expect(migration).toContain('ON CONFLICT (request_identity) WHERE request_identity IS NOT NULL DO NOTHING');
    expect(migration).toContain('COLLECTION_IDENTITY_INVALID');
    expect(migration).toContain('COLLECTION_IDENTITY_CITY_MISMATCH');
    expect(migration).toContain('COLLECTION_BATCH_CONTRACT_MISMATCH');
    expect(migration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_collection_job');
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE\s+public\.(?:daily6_batches|collection_jobs)/i);
  });

  it('grants only execution to the API runtime supplement', () => {
    expect(hmlSupplement).toContain('lead_finder_internal.enqueue_collection_job(text, jsonb)');
    expect(hmlSupplement).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE\s+public\.(?:daily6_batches|collection_jobs)/i);
  });

  it('keeps the follow-up hardening null-safe and out of the original migration', () => {
    expect(hardeningMigration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.enqueue_collection_job');
    expect(hardeningMigration).toContain('SECURITY DEFINER');
    expect(hardeningMigration).toContain('SET search_path = pg_catalog, public');
    expect(hardeningMigration).toContain("jsonb_typeof(p_payload->'collectionEgress') IS DISTINCT FROM 'object'");
    expect(hardeningMigration).toContain("jsonb_typeof(p_payload->'collectionEgress'->'enabled') IS DISTINCT FROM 'boolean'");
    expect(hardeningMigration).toContain("(p_payload->'collectionEgress'->'enabled') IS DISTINCT FROM 'true'::jsonb");
    expect(hardeningMigration).toContain("jsonb_typeof(p_payload->'collectionEgress'->'configurationVersion') IS DISTINCT FROM 'number'");
    expect(hardeningMigration).toContain("(p_payload->'collectionEgress'->'configurationVersion') IS DISTINCT FROM '1'::jsonb");
    expect(hardeningMigration).toContain("(p_payload->>'collectionRequestIdentity') IS DISTINCT FROM p_request_identity");
    expect(hardeningMigration).toContain("jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object'");
    expect(hardeningMigration).toContain('collectionCityId');
    expect(hardeningMigration).toContain('COLLECTION_IDENTITY_CITY_MISMATCH');
    expect(hardeningMigration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_collection_job');
    expect(hardeningMigration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE\s+public\.(?:daily6_batches|collection_jobs)/i);
    expect(migration).not.toContain('IS DISTINCT FROM');
  });

  it('normalizes precomposed and decomposed accents without widening privileges', () => {
    expect(normalizationParityMigration).toContain('CREATE OR REPLACE FUNCTION lead_finder_internal.enqueue_collection_job');
    expect(normalizationParityMigration).toContain('SECURITY DEFINER');
    expect(normalizationParityMigration).toContain('SET search_path = pg_catalog, public');
    expect(normalizationParityMigration).toContain('normalize(lower(payload_city), NFD)');
    expect(normalizationParityMigration).toContain("'[' || chr(768) || '-' || chr(879) || ']'");
    expect(normalizationParityMigration).toContain("jsonb_typeof(p_payload->'collectionEgress') IS DISTINCT FROM 'object'");
    expect(normalizationParityMigration).toContain("(p_payload->'collectionEgress'->'enabled') IS DISTINCT FROM 'true'::jsonb");
    expect(normalizationParityMigration).toContain("(p_payload->'collectionEgress'->'configurationVersion') IS DISTINCT FROM '1'::jsonb");
    expect(normalizationParityMigration).toContain("(p_payload->>'collectionRequestIdentity') IS DISTINCT FROM p_request_identity");
    expect(normalizationParityMigration).toContain("jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object'");
    expect(normalizationParityMigration).toContain('ON CONFLICT (batch_id) DO NOTHING');
    expect(normalizationParityMigration).toContain('ON CONFLICT (request_identity) WHERE request_identity IS NOT NULL DO NOTHING');
    expect(normalizationParityMigration).toContain('REVOKE ALL ON FUNCTION lead_finder_internal.enqueue_collection_job');
    expect(normalizationParityMigration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE\s+public\.(?:daily6_batches|collection_jobs)/i);
  });
});
