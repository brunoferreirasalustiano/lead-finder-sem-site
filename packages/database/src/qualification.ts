import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  canTransitionQualification,
  attemptsToClearNonContact,
  isEligibleForOutreach,
  normalizeBrazilianPhone,
  normalizeEmail,
  type ContactType,
  type QualificationStatus,
} from '@lead-finder/shared';
import type { Database } from './index.js';
import { leadContacts, leadEvidence, leadQualificationHistory, leads } from './schema.js';

export class QualificationError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'INVALID_CONTACT' | 'DUPLICATE_CONTACT',
  ) {
    super(message);
  }
}
type Audit = { actor: string; source: string; reason?: string | undefined };
const fingerprint = (parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const hasPostgresCode = (error: unknown, code: string): boolean => {
  let current = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

export async function getQualification(db: Database, leadId: string) {
  const lead = (
    await db
      .select({
        id: leads.id,
        qualificationStatus: leads.qualificationStatus,
        websiteStatus: leads.websiteStatus,
        isBlocked: leads.isBlocked,
        doNotContact: leads.doNotContact,
      })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1)
  )[0];
  if (!lead) throw new QualificationError('Lead not found', 'NOT_FOUND');
  const contacts = await listContacts(db, leadId);
  return { ...lead, outreachEligible: isEligibleForOutreach({ ...lead, contacts }) };
}
export const listContacts = (db: Database, leadId: string) =>
  db
    .select()
    .from(leadContacts)
    .where(eq(leadContacts.leadId, leadId))
    .orderBy(desc(leadContacts.updatedAt));
export const listHistory = (db: Database, leadId: string) =>
  db
    .select()
    .from(leadQualificationHistory)
    .where(eq(leadQualificationHistory.leadId, leadId))
    .orderBy(desc(leadQualificationHistory.createdAt));
export const listEvidence = (db: Database, leadId: string) =>
  db
    .select()
    .from(leadEvidence)
    .where(eq(leadEvidence.leadId, leadId))
    .orderBy(desc(leadEvidence.createdAt));

export async function addEvidence(
  db: Database,
  leadId: string,
  input: Audit & {
    reference?: string | undefined;
    evidenceType?: string | undefined;
    verificationStatus?: 'VERIFIED' | 'OBSERVED' | 'UNVERIFIED' | 'REJECTED' | undefined;
    result: string;
    confidence: number;
    observedAt: Date;
    notes?: string | undefined;
  },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${leadId}))`);
    if (!(await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1))[0])
      throw new QualificationError('Lead not found', 'NOT_FOUND');
    const fp = fingerprint([
      input.source,
      input.reference ?? null,
      input.result,
      input.observedAt.toISOString(),
    ]);
    const inserted = (
      await tx
        .insert(leadEvidence)
        .values({
          leadId,
          source: input.source,
          reference: input.reference,
          evidenceType: input.evidenceType ?? 'LEGACY',
          verificationStatus: input.verificationStatus ?? 'OBSERVED',
          result: input.result,
          confidence: String(input.confidence),
          observedAt: input.observedAt,
          notes: input.notes,
          fingerprint: fp,
        })
        .onConflictDoNothing()
        .returning()
    )[0];
    const row =
      inserted ??
      (
        await tx
          .select()
          .from(leadEvidence)
          .where(and(eq(leadEvidence.leadId, leadId), eq(leadEvidence.fingerprint, fp)))
          .limit(1)
      )[0];
    if (inserted)
      await tx
        .insert(leadQualificationHistory)
        .values({ leadId, eventType: 'EVIDENCE_RECORDED', newValue: row, ...input });
    return row;
  });
}
export async function upsertContact(
  db: Database,
  leadId: string,
  input: Audit & {
    type: ContactType;
    value: string;
    confidence: number;
    verifiedAt?: Date | null | undefined;
    isValid: boolean;
    possibleWhatsapp: boolean;
  },
) {
  const normalized =
    input.type === 'TELEFONE' ? normalizeBrazilianPhone(input.value) : normalizeEmail(input.value);
  if (!normalized) throw new QualificationError('Invalid contact', 'INVALID_CONTACT');
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${leadId}))`);
      if (!(await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1))[0])
        throw new QualificationError('Lead not found', 'NOT_FOUND');
      const previous = (
        await tx
          .select()
          .from(leadContacts)
          .where(
            and(
              eq(leadContacts.leadId, leadId),
              eq(leadContacts.type, input.type),
              eq(leadContacts.normalizedValue, normalized),
            ),
          )
          .limit(1)
      )[0];
      const row = (
        await tx
          .insert(leadContacts)
          .values({
            leadId,
            type: input.type,
            originalValue: input.value,
            normalizedValue: normalized,
            source: input.source,
            confidence: String(input.confidence),
            verifiedAt: input.verifiedAt,
            isValid: input.isValid,
            possibleWhatsapp: input.possibleWhatsapp,
          })
          .onConflictDoUpdate({
            target: [leadContacts.leadId, leadContacts.type, leadContacts.normalizedValue],
            set: {
              originalValue: input.value,
              source: input.source,
              confidence: String(input.confidence),
              verifiedAt: input.verifiedAt,
              isValid: input.isValid,
              possibleWhatsapp: input.possibleWhatsapp,
              updatedAt: new Date(),
            },
          })
          .returning()
      )[0]!;
      await tx.insert(leadQualificationHistory).values({
        leadId,
        eventType: previous ? 'CONTACT_UPDATED' : 'CONTACT_ADDED',
        previousValue: previous ?? null,
        newValue: row,
        actor: input.actor,
        source: input.source,
        reason: input.reason,
      });
      return row;
    });
  } catch (error) {
    if (error instanceof QualificationError) throw error;
    if (hasPostgresCode(error, '23505'))
      throw new QualificationError('Verified contact belongs to another lead', 'DUPLICATE_CONTACT');
    throw error;
  }
}
export async function updateQualification(
  db: Database,
  leadId: string,
  input: Audit & {
    status: QualificationStatus;
    isBlocked?: boolean | undefined;
    doNotContact?: boolean | undefined;
  },
) {
  return db.transaction(async (tx) => {
    const current = (
      await tx.select().from(leads).where(eq(leads.id, leadId)).for('update').limit(1)
    )[0];
    if (!current) throw new QualificationError('Lead not found', 'NOT_FOUND');
    if (attemptsToClearNonContact(current, input))
      throw new QualificationError('Generic qualification updates cannot clear non-contact flags', 'INVALID_TRANSITION');
    if (
      current.qualificationStatus !== input.status &&
      !canTransitionQualification(current.qualificationStatus, input.status)
    )
      throw new QualificationError('Invalid qualification transition', 'INVALID_TRANSITION');
    const row = (
      await tx
        .update(leads)
        .set({
          qualificationStatus: input.status,
          isBlocked: input.isBlocked ?? current.isBlocked,
          doNotContact: input.doNotContact ?? current.doNotContact,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId))
        .returning()
    )[0]!;
    await tx.insert(leadQualificationHistory).values({
      leadId,
      eventType: 'QUALIFICATION_CHANGED',
      previousValue: {
        status: current.qualificationStatus,
        isBlocked: current.isBlocked,
        doNotContact: current.doNotContact,
      },
      newValue: {
        status: row.qualificationStatus,
        isBlocked: row.isBlocked,
        doNotContact: row.doNotContact,
      },
      actor: input.actor,
      source: input.source,
      reason: input.reason,
    });
    return row;
  });
}
export async function listOutreachEligibleLeads(db: Database, limit = 50) {
  return db
    .selectDistinctOn([leads.id], { lead: leads, contact: leadContacts })
    .from(leads)
    .innerJoin(
      leadContacts,
      and(
        eq(leadContacts.leadId, leads.id),
        eq(leadContacts.isValid, true),
        sql`${leadContacts.verifiedAt} is not null`,
      ),
    )
    .where(
      and(
        eq(leads.qualificationStatus, 'SEM_SITE_CONFIRMADO'),
        eq(leads.websiteStatus, 'NO_OFFICIAL_SITE_CONFIRMED'),
        sql`exists (select 1 from lead_evidence e where e.lead_id = ${leads.id} and e.evidence_type = 'BUSINESS_IDENTITY' and e.verification_status = 'VERIFIED' and e.result = 'BUSINESS_IDENTITY_CONFIRMED')`,
        sql`exists (select 1 from lead_evidence e where e.lead_id = ${leads.id} and e.evidence_type = 'BUSINESS_ACTIVITY' and e.verification_status = 'VERIFIED' and e.result = 'ACTIVE')`,
        sql`exists (select 1 from lead_evidence e where e.lead_id = ${leads.id} and e.evidence_type = 'WEBSITE' and e.verification_status = 'VERIFIED' and e.result = 'NO_OFFICIAL_SITE_CONFIRMED')`,
        sql`exists (select 1 from lead_evidence e where e.lead_id = ${leads.id} and e.evidence_type = 'BUSINESS_EMAIL' and e.verification_status = 'VERIFIED' and e.result = 'EMAIL_BUSINESS_ASSOCIATION_PASS')`,
        eq(leads.isBlocked, false),
        eq(leads.doNotContact, false),
        sql`${leads.crmStage} is distinct from 'NAO_CONTATAR'::crm_stage`,
      ),
    )
    .limit(limit);
}
