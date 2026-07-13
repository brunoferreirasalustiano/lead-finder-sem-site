import {
  boolean,
  foreignKey,
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
import { sql } from 'drizzle-orm';
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

export const campaigns = pgTable('campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), idempotencyKey: text('idempotency_key').notNull().unique(),
  payloadFingerprint: text('payload_fingerprint').notNull(), state: text('state').notNull().default('RASCUNHO'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const campaignVersions = pgTable('campaign_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'restrict' }),
  versionNumber: integer('version_number').notNull(), state: text('state').notNull().default('RASCUNHO'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_versions_campaign_id_version_number_key').on(table.campaignId, table.versionNumber),
  uniqueIndex('campaign_versions_id_campaign_id_key').on(table.id, table.campaignId),
]);
export const campaignTemplates = pgTable('campaign_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignVersionId: uuid('campaign_version_id').notNull().references(() => campaignVersions.id, { onDelete: 'restrict' }),
  channel: text('channel').notNull(), content: text('content').notNull(),
  allowedVariables: jsonb('allowed_variables').notNull(), fingerprint: text('fingerprint').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('campaign_templates_campaign_version_id_channel_key').on(table.campaignVersionId, table.channel)]);
export const campaignRecipients = pgTable('campaign_recipients', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'restrict' }),
  campaignVersionId: uuid('campaign_version_id').notNull().references(() => campaignVersions.id, { onDelete: 'restrict' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  channel: text('channel').notNull(), state: text('state').notNull().default('PENDENTE'),
  recipientSnapshot: jsonb('recipient_snapshot').notNull(), idempotencyKey: text('idempotency_key').notNull(),
  payloadFingerprint: text('payload_fingerprint').notNull(), version: integer('version').notNull().default(1),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_recipients_campaign_id_idempotency_key_key').on(table.campaignId, table.idempotencyKey),
  uniqueIndex('campaign_recipients_campaign_id_campaign_version_id_lead_id_channel_key').on(table.campaignId, table.campaignVersionId, table.leadId, table.channel),
  foreignKey({ columns: [table.campaignVersionId, table.campaignId], foreignColumns: [campaignVersions.id, campaignVersions.campaignId] }).onDelete('restrict'),
  index('campaign_recipients_queue_idx').on(table.state, table.availableAt, table.id).where(sql`${table.state} in ('PENDENTE', 'ELEGIVEL')`),
]);
export const campaignAttempts = pgTable('campaign_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  recipientId: uuid('recipient_id').notNull().references(() => campaignRecipients.id, { onDelete: 'restrict' }),
  state: text('state').notNull().default('PENDENTE'), payloadSnapshot: jsonb('payload_snapshot').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
  version: integer('version').notNull().default(1), availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_attempts_recipient_id_idempotency_key_key').on(table.recipientId, table.idempotencyKey),
  index('campaign_attempts_queue_idx').on(table.state, table.availableAt, table.id).where(sql`${table.state} in ('PENDENTE', 'APROVADA')`),
]);
export const campaignProviderEvents = pgTable('campaign_provider_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  attemptId: uuid('attempt_id').notNull().references(() => campaignAttempts.id, { onDelete: 'restrict' }),
  provider: text('provider').notNull(), externalId: text('external_id').notNull(), eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_provider_events_provider_external_id_key').on(table.provider, table.externalId),
  index('campaign_provider_events_attempt_idx').on(table.attemptId, table.occurredAt, table.id),
]);
export const campaignOptOuts = pgTable('campaign_opt_outs', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  channel: text('channel'), reason: text('reason').notNull(), source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_opt_outs_global_uidx').on(table.leadId).where(sql`${table.channel} is null`),
  uniqueIndex('campaign_opt_outs_channel_uidx').on(table.leadId, table.channel).where(sql`${table.channel} is not null`),
]);
export const campaignOutbox = pgTable('campaign_outbox', {
  id: uuid('id').defaultRandom().primaryKey(), aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(), eventType: text('event_type').notNull(), payload: jsonb('payload').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
  status: text('status').notNull().default('PENDING'), attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_outbox_aggregate_type_aggregate_id_idempotency_key_key').on(table.aggregateType, table.aggregateId, table.idempotencyKey),
  index('campaign_outbox_queue_idx').on(table.status, table.availableAt, table.id).where(sql`${table.status} = 'PENDING'`),
]);
export const campaignDeadLetters = pgTable('campaign_dead_letters', {
  id: uuid('id').defaultRandom().primaryKey(),
  outboxId: uuid('outbox_id').notNull().unique().references(() => campaignOutbox.id, { onDelete: 'restrict' }),
  correlationId: text('correlation_id').notNull(), payload: jsonb('payload').notNull(), error: text('error').notNull(),
  attempts: integer('attempts').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('campaign_dead_letters_created_idx').on(table.createdAt, table.id)]);
