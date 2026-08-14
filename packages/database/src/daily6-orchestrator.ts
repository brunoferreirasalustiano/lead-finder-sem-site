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
  deliver: (message: { subject: string; body: string; recipient: string; deliveryKey?: string }) => Promise<{ provider: 'GMAIL_API'; messageId: string }>;
  searchSent: (input: { deliveryKey: string }) => Promise<{ state: 'FOUND' | 'NOT_FOUND' | 'UNKNOWN'; messageId?: string }>;
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

export type Daily6CandidateForSelection = CandidateRow;

export const DAILY6_PROGRESSIVE_LIMITS = Object.freeze({
  targetApprovedPerSlot: 2,
  maxDiscoveredPerSlot: 40,
  maxFinalistsEvaluated: 15,
  maxSendsPerSlot: 2,
  sendRetry: 0,
} as const);

export type Daily6CandidateEvaluation = Readonly<{
  status: 'APPROVED' | 'REJECTED' | 'UNKNOWN' | 'BLOCKED';
  reason?: string;
  terminal?: boolean;
}>;

export type Daily6ProgressiveSelection = Readonly<{
  rankedCandidates: readonly Daily6CandidateForSelection[];
  approvedCandidates: readonly Daily6CandidateForSelection[];
  cheapFilterRejected: number;
  finalistsEvaluated: number;
  enriched: number;
  approved: number;
  rejected: number;
  unknown: number;
  blocked: number;
  rejectionReasons: Readonly<Record<string, number>>;
  stopReason: 'TARGET_APPROVED_REACHED' | 'MAX_FINALISTS_REACHED' | 'NO_ELIGIBLE_CANDIDATES' | 'FAIL_CLOSED';
  targetReached: boolean;
}>;

export type Daily6DeliveryState = 'DELIVERED' | 'FAILED' | 'AMBIGUOUS' | 'IN_PROGRESS';

/**
 * An unresolved provider result fences the rest of the slot.  The provider
 * call may have succeeded even when persistence could not confirm it, so a
 * subsequent candidate must never be sent from the same slot.
 */
export const shouldStopDaily6SlotAfterDelivery = (state: Daily6DeliveryState): boolean =>
  state === 'AMBIGUOUS';

export const shouldCountDaily6ProviderCall = (delivery: Readonly<{
  state: Daily6DeliveryState;
  replayed: boolean;
  providerCalled?: boolean;
}>): boolean => !delivery.replayed
  && delivery.state !== 'IN_PROGRESS'
  && delivery.providerCalled !== false;

export type Daily6SlotReport = Readonly<{
  batchId: string;
  discovered: number;
  cheapFilterRejected: number;
  ranked: number;
  finalistsEvaluated: number;
  enriched: number;
  autoApproved: number;
  rejected: number;
  unknown: number;
  blocked: number;
  targetReached: boolean;
  stopReason: Daily6ProgressiveSelection['stopReason'];
  rejectionReasons: Readonly<Record<string, number>>;
  ready: number;
  sent: number;
  delivered: number;
  failed: number;
  ambiguous: number;
  replayed: boolean;
  providerCalls: number;
}>;

const daily6CityAliases = new Set(['campinas', 'campinas-sp', 'campinas/sp', 'campinas, sp']);

const daily6CityContract = (city: string): { cityId: 'campinas-sp'; queryCity: 'Campinas' } | undefined => {
  const normalized = city.trim().toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '');
  if (!daily6CityAliases.has(normalized)) return undefined;
  return { cityId: 'campinas-sp', queryCity: 'Campinas' };
};

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

const normalizedText = (value: string) => value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '');

