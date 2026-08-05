import { describe, expect, it } from 'vitest';
import type { MigrationSource } from './migration-registry-plan.js';
import {
  assertKnownMigrationOnlyVersion,
  buildMigrationRunPlan,
  parseMigrationOnlyVersion,
} from './migration-run-plan.js';

const versions = [
  '0021_operator_channel_test',
  '0022_persisted_pii_audit_json',
  '0023_reference_only_campaign_payloads',
];

const sourceMap = (entries: Record<string, MigrationSource>) =>
  (version: string): MigrationSource => entries[version] ?? 'PENDING';

describe('targeted migration environment parsing', () => {
  it('preserves full local and CI behavior only when the variable is absent', () => {
    expect(parseMigrationOnlyVersion(undefined)).toBeUndefined();
  });

  it.each(['', ' ', '\t\n'])('rejects a blank targeted version: %j', (raw) => {
    expect(() => parseMigrationOnlyVersion(raw)).toThrow('MIGRATION_ONLY_VERSION_BLANK');
  });

  it('trims a nonblank exact target', () => {
    expect(parseMigrationOnlyVersion(' 0021_operator_channel_test '))
      .toBe('0021_operator_channel_test');
  });
});

describe('targeted migration preflight', () => {
  it('accepts an absent or exact known target', () => {
    expect(() => assertKnownMigrationOnlyVersion(versions, undefined)).not.toThrow();
    expect(() => assertKnownMigrationOnlyVersion(
      versions,
      '0022_persisted_pii_audit_json',
    )).not.toThrow();
  });

  it('rejects an unknown target before database access', () => {
    expect(() => assertKnownMigrationOnlyVersion(
      versions,
      '0022_wrong_name',
    )).toThrow('MIGRATION_ONLY_VERSION_UNKNOWN:0022_wrong_name');
  });
});

describe('targeted migration run plan', () => {
  it('preserves the full local and CI behavior when no target is set', () => {
    expect(buildMigrationRunPlan(versions, sourceMap({}))).toEqual(versions);
  });

  it('selects the target after every predecessor is recorded locally', () => {
    const plan = buildMigrationRunPlan(
      versions,
      sourceMap({
        '0021_operator_channel_test': 'LOCAL',
        '0022_persisted_pii_audit_json': 'PENDING',
      }),
      '0022_persisted_pii_audit_json',
    );
    expect(plan).toEqual([
      '0021_operator_channel_test',
      '0022_persisted_pii_audit_json',
    ]);
  });

  it.each(['SUPABASE', 'BOTH'] as const)(
    'accepts a predecessor recorded with the real %s registry source',
    (source) => {
      expect(buildMigrationRunPlan(
        versions,
        sourceMap({ '0021_operator_channel_test': source }),
        '0022_persisted_pii_audit_json',
      )).toEqual([
        '0021_operator_channel_test',
        '0022_persisted_pii_audit_json',
      ]);
    },
  );

  it('fails closed when a predecessor remains pending', () => {
    expect(() => buildMigrationRunPlan(
      versions,
      sourceMap({}),
      '0023_reference_only_campaign_payloads',
    )).toThrow('MIGRATION_ONLY_PREDECESSOR_PENDING:0021_operator_channel_test');
  });

  it('also rejects an unknown exact migration identifier', () => {
    expect(() => buildMigrationRunPlan(
      versions,
      sourceMap({}),
      '0022_wrong_name',
    )).toThrow('MIGRATION_ONLY_VERSION_UNKNOWN:0022_wrong_name');
  });
});
