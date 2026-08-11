import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = await readFile(new URL('../../../database/migrations/0053_collection_request_idempotency.sql', import.meta.url), 'utf8');

describe('collection request idempotency migration', () => {
  it('adds a nullable compatibility column and a unique non-null identity index', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS request_identity text');
    expect(migration).toContain('collection_jobs_request_identity_uidx');
    expect(migration).toContain('WHERE request_identity IS NOT NULL');
    expect(migration).toContain("daily6-v1");
  });
});
