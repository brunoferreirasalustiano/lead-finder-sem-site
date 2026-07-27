type Row = Readonly<Record<string, unknown>>;

const row = (value: unknown): Row =>
  typeof value === 'object' && value !== null ? value as Row : {};
const date = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  throw new Error('CRM_MUTATION_DATE_INVALID');
};
const required = (item: Row, key: string): unknown => {
  const value = item[key];
  if (value === undefined) throw new Error(`CRM_MUTATION_REQUIRED_FIELD_MISSING:${key}`);
  return value;
};

export const safeLeadMutationResult = (value: unknown) => {
  const item = row(value);
  return {
    schemaVersion: 1,
    resourceType: 'lead' as const,
    id: required(item, 'id'),
    qualificationStatus: item['qualificationStatus'],
    isBlocked: item['isBlocked'],
    doNotContact: item['doNotContact'],
    crmStage: item['crmStage'],
    crmPriority: item['crmPriority'],
    crmNextActionAt: date(item['crmNextActionAt']),
    crmVersion: item['crmVersion'],
    crmUpdatedAt: date(item['crmUpdatedAt']),
    createdAt: date(item['createdAt']),
    updatedAt: date(item['updatedAt']),
  };
};

export const safeOpportunityMutationResult = (value: unknown) => {
  const item = row(value);
  return {
    schemaVersion: 1,
    resourceType: 'opportunity' as const,
    id: required(item, 'id'),
    leadId: required(item, 'leadId'),
    amount: item['amount'] ?? null,
    currency: required(item, 'currency'),
    expectedCloseAt: date(item['expectedCloseAt']),
    closedAt: date(item['closedAt']),
    outcome: item['outcome'] ?? null,
    version: required(item, 'version'),
    createdAt: date(item['createdAt']),
    updatedAt: date(item['updatedAt']),
  };
};

export const safeNoteMutationResult = (value: unknown) => {
  const item = row(value);
  return {
    schemaVersion: 1,
    resourceType: 'note' as const,
    id: required(item, 'id'),
    leadId: required(item, 'leadId'),
    opportunityId: item['opportunityId'] ?? null,
    createdAt: date(item['createdAt']),
  };
};

export const safeTagMutationResult = (value: unknown) => {
  const item = row(value);
  const tagId = item['tagId'] ?? item['id'];
  if (tagId === undefined) throw new Error('CRM_MUTATION_REQUIRED_FIELD_MISSING:tagId');
  const leadId = required(item, 'leadId');
  if (item['removed'] === true) {
    return {
      schemaVersion: 1,
      resourceType: 'tag' as const,
      removed: true,
      tagId,
      leadId,
    };
  }
  return {
    schemaVersion: 1,
    resourceType: 'tag' as const,
    id: tagId,
    leadId,
    createdAt: date(item['createdAt']),
  };
};

export const safeTaskMutationResult = (value: unknown) => {
  const item = row(value);
  return {
    schemaVersion: 1,
    resourceType: 'task' as const,
    id: required(item, 'id'),
    leadId: required(item, 'leadId'),
    opportunityId: item['opportunityId'] ?? null,
    status: required(item, 'status'),
    priority: required(item, 'priority'),
    dueAt: date(item['dueAt']),
    completedAt: date(item['completedAt']),
    version: required(item, 'version'),
    createdAt: date(item['createdAt']),
    updatedAt: date(item['updatedAt']),
  };
};
