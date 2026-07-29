import { leads } from './schema.js';

export const safeLeadSelection = {
  id: leads.id,
  name: leads.name,
  category: leads.category,
  city: leads.city,
  state: leads.state,
  website: leads.website,
  score: leads.score,
  status: leads.status,
  qualificationStatus: leads.qualificationStatus,
  isBlocked: leads.isBlocked,
  doNotContact: leads.doNotContact,
  isClosed: leads.isClosed,
  crmStage: leads.crmStage,
  crmPriority: leads.crmPriority,
  crmNextActionAt: leads.crmNextActionAt,
  crmVersion: leads.crmVersion,
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
} as const;
