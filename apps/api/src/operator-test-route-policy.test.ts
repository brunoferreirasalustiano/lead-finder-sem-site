import { describe, expect, it } from 'vitest';
import { routePolicies } from './auth.js';

const operatorPolicies = routePolicies.filter((item) => item.path.includes('operator-test'));

describe('operator test route authorization policy', () => {
  it('classifies every route with its own dedicated permission', () => {
    expect(operatorPolicies).toEqual([
      {
        method: 'POST',
        path: '/operator-tests/whatsapp/preparations',
        permission: 'operator-test:prepare',
      },
      {
        method: 'POST',
        path: '/operator-test-preparations/:id/open',
        permission: 'operator-test:open',
      },
      {
        method: 'POST',
        path: '/operator-test-preparations/:id/confirm',
        permission: 'operator-test:confirm',
      },
      {
        method: 'POST',
        path: '/operator-test-preparations/:id/response',
        permission: 'operator-test:response',
      },
    ]);
    expect(operatorPolicies.every((item) => !item.permission.startsWith('pilot:'))).toBe(true);
    expect(operatorPolicies.every((item) => !item.permission.startsWith('manual-messaging:'))).toBe(true);
  });
});
