import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../../../database/migrations/0052_collection_job_leases.sql', import.meta.url), 'utf8');

describe('collection job lease migration', () => {
  it('adds owner-bound expiry and bounded attempt metadata without destructive DDL', () => {
    expect(migration).toContain('lease_token uuid');
    expect(migration).toContain('lease_expires_at timestamptz');
    expect(migration).toContain('attempt_count integer');
    expect(migration).toContain('collection_jobs_lease_recovery_idx');
    expect(migration).toContain('attempt_count integer');
    expect(migration.toUpperCase()).not.toContain('DROP TABLE');
    expect(migration.toUpperCase()).not.toContain('DROP COLUMN');
  });
});
