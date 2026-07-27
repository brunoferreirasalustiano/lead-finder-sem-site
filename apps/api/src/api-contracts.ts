type Row = Readonly<Record<string, unknown>>;

const row = (value: unknown): Row =>
  typeof value === 'object' && value !== null ? value as Row : {};

export const forbiddenPiiResponseKeys = new Set([
  'phone',
  'whatsapp',
  'email',
  'address',
  'latitude',
  'longitude',
  'originalValue',
  'normalizedValue',
  'original_value',
  'normalized_value',
  'recipientSnapshot',
  'payloadSnapshot',
  'recipient_snapshot',
  'payload_snapshot',
]);

export const safeLeadDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    name: item['name'],
    category: item['category'],
    city: item['city'],
    state: item['state'],
    website: item['website'],
    score: item['score'],
    status: item['status'],
    qualificationStatus: item['qualificationStatus'],
    isBlocked: item['isBlocked'],
    doNotContact: item['doNotContact'],
    isClosed: item['isClosed'],
    crmStage: item['crmStage'],
    crmPriority: item['crmPriority'],
    crmOwner: item['crmOwner'],
    crmNextActionAt: item['crmNextActionAt'],
    crmVersion: item['crmVersion'],
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
  };
};

export const safeContactDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    leadId: item['leadId'],
    type: item['type'],
    source: item['source'],
    confidence: item['confidence'],
    verifiedAt: item['verifiedAt'],
    isValid: item['isValid'],
    possibleWhatsapp: item['possibleWhatsapp'],
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
  };
};

export const safeHistoryDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    leadId: item['leadId'],
    eventType: item['eventType'],
    actor: item['actor'],
    source: item['source'],
    createdAt: item['createdAt'],
  };
};

const safeOpportunityDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    leadId: item['leadId'],
    status: item['status'],
    outcome: item['outcome'],
    amount: item['amount'],
    expectedCloseAt: item['expectedCloseAt'],
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
  };
};

const safeNoteDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    leadId: item['leadId'],
    opportunityId: item['opportunityId'],
    createdAt: item['createdAt'],
  };
};

const safeTagDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    leadId: item['leadId'],
    createdAt: item['createdAt'],
  };
};

const safeTaskDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    leadId: item['leadId'],
    opportunityId: item['opportunityId'],
    status: item['status'],
    priority: item['priority'],
    dueAt: item['dueAt'],
    completedAt: item['completedAt'],
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
  };
};

export const safeCrmDto = (value: unknown) => {
  const item = row(value);
  const items = (key: string): unknown[] => {
    const value = item[key];
    return Array.isArray(value) ? value as unknown[] : [];
  };
  return {
    lead: safeLeadDto(item['lead']),
    opportunities: items('opportunities').map(safeOpportunityDto),
    notes: items('notes').map(safeNoteDto),
    tags: items('tags').map(safeTagDto),
    tasks: items('tasks').map(safeTaskDto),
  };
};

export const safeEligibleCampaignLeadDto = (value: unknown) => {
  const item = row(value);
  return {
    lead: safeLeadDto(item['lead']),
    contact: safeContactDto(item['contact']),
  };
};

export const safeCampaignRecipientDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    campaignId: item['campaignId'],
    campaignVersionId: item['campaignVersionId'],
    leadId: item['leadId'],
    channel: item['channel'],
    state: item['state'],
    version: item['version'],
    availableAt: item['availableAt'],
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
  };
};

export const safeCampaignAttemptDto = (value: unknown) => {
  const item = row(value);
  return {
    id: item['id'],
    recipientId: item['recipientId'],
    state: item['state'],
    version: item['version'],
    availableAt: item['availableAt'],
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
  };
};

export const safeCampaignSimulationDto = (value: unknown) => {
  const item = row(value);
  const rawItems = Array.isArray(item['items']) ? item['items'] : [];
  return {
    mode: 'SIMULATION' as const,
    dispatched: false as const,
    items: rawItems.map((value) => {
      const simulationItem = row(value);
      const simulation = row(simulationItem['simulation']);
      return {
        recipient: safeCampaignRecipientDto(simulationItem['recipient']),
        attempt: safeCampaignAttemptDto(simulationItem['attempt']),
        simulation: {
          mode: 'SIMULATION' as const,
          channel: simulation['channel'],
          dispatched: false as const,
        },
      };
    }),
    pagination: item['pagination'],
  };
};

export function findForbiddenPiiResponseKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenPiiResponseKeys(item, `${path}[${index}]`));
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(forbiddenPiiResponseKeys.has(key) ? [`${path}.${key}`] : []),
    ...findForbiddenPiiResponseKeys(item, `${path}.${key}`),
  ]);
}
