import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
    websiteStatus: text('website_status')
      .$type<'UNKNOWN' | 'OFFICIAL_SITE_FOUND' | 'NO_OFFICIAL_SITE_CONFIRMED'>()
      .notNull()
      .default('UNKNOWN'),
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
  leaseToken: uuid('lease_token'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
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
    evidenceType: text('evidence_type').notNull().default('LEGACY'),
    verificationStatus: text('verification_status').notNull().default('OBSERVED'),
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
    uniqueIndex('lead_contacts_id_lead_id_uidx').on(table.id, table.leadId),
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
  maxAttemptsSnapshot: integer('max_attempts_snapshot'),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  claimWorkerId: text('claim_worker_id'), claimToken: uuid('claim_token'),
  claimGeneration: integer('claim_generation').notNull().default(0),
  deadLetterCycle: integer('dead_letter_cycle').notNull().default(0),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_outbox_aggregate_type_aggregate_id_idempotency_key_key').on(table.aggregateType, table.aggregateId, table.idempotencyKey),
  index('campaign_outbox_queue_idx').on(table.status, table.availableAt, table.id).where(sql`${table.status} = 'PENDING'`),
  index('campaign_outbox_claim_queue_idx').on(table.availableAt, table.claimExpiresAt, table.id).where(sql`${table.status} = 'PENDING'`),
  check('campaign_outbox_dead_letter_cycle_check', sql`${table.deadLetterCycle} >= 0`),
  check('campaign_outbox_max_attempts_snapshot_check', sql`${table.maxAttemptsSnapshot} is null or ${table.maxAttemptsSnapshot} > 0`),
]);
export const campaignDailyChannelCounters = pgTable('campaign_daily_channel_counters', {
  channel: text('channel').notNull(),
  quotaDay: date('quota_day').notNull(),
  count: integer('count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: 'campaign_daily_channel_counters_pkey', columns: [table.channel, table.quotaDay] }),
  check('campaign_daily_channel_counters_channel_check', sql`${table.channel} in ('EMAIL', 'WHATSAPP')`),
  check('campaign_daily_channel_counters_count_check', sql`${table.count} >= 0`),
  check('campaign_daily_channel_counters_timestamps_check', sql`${table.updatedAt} >= ${table.createdAt}`),
]);
export const campaignChannelRuntime = pgTable('campaign_channel_runtime', {
  channel: text('channel').primaryKey(),
  nextAvailableAt: timestamp('next_available_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('campaign_channel_runtime_channel_check', sql`${table.channel} in ('EMAIL', 'WHATSAPP')`),
  check('campaign_channel_runtime_timestamps_check', sql`${table.updatedAt} >= ${table.createdAt}`),
]);
export const campaignExecutionStarts = pgTable('campaign_execution_starts', {
  id: uuid('id').defaultRandom().primaryKey(),
  outboxId: uuid('outbox_id').notNull().references(() => campaignOutbox.id, { onDelete: 'restrict' }),
  attemptId: uuid('attempt_id').notNull().references(() => campaignAttempts.id, { onDelete: 'restrict' }),
  channel: text('channel').notNull(),
  quotaDay: date('quota_day').notNull(),
  claimGeneration: integer('claim_generation').notNull(),
  cycle: integer('cycle').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_execution_starts_outbox_cycle_key').on(table.outboxId, table.cycle),
  uniqueIndex('campaign_execution_starts_attempt_cycle_key').on(table.attemptId, table.cycle),
  uniqueIndex('campaign_execution_starts_identity_key').on(table.id, table.outboxId, table.cycle),
  index('campaign_execution_starts_channel_started_idx').on(table.channel, table.startedAt, table.id),
  check('campaign_execution_starts_channel_check', sql`${table.channel} in ('EMAIL', 'WHATSAPP')`),
  check('campaign_execution_starts_claim_generation_check', sql`${table.claimGeneration} >= 0`),
  check('campaign_execution_starts_cycle_check', sql`${table.cycle} >= 0`),
  check('campaign_execution_starts_quota_day_check', sql`${table.quotaDay} = (${table.startedAt} at time zone 'UTC')::date`),
]);
export const campaignDeadLetters = pgTable('campaign_dead_letters', {
  id: uuid('id').defaultRandom().primaryKey(),
  outboxId: uuid('outbox_id').notNull().references(() => campaignOutbox.id, { onDelete: 'restrict' }),
  cycle: integer('cycle').notNull().default(0),
  correlationId: text('correlation_id').notNull(), payload: jsonb('payload').notNull(), error: text('error').notNull(),
  errorCode: text('error_code').notNull().default('UNCLASSIFIED'),
  attempts: integer('attempts').notNull(), claimGeneration: integer('claim_generation').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('campaign_dead_letters_outbox_cycle_key').on(table.outboxId, table.cycle),
  uniqueIndex('campaign_dead_letters_identity_key').on(table.id, table.outboxId, table.cycle),
  index('campaign_dead_letters_created_idx').on(table.createdAt, table.id),
  check('campaign_dead_letters_cycle_check', sql`${table.cycle} >= 0`),
  check('campaign_dead_letters_claim_generation_check', sql`${table.claimGeneration} >= 0`),
]);
export const campaignSimulatedConfirmations = pgTable('campaign_simulated_confirmations', {
  executionId: uuid('execution_id').primaryKey(),
  outboxId: uuid('outbox_id').notNull(),
  cycle: integer('cycle').notNull(),
  attemptId: uuid('attempt_id').references(() => campaignAttempts.id, { onDelete: 'restrict' }),
  channel: text('channel').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    name: 'campaign_simulated_confirmations_execution_fkey',
    columns: [table.executionId, table.outboxId, table.cycle],
    foreignColumns: [campaignExecutionStarts.id, campaignExecutionStarts.outboxId, campaignExecutionStarts.cycle],
  }).onDelete('restrict'),
  uniqueIndex('campaign_simulated_confirmations_outbox_cycle_key').on(table.outboxId, table.cycle),
  index('campaign_simulated_confirmations_confirmed_idx').on(table.confirmedAt, table.executionId),
  check('campaign_simulated_confirmations_cycle_check', sql`${table.cycle} >= 0`),
  check('campaign_simulated_confirmations_channel_check', sql`${table.channel} in ('EMAIL', 'WHATSAPP')`),
  check('campaign_simulated_confirmations_timestamps_check', sql`${table.createdAt} >= ${table.confirmedAt}`),
]);
export const campaignDeadLetterRecoveries = pgTable('campaign_dead_letter_recoveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  deadLetterId: uuid('dead_letter_id').notNull().unique(),
  outboxId: uuid('outbox_id').notNull().references(() => campaignOutbox.id, { onDelete: 'restrict' }),
  fromCycle: integer('from_cycle').notNull(), toCycle: integer('to_cycle').notNull(),
  actor: text('actor').notNull(), reason: text('reason').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(), payloadFingerprint: text('payload_fingerprint').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  recoveredAt: timestamp('recovered_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    name: 'campaign_dead_letter_recoveries_dead_letter_fkey',
    columns: [table.deadLetterId, table.outboxId, table.fromCycle],
    foreignColumns: [campaignDeadLetters.id, campaignDeadLetters.outboxId, campaignDeadLetters.cycle],
  }).onDelete('restrict'),
  index('campaign_dead_letter_recoveries_outbox_idx').on(table.outboxId, table.recoveredAt, table.id),
  check('campaign_dead_letter_recoveries_from_cycle_check', sql`${table.fromCycle} >= 0`),
  check('campaign_dead_letter_recoveries_cycle_transition_check', sql`${table.toCycle} = ${table.fromCycle} + 1`),
  check('campaign_dead_letter_recoveries_timestamps_check', sql`${table.createdAt} >= ${table.recoveredAt}`),
]);

