import { describe, expect, it } from 'vitest';
import { leads } from './schema.js';
import { safeLeadSelection } from './safe-projections.js';

describe('safe lead SQL projection', () => {
  it('contains only the explicitly approved HTTP contract fields', () => {
    expect(Object.keys(safeLeadSelection)).toEqual([
      'id',
      'name',
      'category',
      'city',
      'state',
      'website',
      'score',
      'status',
      'qualificationStatus',
      'isBlocked',
      'doNotContact',
      'isClosed',
      'crmStage',
      'crmPriority',
      'crmOwner',
      'crmNextActionAt',
      'crmVersion',
      'createdAt',
      'updatedAt',
    ]);
    expect(Object.keys(safeLeadSelection)).not.toEqual(expect.arrayContaining([
      'phone',
      'whatsapp',
      'email',
      'address',
      'latitude',
      'longitude',
      'normalizedName',
      'normalizedAddress',
    ]));
    expect(safeLeadSelection.crmOwner).not.toBe(leads.crmOwner);
  });
});
