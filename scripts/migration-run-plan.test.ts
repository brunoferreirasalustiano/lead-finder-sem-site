import { describe, expect, it } from 'vitest';
import {
  buildMigrationRunPlan,
  parseMigrationOnlyVersion,
  type MigrationRegistrySource,
} from './migration-run-plan.js';

const versions = [
  '0021_operator_channel_test',
  '0022_persisted_pii_audit_json',
  '0023_reference_only_campaign_payloads',
];

const sourceMap = (entries: Record<string, MigrationRegistrySource>) =>
  (version: string): MigrationRegistrySource => entries[version] ?? 'PENDING';

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

describe('targeted migration run plan', () => {
  it('preserves the full local and CI behavior when no target is set', () => {
    expect(buildMigrationRunPlan(versions, sourceMap({}))).toEqual(versions);
  });

  it('selects the target after every predecessor is recorded', () => {
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

  it('accepts imported predecessors', () => {
    expect(buildMigrationRunPlan(
      versions,
      sourceMap({ '0021_operator_channel_test': 'IMPORTED' }),
      '0022_persisted_pii_audit_json',
    )).toEqual([
      '0021_operator_channel_test',
      '0022_persisted_pii_audit_json',
    ]);
  });

  it('fails closed when a predecessor remains pending', () => {
    expect(() => buildMigrationRunPlan(
      versions,
      sourceMap({}),
      '0023_reference_only_campaign_payloads',
    )).toThrow('MIGRATION_ONLY_PREDECESSOR_PENDING:0021_operator_channel_test');
  });

  it('rejects an unknown exact migration identifier before execution', () => {
    expect(() => buildMigrationRunPlan(
      versions,
      sourceMap({}),
      '0022_wrong_name',
    )).toThrow('MIGRATION_ONLY_VERSION_UNKNOWN:0022_wrong_name');
  });
});
