import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  numeric,
  uuid,
} from 'drizzle-orm/pg-core';
import { contactTypes, leadStatuses, validationStatuses } from '@lead-finder/shared';

export const leadStatusEnum = pgEnum('lead_status', leadStatuses);
export const validationStatusEnum = pgEnum('validation_status', validationStatuses);
export const contactTypeEnum = pgEnum('contact_type', contactTypes);

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
    validationStatus: validationStatusEnum('validation_status').notNull().default('PENDENTE'),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    doNotContactReason: text('do_not_contact_reason'),
    doNotContactAt: timestamp('do_not_contact_at', { withTimezone: true }),
    isClosed: boolean('is_closed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('leads_osm_identity_uidx').on(table.osmType, table.osmId),
    index('leads_filter_idx').on(table.status, table.category, table.city, table.score),
    index('leads_validation_idx').on(table.validationStatus, table.doNotContact),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export const validationEvidences = pgTable(
  'validation_evidences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    evidenceType: text('evidence_type').notNull(),
    value: text('value').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('validation_evidences_lead_idempotency_uidx').on(
      table.leadId,
      table.idempotencyKey,
    ),
    index('validation_evidences_lead_created_idx').on(table.leadId, table.createdAt),
  ],
);

export const leadContacts = pgTable(
  'lead_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: contactTypeEnum('type').notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    source: text('source').notNull(),
    confidence: smallint('confidence').notNull(),
    verified: boolean('verified').notNull().default(false),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    invalidationReason: text('invalidation_reason'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_contacts_identity_uidx').on(table.leadId, table.type, table.normalizedValue),
    uniqueIndex('lead_contacts_idempotency_uidx').on(table.leadId, table.idempotencyKey),
    index('lead_contacts_eligibility_idx').on(
      table.leadId,
      table.verified,
      table.invalidatedAt,
      table.type,
    ),
  ],
);

export const leadAuditLog = pgTable(
  'lead_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    origin: text('origin').notNull(),
    reason: text('reason'),
    payload: jsonb('payload').notNull().default({}),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_audit_log_idempotency_uidx').on(table.leadId, table.idempotencyKey),
    index('lead_audit_log_lead_created_idx').on(table.leadId, table.createdAt),
  ],
);

export const collectionJobs = pgTable('collection_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('PENDING'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
