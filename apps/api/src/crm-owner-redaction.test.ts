import { describe, expect, it } from 'vitest';
import { safeLeadDto } from './api-contracts.js';

describe('CRM owner privacy redaction', () => {
  it.each([
    'Operador Nome Completo',
    'operator-owner@example.test',
  ])('never exposes a free-form CRM owner canary: %s', (crmOwner) => {
    const result = safeLeadDto({
      id: '20dfeb9d-30f0-4d5a-8762-3dbb4ed506aa',
      name: 'Empresa Sintética',
      crmOwner,
    });

    expect(result.crmOwner).toBeNull();
    expect(JSON.stringify(result)).not.toContain(crmOwner);
  });
});
