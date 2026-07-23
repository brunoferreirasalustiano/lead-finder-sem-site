import { describe, expect, it } from 'vitest';
import {
  buildMigrationRegistry,
  getMigrationSource,
  listMigrationSources,
} from './migration-registry-plan.js';

describe('migration registry source planner', () => {
  it('distinguishes local, Supabase, both and pending migrations', () => {
    const registry = buildMigrationRegistry(
      ['0018_service_role_least_privilege_reconciliation', '0019_manual_assisted_messaging.sql'],
      [
        { version: '20260722215045', name: '0019_manual_assisted_messaging' },
        { version: '20260722220522', name: '0020_manual_messaging_append_only_acl' },
      ],
    );

    expect(getMigrationSource(registry, '0018_service_role_least_privilege_reconciliation')).toBe('LOCAL');
    expect(getMigrationSource(registry, '0019_manual_assisted_messaging')).toBe('BOTH');
    expect(getMigrationSource(registry, '0020_manual_messaging_append_only_acl.sql')).toBe('SUPABASE');
    expect(getMigrationSource(registry, '0021_future')).toBe('PENDING');
    expect(
      listMigrationSources(registry, [
        '0018_service_role_least_privilege_reconciliation',
        '0019_manual_assisted_messaging',
        '0020_manual_messaging_append_only_acl',
      ]),
    ).toEqual({
      '0018_service_role_least_privilege_reconciliation': 'LOCAL',
      '0019_manual_assisted_messaging': 'BOTH',
      '0020_manual_messaging_append_only_acl': 'SUPABASE',
    });
  });

  it('rejects one logical name mapped to incompatible Supabase versions', () => {
    expect(() =>
      buildMigrationRegistry([], [
        { version: '20260722215045', name: '0019_manual_assisted_messaging' },
        { version: '20260722215046', name: '0019_manual_assisted_messaging' },
      ]),
    ).toThrow(/conflicting versions/);
  });

  it('rejects one Supabase version mapped to incompatible logical names', () => {
    expect(() =>
      buildMigrationRegistry([], [
        { version: '20260722215045', name: '0019_manual_assisted_messaging' },
        { version: '20260722215045', name: '0020_manual_messaging_append_only_acl' },
      ]),
    ).toThrow(/conflicting names/);
  });

  it('rejects blank registry values', () => {
    expect(() => buildMigrationRegistry(['  '], [])).toThrow(/empty/);
    expect(() => buildMigrationRegistry([], [{ version: '', name: '0019_manual_assisted_messaging' }])).toThrow(
      /empty version/,
    );
  });
});
