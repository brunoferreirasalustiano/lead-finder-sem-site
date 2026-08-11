import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../database/migrations/0050_hml_suppression_probe.sql', import.meta.url),
  'utf8',
);
const runtimeGrant = readFileSync(
  new URL('../../../database/security/create_lead_finder_api_runtime_hml.sql', import.meta.url),
  'utf8',
);

describe('HML suppression probe migration', () => {
  it('uses the canonical resolver behind a transactional, synthetic fixture', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('resolve_narrow_contact');
    expect(migration).toContain('@example.invalid');
    expect(migration).toContain('HML_SUPPRESSION_PROBE_ROLLBACK');
    expect(migration).toContain('fixture_rows_remaining');
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
    expect(migration).not.toContain('gmail');
  });

  it('is executable only by the least-privilege HML API runtime', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.run_hml_suppression_probe');
    expect(migration).toContain('FROM PUBLIC');
    expect(migration).toContain('FROM service_role');
    expect(runtimeGrant).toContain('public.run_hml_suppression_probe(text, boolean)');
    expect(runtimeGrant).toContain('TO lead_finder_api_runtime');
  });
});