const candidateCheapFilterReason = (candidate: Daily6CandidateForSelection, requestedCity: string): string | undefined => {
  const checks: readonly [boolean, string][] = [
    [candidate.prior_contact, 'PRIOR_CONTACT'],
    [candidate.duplicate, 'DUPLICATE'],
    [candidate.pending_or_ambiguous_send, 'PENDING_OR_AMBIGUOUS_SEND'],
    [candidate.suppressed, 'SUPPRESSED'],
    [candidate.hard_bounce, 'HARD_BOUNCE'],
    [candidate.opt_out, 'OPT_OUT'],
    [candidate.do_not_contact, 'DO_NOT_CONTACT'],
    [candidate.nao_contatar, 'NAO_CONTATAR'],
    [candidate.official_site_found, 'OFFICIAL_SITE'],
    [!candidate.public_business_email_present, 'NO_PUBLIC_EMAIL'],
    [!candidate.email_business_association_pass, 'EMAIL_ASSOCIATION_UNVERIFIED'],
    [!candidate.business_identity_confirmed, 'IDENTITY_UNCONFIRMED'],
    [!candidate.business_active_pass, 'BUSINESS_NOT_ACTIVE'],
    [!candidate.email_channel_allowed, 'EMAIL_CHANNEL_BLOCKED'],
    [candidate.legacy_status_only, 'LEGACY_STATUS_ONLY'],
    [normalizedText(candidate.city) !== normalizedText(requestedCity), 'CITY_MISMATCH'],
  ];
  return checks.find(([rejected]) => rejected)?.[1];
};

const candidateRank = (candidate: Daily6CandidateForSelection, requestedCity: string): number => {
  const evidenceCount = Array.isArray(candidate.evidence_ids) ? candidate.evidence_ids.length : 0;
  return (candidate.business_active_pass ? 32 : 0)
    + (candidate.public_business_email_present ? 24 : 0)
    + (candidate.email_business_association_pass ? 24 : 0)
    + (!candidate.official_site_found ? 16 : 0)
    + (normalizedText(candidate.city) === normalizedText(requestedCity) ? 8 : 0)
    + Math.min(evidenceCount, 8);
};

