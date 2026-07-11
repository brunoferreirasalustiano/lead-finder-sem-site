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
export const leadStatusEnum = pgEnum('lead_status', leadStatuses);
export const qualificationStatusEnum = pgEnum('qualification_status', qualificationStatuses);
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
