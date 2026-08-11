import { sql } from 'drizzle-orm';
import {
  approvedTemplates,
  currentPilotEmailTemplate,
} from '@lead-finder/messaging';
import {
  AUTOMATED_COMPLIANCE_POLICY_VERSION,
  evaluateAutomatedCompliance,
  isTrustedAuthorizationContext,
  createAuthorizationContext,
  type AuthorizationContext,
} from '@lead-finder/shared';
import type { Database } from './index.js';
import { prepareManualMessage, sendPreparedManualEmail } from './restricted-manual-email.js';

export type Daily6SlotInput = Readonly<{
  date: string;
  slot: '09' | '13' | '16';
  city: string;
  category?: string;
  policyVersion: typeof AUTOMATED_COMPLIANCE_POLICY_VERSION;
  expectedOperationalSha: string;
}>;

export type Daily6SlotRuntime = Readonly<{
  enabled: boolean;
  realSendEnabled: boolean;
  manualEmailSendEnabled: boolean;
  killSwitchEnabled: boolean;
  sender: string;
  fingerprintKey: string;
  operationalSha: string;
  deliver: (message: { subject: string; body: string; recipient: string }) => Promise<{ provider: 'GMAIL_API'; messageId: string }>;
}>;

type CandidateRow = Readonly<{
  lead_id: string;
  contact_id: string;
  lead_name: string;
  city: string;
  category: string;
  business_identity_confirmed: boolean;
  business_active_pass: boolean;
  public_business_email_present: boolean;
  email_business_association_pass: boolean;
  email_inferred: boolean;
  official_site_found: boolean;
  site_search_high: boolean;
  prior_contact: boolean;
  duplicate: boolean;
  pending_or_ambiguous_send: boolean;
  suppressed: boolean;
  hard_bounce: boolean;
  opt_out: boolean;
  do_not_contact: boolean;
  nao_contatar: boolean;
  email_channel_allowed: boolean;
  current_verified_evidence_required: boolean;
  legacy_status_only: boolean;
  evidence_ids: unknown;
}>;

export type Daily6SlotReport = Readonly<{
  batchId: string;
  discovered: number;
  autoApproved: number;
  rejected: number;
  ready: number;
  sent: number;
  delivered: number;
  failed: number;
  ambiguous: number;
  replayed: boolean;
  providerCalls: number;
}>;

const cityId = (city: string) => city.trim().toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const shaPattern = /^[0-9a-f]{40}$/iu;

const internalAuthorization = (requestId?: string): AuthorizationContext => createAuthorizationContext({
  principalId: 'daily6-orchestrator',
  permissions: new Set(['manual-messaging:prepare', 'daily6:send']),
  authenticationMethod: 'AUTOMATED_COMPLIANCE',
  ...(requestId ? { requestId } : {}),
});

const bool = (value: unknown) => value === true || value === 't' || value === 'true';
const asCandidate = (value: CandidateRow): CandidateRow => ({
  ...value,
  business_identity_confirmed: bool(value.business_identity_confirmed),
  business_active_pass: bool(value.business_active_pass),
  public_business_email_present: bool(value.public_business_email_present),
  email_business_association_pass: bool(value.email_business_association_pass),
  email_inferred: bool(value.email_inferred),
  official_site_found: bool(value.official_site_found),
  site_search_high: bool(value.site_search_high),
  prior_contact: bool(value.prior_contact),
  duplicate: bool(value.duplicate),
  pending_or_ambiguous_send: bool(value.pending_or_ambiguous_send),
  suppressed: bool(value.suppressed),
  hard_bounce: bool(value.hard_bounce),
  opt_out: bool(value.opt_out),
  do_not_contact: bool(value.do_not_contact),
  nao_contatar: bool(value.nao_contatar),
  email_channel_allowed: bool(value.email_channel_allowed),
  current_verified_evidence_required: bool(value.current_verified_evidence_required),
  legacy_status_only: bool(value.legacy_status_only),
});

const errorCode = (error: unknown) => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

