import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import { checkExpectedMigration } from './index.js';

const version = '0026_narrow_contact_resolution_hardening';
const repositoryFile = (path: string) => new URL(`../../../${path}`, import.meta.url);

describe('migration readiness', () => {
  it('accepts the latest required narrow-contact hardening migration from the local registry', async () => {
    const execute = vi.fn().mockResolvedValue([{ version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('accepts the latest required hardening migration from the Supabase registry without writing local history', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ name: version }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('fails closed when neither registry contains the latest required hardening migration', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: false }]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('fails closed when the Supabase registry exists without the latest required hardening migration', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
  });

  it('does not accept migration 0025 as application-ready', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as Database;
    await expect(checkExpectedMigration(db)).rejects.toThrow('EXPECTED_MIGRATION_MISSING');
    const queries = execute.mock.calls.map(([query]) => String(query));
    expect(queries.join('\n')).not.toContain('0025_narrow_contact_resolution');
  });
});

describe('hosted migration operational contracts', () => {
  it('provisions the contact resolver role in one fail-fast transaction', async () => {
    const sql = await readFile(
      repositoryFile('database/security/create_lead_finder_contact_resolver_runtime.sql'),
      'utf8',
    );
    const lines = sql.split(/\r?\n/).map((line) => line.trim());
    const beginIndexes = lines.flatMap((line, index) => line === 'BEGIN;' ? [index] : []);
    const commitIndexes = lines.flatMap((line, index) => line === 'COMMIT;' ? [index] : []);
    const mutationIndexes = lines.flatMap((line, index) =>
      /^(?:DO \$\$|END \$\$;|CREATE ROLE |ALTER ROLE |REVOKE |GRANT |DROP ROLE )/.test(line)
        ? [index]
        : [],
    );

    expect(lines.find((line) => line.length > 0)).toBe('\\set ON_ERROR_STOP on');
    expect(beginIndexes).toHaveLength(1);
    expect(commitIndexes).toHaveLength(1);
    expect(mutationIndexes.length).toBeGreaterThan(0);
    expect(beginIndexes[0]).toBeLessThan(mutationIndexes[0]!);
    expect(commitIndexes[0]).toBeGreaterThan(mutationIndexes.at(-1)!);
  });

  it('keeps the contact resolver role rollback available and fail-fast', async () => {
    const rollback = await readFile(
      repositoryFile('database/security/rollback_lead_finder_contact_resolver_runtime.sql'),
      'utf8',
    );

    expect(rollback).toContain('\\set ON_ERROR_STOP on');
    expect(rollback).toMatch(/\bDROP ROLE lead_finder_contact_resolver_runtime;/);
  });

  it('documents forward-only recovery gates and essential stop conditions', async () => {
    const runbook = await readFile(
      repositoryFile('docs/runbooks/supabase-render-deployment.md'),
      'utf8',
    );

    for (const requiredContract of [
      'ROLLBACK_CLASSIFICATION=FORWARD_ONLY_WITH_SNAPSHOT_RESTORE',
      'PROVIDERS_DISABLED',
      'CONSUMERS_STOPPED',
      'SNAPSHOT_VERIFIED',
      'SNAPSHOT_ID_RECORDED',
      'DISPOSABLE_RESTORE_PROVED',
      'OPERATIONAL_OWNER_IDENTIFIED',
      'MIGRATION_HEAD_RECORDED',
      'POSTGRESQL_17_VALIDATED',
      'STOP_BACKUP_UNVERIFIABLE',
      'STOP_RESTORE_UNTESTED',
      'STOP_MIGRATION_REGISTRY_DIVERGED',
      'STOP_PGCRYPTO_NOT_RELOCATABLE',
      'STOP_0026_HISTORICAL_TUPLE_MISMATCH',
      'STOP_RUNTIME_ROLE_UNRECONCILED',
      'STOP_ACTIVE_SESSIONS_OR_CONSUMERS',
      'STOP_HEAD_MISMATCH',
    ]) {
      expect(runbook).toContain(requiredContract);
    }
    expect(runbook).toContain('they are not migration rollbacks');
    expect(runbook).toContain('No hosted migration or restore is authorized');
  });
});