export async function selectProgressiveDaily6Candidates(
  candidates: readonly Daily6CandidateForSelection[],
  requestedCity: string,
  evaluate: (candidate: Daily6CandidateForSelection) => Promise<Daily6CandidateEvaluation> | Daily6CandidateEvaluation,
): Promise<Daily6ProgressiveSelection> {
  const rejectionReasons: Record<string, number> = {};
  let cheapFilterRejected = 0;
  const survivors = candidates.filter((candidate) => {
    const reason = candidateCheapFilterReason(candidate, requestedCity);
    if (!reason) return true;
    cheapFilterRejected += 1;
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    return false;
  });
  const rankedCandidates = [...survivors].sort((left, right) => {
    const scoreDelta = candidateRank(right, requestedCity) - candidateRank(left, requestedCity);
    return scoreDelta || left.lead_id.localeCompare(right.lead_id) || left.contact_id.localeCompare(right.contact_id);
  });
  const approvedCandidates: Daily6CandidateForSelection[] = [];
  let finalistsEvaluated = 0;
  let enriched = 0;
  let rejected = 0;
  let unknown = 0;
  let blocked = 0;
  let stopReason: Daily6ProgressiveSelection['stopReason'] = 'NO_ELIGIBLE_CANDIDATES';

  for (const candidate of rankedCandidates.slice(0, DAILY6_PROGRESSIVE_LIMITS.maxFinalistsEvaluated)) {
    if (approvedCandidates.length >= DAILY6_PROGRESSIVE_LIMITS.targetApprovedPerSlot) {
      stopReason = 'TARGET_APPROVED_REACHED';
      break;
    }
    finalistsEvaluated += 1;
    enriched += 1;
    const outcome = await evaluate(candidate);
    if (outcome.status === 'APPROVED') {
      approvedCandidates.push(candidate);
      if (approvedCandidates.length >= DAILY6_PROGRESSIVE_LIMITS.targetApprovedPerSlot) {
        stopReason = 'TARGET_APPROVED_REACHED';
        break;
      }
      continue;
    }
    if (outcome.status === 'UNKNOWN') unknown += 1;
    else if (outcome.status === 'BLOCKED') blocked += 1;
    else rejected += 1;
    const reason = outcome.reason ?? outcome.status;
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    if (outcome.terminal) {
      stopReason = 'FAIL_CLOSED';
      break;
    }
  }
  if (stopReason !== 'FAIL_CLOSED' && stopReason !== 'TARGET_APPROVED_REACHED') {
    if (finalistsEvaluated >= DAILY6_PROGRESSIVE_LIMITS.maxFinalistsEvaluated) {
      stopReason = 'MAX_FINALISTS_REACHED';
    } else if (finalistsEvaluated === rankedCandidates.length) {
      stopReason = 'NO_ELIGIBLE_CANDIDATES';
    }
  }
  return {
    rankedCandidates,
    approvedCandidates,
    cheapFilterRejected,
    finalistsEvaluated,
    enriched,
    approved: approvedCandidates.length,
    rejected,
    unknown,
    blocked,
    rejectionReasons,
    stopReason,
    targetReached: approvedCandidates.length === DAILY6_PROGRESSIVE_LIMITS.targetApprovedPerSlot,
  };
}

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

  const cityContract = daily6CityContract(input.city);
  if (!cityContract) throw new Error('DAILY6_CITY_NOT_ALLOWED');
  const normalizedCity = cityContract.cityId;
  const queryCity = cityContract.queryCity;
  const batchId = `${input.date}|${input.slot}|${normalizedCity}|${input.policyVersion}`;
  await db.execute(sql`
    select lead_finder_internal.ensure_daily6_batch(
      ${batchId},${input.date}::date,${input.slot},${normalizedCity},${input.policyVersion}
    )
  `);
  const rows = await db.execute<CandidateRow>(sql`
    select * from lead_finder_internal.list_daily6_candidates(
      ${queryCity},${input.category ?? null},${DAILY6_PROGRESSIVE_LIMITS.maxDiscoveredPerSlot}
    )
  `);
  const candidates = rows.map(asCandidate);
  const internalAuth = internalAuthorization(authorization.requestId);
  const selection = await selectProgressiveDaily6Candidates(candidates, queryCity, (candidate) => {
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
    return compliance.readyToSend
      ? { status: 'APPROVED' as const }
      : { status: 'REJECTED' as const, reason: compliance.reasons.join('+') || 'COMPLIANCE_FAILED' };
  });
  const report = {
    batchId,
    discovered: candidates.length,
    cheapFilterRejected: selection.cheapFilterRejected,
    ranked: selection.rankedCandidates.length,
    finalistsEvaluated: selection.finalistsEvaluated,
    enriched: selection.enriched,
    autoApproved: selection.approved,
    rejected: selection.rejected,
    unknown: selection.unknown,
    blocked: selection.blocked,
    targetReached: selection.targetReached,
    stopReason: selection.stopReason,
    rejectionReasons: selection.rejectionReasons,
    ready: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    ambiguous: 0,
    replayed: false,
    providerCalls: 0,
  };

  // Search/approval is complete before any send gate is entered.  This keeps
  // candidate discovery progressive while preserving SEND_RETRY=0 and making
  // an ambiguous send terminal without enriching another candidate.
  for (const candidate of selection.approvedCandidates.slice(0, DAILY6_PROGRESSIVE_LIMITS.maxSendsPerSlot)) {
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
          searchSent: runtime.searchSent,
        },
      });
      if (shouldCountDaily6ProviderCall(delivery)) report.providerCalls += 1;
      report.replayed ||= delivery.replayed;
      if (delivery.state === 'DELIVERED') {
        report.sent += 1;
        report.delivered += 1;
      } else if (delivery.state === 'FAILED') {
        report.failed += 1;
      } else if (delivery.state === 'AMBIGUOUS') {
        report.ambiguous += 1;
        if (shouldStopDaily6SlotAfterDelivery(delivery.state)) break;
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
      ${batchId},${report.discovered},${report.enriched},${report.autoApproved},${report.rejected},${report.ready}
    )
  `);
  return report;
}
