import { describe, expect, it } from 'vitest';
import { buildMigrationRunPlan, type MigrationRegistrySource } from './migration-run-plan.js';

const versions = [
  '0021_operator_channel_test',
  '0022_persisted_pii_audit_json',
  '0023_reference_only_campaign_payloads',
];

const sourceMap = (entries: Record<string, MigrationRegistrySource>) =>
  (version: string): MigrationRegistrySource => entries[version] ?? 'PENDING';

describe('targeted migration run plan', () => {
  it('preserves the full local/CI behavior when no target is set', () => {
    expect(buildMigrationRunPlan(versions, sourceMap({}))).toEqual(versions);
  });

  it('allows exactly the target when every predecessor is recorded', () => {
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

  it('fails closed when a predecessor has not passed its gate', () => {
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
