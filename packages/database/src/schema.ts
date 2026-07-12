import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { leadStatuses, qualificationStatuses } from '@lead-finder/shared';
import { crmPriorities, crmStages, taskStatuses } from '@lead-finder/shared';
export const leadStatusEnum = pgEnum('lead_status', leadStatuses);
export const qualificationStatusEnum = pgEnum('qualification_status', qualificationStatuses);
export const crmStageEnum = pgEnum('crm_stage', crmStages);
export const crmPriorityEnum = pgEnum('crm_priority', crmPriorities);
export const commercialTaskStatusEnum = pgEnum('commercial_task_status', taskStatuses);
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    osmType: text('osm_type').notNull(),
    osmId: text('osm_id').notNull(),
    name: text('name'),
    category: text('category').notNull(),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    email: text('email'),
    website: text('website'),
    instagram: text('instagram'),
    facebook: text('facebook'),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    score: integer('score').notNull(),
    status: leadStatusEnum('status').notNull(),
    qualificationStatus: qualificationStatusEnum('qualification_status')
      .notNull()
      .default('PENDENTE'),
    normalizedName: text('normalized_name'),
    normalizedAddress: text('normalized_address'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    isClosed: boolean('is_closed').notNull().default(false),
    crmStage: crmStageEnum('crm_stage'),
    crmPriority: crmPriorityEnum('crm_priority').notNull().default('MEDIA'),
    crmOwner: text('crm_owner'),
    crmNextActionAt: timestamp('crm_next_action_at', { withTimezone: true }),
    crmVersion: integer('crm_version').notNull().default(1),
    crmUpdatedAt: timestamp('crm_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('leads_osm_identity_uidx').on(table.osmType, table.osmId),
    index('leads_filter_idx').on(table.status, table.category, table.city, table.score),
  ],
);
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export const collectionJobs = pgTable('collection_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('PENDING'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const leadEvidence = pgTable(
  'lead_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    reference: text('reference'),
    result: text('result').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    fingerprint: text('fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_evidence_identity_uidx').on(table.leadId, table.fingerprint),
    index('lead_evidence_lead_created_idx').on(table.leadId, table.createdAt),
  ],
);
export const leadContacts = pgTable(
  'lead_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    originalValue: text('original_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    source: text('source').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    isValid: boolean('is_valid').notNull().default(false),
    possibleWhatsapp: boolean('possible_whatsapp').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_contacts_identity_uidx').on(table.leadId, table.type, table.normalizedValue),
    index('lead_contacts_lead_idx').on(table.leadId, table.updatedAt),
  ],
);
export const leadQualificationHistory = pgTable('lead_qualification_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value').notNull(),
  actor: text('actor').notNull(),
  source: text('source').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const crmOpportunities = pgTable('crm_opportunities', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }),
  currency: text('currency').notNull().default('BRL'),
  expectedCloseAt: timestamp('expected_close_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  outcome: text('outcome'),
  lossReason: text('loss_reason'),
  owner: text('owner'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const crmNotes = pgTable('crm_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'cascade' }),
  body: text('body').notNull(), author: text('author').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const crmTags = pgTable('crm_tags', {
  id: uuid('id').defaultRandom().primaryKey(), name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const crmLeadTags = pgTable('crm_lead_tags', {
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => crmTags.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const crmTasks = pgTable('crm_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), description: text('description'),
  status: commercialTaskStatusEnum('status').notNull().default('PENDENTE'),
  priority: crmPriorityEnum('priority').notNull().default('MEDIA'), owner: text('owner'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }), completionNote: text('completion_note'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const crmTimelineEvents = pgTable('crm_timeline_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id').references(() => crmOpportunities.id, { onDelete: 'set null' }),
  taskId: uuid('task_id').references(() => crmTasks.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(), actor: text('actor').notNull(), reason: text('reason'),
  previousValue: jsonb('previous_value'), newValue: jsonb('new_value').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const crmIdempotencyKeys = pgTable('crm_idempotency_keys', {
  scope: text('scope').notNull(), idempotencyKey: text('idempotency_key').notNull(),
  payloadFingerprint: text('payload_fingerprint').notNull(), resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id').notNull(), result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});
