import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../database/migrations/0057_collection_enqueue_security_definer.sql', import.meta.url),
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
});