export const pilotRuns = pgTable('pilot_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), region: text('region').notNull(), category: text('category').notNull(),
  targetLeadCount: integer('target_lead_count').notNull(), status: text('status').notNull().default('DRAFT'),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'restrict' }),
  createdBy: text('created_by').notNull(), startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }), version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('pilot_runs_status_updated_idx').on(table.status, table.updatedAt, table.id),
  check('pilot_runs_target_check', sql`${table.targetLeadCount} between 1 and 30`),
]);
export const pilotLeads = pgTable('pilot_leads', {
  pilotRunId: uuid('pilot_run_id').notNull().references(() => pilotRuns.id, { onDelete: 'restrict' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  source: text('source').notNull(), addedBy: text('added_by').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(), version: integer('version').notNull().default(1),
}, (table) => [primaryKey({ name: 'pilot_leads_pkey', columns: [table.pilotRunId, table.leadId] }), index('pilot_leads_lead_idx').on(table.leadId)]);
export const pilotReviews = pgTable('pilot_reviews', {
  id: uuid('id').defaultRandom().primaryKey(), pilotRunId: uuid('pilot_run_id').notNull(), leadId: uuid('lead_id').notNull(),
  decision: text('decision').notNull(), reason: text('reason'), reviewerPrincipalId: text('reviewer_principal_id').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(), version: integer('version').notNull(),
}, (table) => [
  foreignKey({ columns: [table.pilotRunId, table.leadId], foreignColumns: [pilotLeads.pilotRunId, pilotLeads.leadId] }).onDelete('restrict'),
  uniqueIndex('pilot_reviews_current_version_uidx').on(table.pilotRunId, table.leadId, table.version),
  index('pilot_reviews_current_idx').on(table.pilotRunId, table.leadId, table.version),
]);
export const pilotManualContacts = pgTable('pilot_manual_contacts', {
  id: uuid('id').defaultRandom().primaryKey(), pilotRunId: uuid('pilot_run_id').notNull(), leadId: uuid('lead_id').notNull(),
  contactId: uuid('contact_id').notNull().references(() => leadContacts.id, { onDelete: 'restrict' }), channel: text('channel').notNull(),
  approvedTemplateVersionId: text('approved_template_version_id').notNull(), operatorPrincipalId: text('operator_principal_id').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(), requestId: text('request_id'), observation: text('observation'),
  idempotencyKey: text('idempotency_key').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
}, (table) => [
  foreignKey({ columns: [table.pilotRunId, table.leadId], foreignColumns: [pilotLeads.pilotRunId, pilotLeads.leadId] }).onDelete('restrict'),
  foreignKey({ name: 'pilot_manual_contacts_contact_lead_fk', columns: [table.contactId, table.leadId], foreignColumns: [leadContacts.id, leadContacts.leadId] }).onDelete('restrict'),
  uniqueIndex('pilot_manual_contacts_idempotency_uidx').on(table.pilotRunId, table.idempotencyKey), index('pilot_manual_contacts_snapshot_idx').on(table.pilotRunId, table.recordedAt),
]);
export const pilotResults = pgTable('pilot_results', {
  id: uuid('id').defaultRandom().primaryKey(), pilotRunId: uuid('pilot_run_id').notNull(), leadId: uuid('lead_id').notNull(),
  result: text('result').notNull(), channel: text('channel'), principalId: text('principal_id').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(), reason: text('reason'), nextAction: text('next_action'),
  humanConfirmed: boolean('human_confirmed').notNull().default(false), version: integer('version').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
}, (table) => [
  foreignKey({ columns: [table.pilotRunId, table.leadId], foreignColumns: [pilotLeads.pilotRunId, pilotLeads.leadId] }).onDelete('restrict'),
  uniqueIndex('pilot_results_idempotency_uidx').on(table.pilotRunId, table.idempotencyKey), uniqueIndex('pilot_results_version_uidx').on(table.pilotRunId, table.leadId, table.version),
  index('pilot_results_snapshot_idx').on(table.pilotRunId, table.recordedAt),
]);
export const pilotTimelineEvents = pgTable('pilot_timeline_events', {
  id: uuid('id').defaultRandom().primaryKey(), pilotRunId: uuid('pilot_run_id').notNull().references(() => pilotRuns.id, { onDelete: 'restrict' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'restrict' }), eventType: text('event_type').notNull(),
  principalId: text('principal_id').notNull(), previousValue: jsonb('previous_value'), newValue: jsonb('new_value').notNull(), metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: 'pilot_timeline_events_pilot_lead_fk', columns: [table.pilotRunId, table.leadId], foreignColumns: [pilotLeads.pilotRunId, pilotLeads.leadId] }).onDelete('restrict'),
  index('pilot_timeline_run_created_idx').on(table.pilotRunId, table.createdAt, table.id),
]);
export const pilotIdempotencyKeys = pgTable('pilot_idempotency_keys', {
  scope: text('scope').notNull(), idempotencyKey: text('idempotency_key').notNull(), payloadFingerprint: text('payload_fingerprint').notNull(),
  resourceType: text('resource_type').notNull(), resourceId: uuid('resource_id').notNull(), result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ name: 'pilot_idempotency_keys_pkey', columns: [table.scope, table.idempotencyKey] })]);