export async function runDaily6Slot(
  db: Database,
  input: Daily6SlotInput,
  authorization: AuthorizationContext,
  runtime: Daily6SlotRuntime,
): Promise<Daily6SlotReport> {
  if (!isTrustedAuthorizationContext(authorization) || !authorization.permissions.has('daily6:execute')) {
    throw new Error('DAILY6_EXECUTE_UNAUTHORIZED');
  }
  if (!runtime.enabled || !runtime.realSendEnabled || !runtime.manualEmailSendEnabled || runtime.killSwitchEnabled) {
    throw new Error('DAILY6_RUNTIME_DISABLED');
  }
  if (runtime.sender.trim().toLowerCase() !== 'leadfinderbrasil@gmail.com') throw new Error('DAILY6_SENDER_MISMATCH');
  if (input.policyVersion !== AUTOMATED_COMPLIANCE_POLICY_VERSION
    || !datePattern.test(input.date)
    || !shaPattern.test(input.expectedOperationalSha)
    || input.expectedOperationalSha.toLowerCase() !== runtime.operationalSha.toLowerCase()) {
    throw new Error('DAILY6_OPERATIONAL_CONTRACT_MISMATCH');
  }

  const normalizedCity = cityId(input.city);
  if (!normalizedCity || normalizedCity !== 'campinas-sp') throw new Error('DAILY6_CITY_NOT_ALLOWED');
  const batchId = `${input.date}|${input.slot}|${normalizedCity}|${input.policyVersion}`;
  await db.execute(sql`
    select lead_finder_internal.ensure_daily6_batch(
      ${batchId},${input.date}::date,${input.slot},${normalizedCity},${input.policyVersion}
    )
  `);
  const rows = await db.execute<CandidateRow>(sql`
    select * from lead_finder_internal.list_daily6_candidates(
      ${input.city},${input.category ?? null},10
    )
  `);
  const candidates = rows.map(asCandidate);
  const report = {
    batchId, discovered: candidates.length, autoApproved: 0, rejected: 0, ready: 0,
    sent: 0, delivered: 0, failed: 0, ambiguous: 0, replayed: false, providerCalls: 0,
  };
  const internalAuth = internalAuthorization(authorization.requestId);
  const selected = candidates.slice(0, 2);

  for (const candidate of selected) {
    const compliance = evaluateAutomatedCompliance({
      businessIdentityConfirmed: candidate.business_identity_confirmed,
      businessActive: candidate.business_active_pass ? 'PASS' : 'UNCERTAIN',
      publicBusinessEmailPresent: candidate.public_business_email_present,
      emailBusinessAssociation: candidate.email_business_association_pass ? 'PASS' : 'UNVERIFIED',
      emailInferred: candidate.email_inferred,
      officialSiteFound: candidate.official_site_found,
      siteSearchConfidence: candidate.site_search_high ? 'HIGH' : 'UNKNOWN',
      priorContact: candidate.prior_contact,
      duplicate: candidate.duplicate,
      pendingOrAmbiguousSend: candidate.pending_or_ambiguous_send,
      suppressed: candidate.suppressed,
      hardBounce: candidate.hard_bounce,
      optOut: candidate.opt_out,
      doNotContact: candidate.do_not_contact,
      naoContatar: candidate.nao_contatar,
      emailChannelAllowed: candidate.email_channel_allowed,
      currentVerifiedEvidenceRequired: candidate.current_verified_evidence_required,
      legacyStatusOnly: candidate.legacy_status_only,
    });
    if (!compliance.readyToSend) {
      report.rejected += 1;
      continue;
    }
    report.autoApproved += 1;
    let context: { pilot_run_id: string; replayed: boolean } | undefined;
    try {
      const contextRows = await db.execute<{ pilot_run_id: string; replayed: boolean }>(sql`
        select * from lead_finder_internal.prepare_daily6_pilot_context(
          ${batchId},${input.date}::date,${input.slot},${normalizedCity},${input.policyVersion},
          ${candidate.lead_id}::uuid,${candidate.contact_id}::uuid,'daily6-orchestrator',
          ${JSON.stringify(candidate.evidence_ids ?? [])}::jsonb,
          ${JSON.stringify([])}::jsonb
        )
      `);
      context = contextRows[0];
      if (!context) throw new Error('DAILY6_CONTEXT_MISSING');
      report.replayed ||= context.replayed;
      const preparation = await prepareManualMessage(db, context.pilot_run_id, candidate.lead_id, {
        contactId: candidate.contact_id,
        requestedChannel: 'EMAIL',
        templateId: approvedTemplates.emailV2.id,
        templateVersion: currentPilotEmailTemplate.version,
        idempotencyKey: `${batchId}|${candidate.lead_id}|prepare`,
      }, internalAuth) as { preparationId: string };
      report.ready += 1;
      const delivery = await sendPreparedManualEmail(db, preparation.preparationId, internalAuth, {
        sendEnabled: runtime.manualEmailSendEnabled && runtime.realSendEnabled,
        killSwitchEnabled: runtime.killSwitchEnabled,
        sender: runtime.sender,
        fingerprintKey: runtime.fingerprintKey,
        deliver: runtime.deliver,
        daily6: {
          batchId,
          sendIdentity: `${batchId}|${candidate.lead_id}`,
        },
      });
      if (!delivery.replayed && delivery.state !== 'IN_PROGRESS') report.providerCalls += 1;
      report.replayed ||= delivery.replayed;
      if (delivery.state === 'DELIVERED') {
        report.sent += 1;
        report.delivered += 1;
      } else if (delivery.state === 'FAILED') {
        report.failed += 1;
      } else if (delivery.state === 'AMBIGUOUS') {
        report.ambiguous += 1;
      }
    } catch (error) {
      const code = errorCode(error);
      if (code === 'INELIGIBLE' || code === 'NOT_FOUND' || code === 'INVALID_STATE') {
        report.rejected += 1;
        continue;
      }
      throw error;
    }
  }

  await db.execute(sql`
    select lead_finder_internal.bump_daily6_batch_metrics(
      ${batchId},${report.discovered},${candidates.length},${report.autoApproved},${report.rejected},${report.ready}
    )
  `);
  return report;
}
