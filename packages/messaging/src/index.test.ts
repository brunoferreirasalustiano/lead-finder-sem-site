import { describe, expect, it } from 'vitest';
import { approvedTemplates, DeterministicFakeMessagingProvider } from './index.js';
describe('fake messaging provider', () => {
  it('prepares deterministically without claiming delivery', () => {
    const p = new DeterministicFakeMessagingProvider();
    const a = p.prepare(approvedTemplates.emailV1, {
      EMPRESA: 'Empresa',
      FONTE: 'site empresarial',
    });
    expect(
      p.prepare(approvedTemplates.emailV1, { EMPRESA: 'Empresa', FONTE: 'site empresarial' }),
    ).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/sent|delivered/i);
  });
});
