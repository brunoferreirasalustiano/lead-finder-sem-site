import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  classifyWebsite,
  isPublicSourceLocator,
  type BusinessEnrichmentResult,
  isReadyForHumanReview,
} from '@lead-finder/enrichment';
import { normalizeEmail } from '@lead-finder/shared';
import type { Database } from './index.js';
import { leadContacts, leadEvidence, leads } from './schema.js';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const evidenceRows = (leadId: string, result: BusinessEnrichmentResult) => [
  {
    leadId,
    source: result.identity.sourceType,
    reference: result.identity.sourceLocator,
    evidenceType: 'BUSINESS_IDENTITY',
    verificationStatus: result.identity.confirmed ? 'VERIFIED' as const : 'UNVERIFIED' as const,
    result: result.identity.confirmed ? 'BUSINESS_IDENTITY_CONFIRMED' : 'BUSINESS_IDENTITY_UNCONFIRMED',
    confidence: String(result.identity.confidence),
    observedAt: result.identity.observedAt,
    fingerprint: fingerprint(['BUSINESS_IDENTITY', result.identity.sourceLocator, result.identity.observedAt.toISOString(), result.identity.confirmed]),
  },
  {
    leadId,
    source: result.activity.sourceType,
    reference: result.activity.sourceLocator,
    evidenceType: 'BUSINESS_ACTIVITY',
    verificationStatus: result.activity.status === 'ACTIVE' ? 'VERIFIED' as const : 'UNVERIFIED' as const,
    result: result.activity.status,
    confidence: String(result.activity.confidence),
    observedAt: result.activity.observedAt,
    fingerprint: fingerprint(['BUSINESS_ACTIVITY', result.activity.sourceLocator, result.activity.observedAt.toISOString(), result.activity.status]),
  },
  {
    leadId,
    source: result.website.sourceType,
    reference: result.website.sourceLocator,
    evidenceType: 'WEBSITE',
    verificationStatus: result.website.officialSiteFound || result.website.confidence < 0.85 ? 'UNVERIFIED' as const : 'VERIFIED' as const,
    result: result.website.officialSiteFound
      ? 'OFFICIAL_SITE_FOUND'
      : classifyWebsite(result) === 'NO_OFFICIAL_SITE_CONFIRMED' ? 'NO_OFFICIAL_SITE_CONFIRMED' : 'UNKNOWN',
    confidence: String(result.website.confidence),
    observedAt: result.website.observedAt,
    fingerprint: fingerprint(['WEBSITE', result.website.sourceLocator, result.website.observedAt.toISOString(), result.website.officialSiteFound, result.website.confidence]),
  },
  ...result.emails.map((email) => ({
    leadId,
    source: email.sourceType,
    reference: email.sourceLocator,
    evidenceType: 'BUSINESS_EMAIL',
      verificationStatus: email.businessAssociation === 'PASS' && !email.inferred && isPublicSourceLocator(email.sourceLocator) ? 'VERIFIED' as const : 'UNVERIFIED' as const,
    result: email.businessAssociation === 'PASS' && !email.inferred && isPublicSourceLocator(email.sourceLocator)
      ? 'EMAIL_BUSINESS_ASSOCIATION_PASS'
      : 'EMAIL_BUSINESS_ASSOCIATION_UNVERIFIED',
    confidence: String(email.confidence),
    observedAt: email.observedAt,
    fingerprint: fingerprint(['BUSINESS_EMAIL', email.value.trim().toLowerCase(), email.sourceLocator, email.observedAt.toISOString(), email.businessAssociation, email.inferred]),
  })),
];

export async function recordLeadEnrichment(
  db: Database,
  leadId: string,
  result: BusinessEnrichmentResult,
) {
  return db.transaction(async (tx) => {
    const current = (await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).for('update').limit(1))[0];
    if (!current) throw new Error('LEAD_NOT_FOUND');

    const websiteStatus = classifyWebsite(result);
    await tx.update(leads).set({
      websiteStatus,
      status: websiteStatus === 'OFFICIAL_SITE_FOUND' ? 'POSSUI_SITE' : 'PENDENTE_VALIDACAO',
      updatedAt: new Date(),
    }).where(eq(leads.id, leadId));

    const evidence = evidenceRows(leadId, result);
    if (evidence.length > 0) {
      await tx.insert(leadEvidence).values(evidence).onConflictDoNothing({
        target: [leadEvidence.leadId, leadEvidence.fingerprint],
      });
    }

    for (const email of result.emails) {
      const normalized = normalizeEmail(email.value);
      if (!normalized) continue;
      const verified = email.businessAssociation === 'PASS' && !email.inferred && isPublicSourceLocator(email.sourceLocator);
      await tx.insert(leadContacts).values({
        leadId,
        type: 'EMAIL',
        originalValue: email.value,
        normalizedValue: normalized,
        source: email.sourceType,
        confidence: String(email.confidence),
        verifiedAt: verified ? email.observedAt : null,
        isValid: verified,
        possibleWhatsapp: false,
      }).onConflictDoUpdate({
        target: [leadContacts.leadId, leadContacts.type, leadContacts.normalizedValue],
        set: {
          originalValue: email.value,
          source: email.sourceType,
          confidence: String(email.confidence),
          verifiedAt: verified ? email.observedAt : null,
          isValid: verified,
          updatedAt: new Date(),
        },
      });
    }

    return {
      websiteStatus,
      evidenceCount: evidence.length,
      verifiedEmailCount: result.emails.filter((email) => email.businessAssociation === 'PASS' && !email.inferred && isPublicSourceLocator(email.sourceLocator)).length,
      readyForHumanReview: isReadyForHumanReview(result),
    };
  });
}

export async function listEnrichedHumanReviewCandidates(db: Database, limit = 10) {
  return db.execute(sql`
    SELECT DISTINCT ON (l.id)
      l.id, l.name, l.category, l.city, l.state, l.website_status,
      c.id AS contact_id, c.normalized_value AS email
    FROM public.leads l
    JOIN public.lead_contacts c ON c.lead_id=l.id
      AND c.type='EMAIL' AND c.is_valid=true AND c.verified_at IS NOT NULL
    WHERE l.website_status='NO_OFFICIAL_SITE_CONFIRMED'
      AND l.qualification_status='PENDENTE'
      AND NOT l.is_blocked AND NOT l.do_not_contact
      AND l.crm_stage IS DISTINCT FROM 'NAO_CONTATAR'::crm_stage
      AND EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_IDENTITY'
          AND e.verification_status='VERIFIED'
          AND e.result='BUSINESS_IDENTITY_CONFIRMED'
      )
      AND EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_ACTIVITY'
          AND e.verification_status='VERIFIED' AND e.result='ACTIVE'
      )
      AND EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_EMAIL'
          AND e.verification_status='VERIFIED'
          AND e.result='EMAIL_BUSINESS_ASSOCIATION_PASS'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.campaign_opt_outs o
        WHERE o.lead_id=l.id AND (o.channel IS NULL OR o.channel='EMAIL')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.contact_delivery_suppressions s
        WHERE s.lead_id=l.id AND s.contact_id=c.id AND s.channel='EMAIL'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.email_precontact_delivery_suppressions s
        WHERE s.identity_fingerprint=public.email_precontact_identity_fingerprint(c.normalized_value)
      )
    ORDER BY l.id, c.updated_at DESC
    LIMIT ${limit}
  `);
}
