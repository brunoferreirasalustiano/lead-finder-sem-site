import { describe, expect, it } from 'vitest';
import { hmlMetricsAuthPermissions } from './hml-metrics-auth.js';

const forbiddenPermissionPrefixes = [
  'campaigns:',
  'collection:',
  'crm:',
  'leads:',
  'contacts:',
  'pilot:',
  'manual-messaging:',
  'operator-test:',
  'operator-email-test:',
  'operations:',
] as const;

describe('HML metrics principal permission contract', () => {
  it('contains exactly one read-only metrics permission', () => {
    expect(hmlMetricsAuthPermissions).toEqual(['prospecting:metrics:read']);
    expect(Object.isFrozen(hmlMetricsAuthPermissions)).toBe(false);
    expect(hmlMetricsAuthPermissions).toHaveLength(1);
  });

  it('cannot reach operational or delivery permission domains', () => {
    for (const permission of hmlMetricsAuthPermissions) {
      expect(forbiddenPermissionPrefixes.some((prefix) => permission.startsWith(prefix))).toBe(false);
      expect(permission).not.toMatch(/write|send|execute|prepare|confirm|open|cancel/i);
    }
  });
});
