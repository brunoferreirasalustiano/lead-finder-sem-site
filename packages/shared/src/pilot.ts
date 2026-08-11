import { z } from 'zod';
import { entityIdSchema, expectedVersionSchema, idempotencyKeySchema, utcDateTimeSchema } from './crm.js';

export const pilotRunStatuses = ['DRAFT', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export const pilotRunStatusSchema = z.enum(pilotRunStatuses);
export type PilotRunStatus = z.infer<typeof pilotRunStatusSchema>;

export const pilotRunTransitionGraph: Readonly<Record<PilotRunStatus, readonly PilotRunStatus[]>> = {
  DRAFT: ['READY'], READY: ['RUNNING', 'CANCELLED'], RUNNING: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};
export const canTransitionPilotRun = (from: PilotRunStatus, to: PilotRunStatus) =>
  pilotRunTransitionGraph[from].includes(to);

export const pilotErrorCodes = ['INVALID_TRANSITION', 'INVALID_RESULT_TRANSITION', 'READINESS_FAILED'] as const;
export type PilotErrorCode = (typeof pilotErrorCodes)[number];
export class PilotDomainError extends Error {
  readonly name = 'PilotDomainError';
  constructor(message: string, readonly code: PilotErrorCode) { super(message); Object.setPrototypeOf(this, new.target.prototype); }
}
export function assertPilotRunTransition(from: PilotRunStatus, to: PilotRunStatus): void {
  if (!canTransitionPilotRun(from, to)) throw new PilotDomainError(`Pilot transition from ${from} to ${to} is not allowed`, 'INVALID_TRANSITION');
}

const nonBlank = (max: number) => z.string().trim().min(1).max(max);
const commandFields = { expectedVersion: expectedVersionSchema, idempotencyKey: idempotencyKeySchema };
export const pilotRunCreateSchema = z.object({
  name: nonBlank(200), region: nonBlank(100), category: nonBlank(100),
  targetLeadCount: z.number().int().min(1).max(30), idempotencyKey: idempotencyKeySchema,
}).strict();
export const pilotRunStatusChangeSchema = z.object({ ...commandFields, status: pilotRunStatusSchema }).strict();
export const pilotRunListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: pilotRunStatusSchema.optional(),
}).strict();

export const pilotLeadSources = ['SYNTHETIC', 'MANUAL_IMPORT', 'COLLECTION', 'AUTOMATED_DISCOVERY'] as const;
export const pilotLeadSourceSchema = z.enum(pilotLeadSources);
export type PilotLeadSource = z.infer<typeof pilotLeadSourceSchema>;
export const pilotLeadAddSchema = z.object({ ...commandFields, leadId: entityIdSchema, source: pilotLeadSourceSchema }).strict();

export const pilotReviewDecisions = ['APPROVED', 'REJECTED', 'NEEDS_REVIEW'] as const;
export const pilotReviewDecisionSchema = z.enum(pilotReviewDecisions);
export type PilotReviewDecision = z.infer<typeof pilotReviewDecisionSchema>;
export const pilotReviewSchema = z.object({
  ...commandFields, decision: pilotReviewDecisionSchema, reason: nonBlank(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === 'REJECTED' && !value.reason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Reason is required when rejecting a lead' });
});

export const manualContactChannels = ['WHATSAPP_MANUAL', 'EMAIL_MANUAL', 'PHONE', 'OTHER'] as const;
export const manualContactChannelSchema = z.enum(manualContactChannels);
export type ManualContactChannel = z.infer<typeof manualContactChannelSchema>;
export const pilotManualContactSchema = z.object({
  contactId: entityIdSchema, channel: manualContactChannelSchema, approvedTemplateVersionId: nonBlank(200),
  observation: nonBlank(1000).optional(), ...commandFields,
}).strict();

export const pilotCommercialResults = [
  'NOT_CONTACTED', 'CONTACTED', 'NO_RESPONSE', 'RESPONDED', 'INTERESTED', 'MEETING_REQUESTED',
  'PROPOSAL_REQUESTED', 'NOT_INTERESTED', 'INVALID_CONTACT', 'DO_NOT_CONTACT', 'CONVERTED',
] as const;
export const pilotCommercialResultSchema = z.enum(pilotCommercialResults);
export type PilotCommercialResult = z.infer<typeof pilotCommercialResultSchema>;
export const pilotResultTransitionGraph: Readonly<Record<PilotCommercialResult, readonly PilotCommercialResult[]>> = {
  NOT_CONTACTED: ['CONTACTED', 'INVALID_CONTACT', 'DO_NOT_CONTACT'],
  CONTACTED: ['NO_RESPONSE', 'RESPONDED', 'INVALID_CONTACT', 'DO_NOT_CONTACT'],
  NO_RESPONSE: ['CONTACTED', 'RESPONDED', 'INVALID_CONTACT', 'DO_NOT_CONTACT'],
  RESPONDED: ['INTERESTED', 'NOT_INTERESTED', 'MEETING_REQUESTED', 'PROPOSAL_REQUESTED', 'DO_NOT_CONTACT'],
  INTERESTED: ['MEETING_REQUESTED', 'PROPOSAL_REQUESTED', 'NOT_INTERESTED', 'DO_NOT_CONTACT'],
  MEETING_REQUESTED: ['PROPOSAL_REQUESTED', 'NOT_INTERESTED', 'DO_NOT_CONTACT'],
  PROPOSAL_REQUESTED: ['CONVERTED', 'NOT_INTERESTED', 'DO_NOT_CONTACT'],
  NOT_INTERESTED: ['DO_NOT_CONTACT'], INVALID_CONTACT: [], DO_NOT_CONTACT: [], CONVERTED: [],
};
export const canTransitionPilotResult = (from: PilotCommercialResult, to: PilotCommercialResult) =>
  pilotResultTransitionGraph[from].includes(to);
export function assertPilotResultTransition(from: PilotCommercialResult, to: PilotCommercialResult, humanConfirmedConversion = false): void {
  if (!canTransitionPilotResult(from, to) || (to === 'CONVERTED' && !humanConfirmedConversion))
    throw new PilotDomainError(`Pilot result transition from ${from} to ${to} is not allowed`, 'INVALID_RESULT_TRANSITION');
}
export const pilotResultSchema = z.object({
  ...commandFields, result: pilotCommercialResultSchema, channel: manualContactChannelSchema.optional(),
  contactId: entityIdSchema.optional(),
  reason: nonBlank(1000).optional(), observation: nonBlank(1000).optional(), nextAction: nonBlank(500).optional(),
  humanConfirmedConversion: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  if (value.result === 'CONVERTED' && value.humanConfirmedConversion !== true)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['humanConfirmedConversion'], message: 'Human confirmation is required for conversion' });
  if ((value.result === 'DO_NOT_CONTACT' || value.result === 'INVALID_CONTACT') && !value.reason)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Reason is required for this result' });
  if (value.result === 'INVALID_CONTACT' && !value.contactId)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['contactId'], message: 'Contact id is required for an invalid contact result' });
  if (value.result !== 'INVALID_CONTACT' && value.contactId)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['contactId'], message: 'Contact id is only accepted for an invalid contact result' });
});

export const pilotReadinessFailureReasons = [
  'INVALID_RUN', 'NO_LEADS', 'TARGET_EXCEEDED', 'REVIEW_NOT_APPROVED', 'QUALIFICATION_REQUIRED',
  'EVIDENCE_REQUIRED', 'INVALID_CONTACT', 'LEAD_BLOCKED', 'DO_NOT_CONTACT', 'ACTIVE_OPT_OUT', 'CRM_DO_NOT_CONTACT',
  'SHADOW_MODE_DISABLED', 'CAMPAIGN_NOT_SIMULATED', 'REAL_PROVIDER_CONFIGURED', 'COLLECTION_EGRESS_ENABLED',
  'VERSION_INCONSISTENCY',
] as const;
export type PilotReadinessFailureReason = (typeof pilotReadinessFailureReasons)[number];
export interface PilotReadinessLead {
  reviewDecision: PilotReviewDecision | null; qualificationStatus: string;
  websiteStatus?: 'UNKNOWN' | 'OFFICIAL_SITE_FOUND' | 'NO_OFFICIAL_SITE_CONFIRMED';
  hasRequiredEvidence: boolean;
  hasValidVerifiedContact: boolean;
  isBlocked: boolean; doNotContact: boolean; hasActiveOptOut: boolean; crmStage: string; versionConsistent: boolean;
}
export interface PilotReadinessInput {
  name: string; region: string; category: string; targetLeadCount: number; leads: readonly PilotReadinessLead[];
  shadowModeEnabled: boolean; campaignSimulated: boolean; realProviderConfigured: boolean;
  collectionEgressEnabled: boolean; versionConsistent: boolean;
}
export interface PilotReadiness { ready: boolean; reasons: readonly PilotReadinessFailureReason[] }
export function evaluatePilotReadiness(input: PilotReadinessInput): PilotReadiness {
  const reasons = new Set<PilotReadinessFailureReason>();
  if (!input.name.trim() || !input.region.trim() || !input.category.trim() || !Number.isInteger(input.targetLeadCount) || input.targetLeadCount < 1 || input.targetLeadCount > 30) reasons.add('INVALID_RUN');
  if (input.leads.length === 0) reasons.add('NO_LEADS');
  if (input.leads.length > input.targetLeadCount) reasons.add('TARGET_EXCEEDED');
  for (const lead of input.leads) {
    if (lead.reviewDecision !== 'APPROVED') reasons.add('REVIEW_NOT_APPROVED');
    if (lead.qualificationStatus !== 'SEM_SITE_CONFIRMADO' || lead.websiteStatus !== 'NO_OFFICIAL_SITE_CONFIRMED') reasons.add('QUALIFICATION_REQUIRED');
    if (!lead.hasRequiredEvidence) reasons.add('EVIDENCE_REQUIRED');
    if (!lead.hasValidVerifiedContact) reasons.add('INVALID_CONTACT');
    if (lead.isBlocked) reasons.add('LEAD_BLOCKED');
    if (lead.doNotContact) reasons.add('DO_NOT_CONTACT');
    if (lead.hasActiveOptOut) reasons.add('ACTIVE_OPT_OUT');
    if (lead.crmStage === 'NAO_CONTATAR') reasons.add('CRM_DO_NOT_CONTACT');
    if (!lead.versionConsistent) reasons.add('VERSION_INCONSISTENCY');
  }
  if (!input.shadowModeEnabled) reasons.add('SHADOW_MODE_DISABLED');
  if (!input.campaignSimulated) reasons.add('CAMPAIGN_NOT_SIMULATED');
  if (input.realProviderConfigured) reasons.add('REAL_PROVIDER_CONFIGURED');
  if (input.collectionEgressEnabled) reasons.add('COLLECTION_EGRESS_ENABLED');
  if (!input.versionConsistent) reasons.add('VERSION_INCONSISTENCY');
  return { ready: reasons.size === 0, reasons: [...reasons] };
}

const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const pilotMetricCountKeys = [
  'totalAssociated', 'totalApproved', 'totalRejected', 'totalNeedsReview', 'totalWithoutSiteConfirmed',
  'totalValidContacts', 'totalManualContacts', 'totalResponses', 'totalInterested', 'totalMeetingRequested',
  'totalProposalRequested', 'totalConversions', 'totalOptOuts', 'totalInvalidContacts', 'totalBlocked', 'totalIncidents',
] as const;
export type PilotMetricCounts = Record<(typeof pilotMetricCountKeys)[number], number>;
const metricCountShape = Object.fromEntries(pilotMetricCountKeys.map((key) => [key, countSchema])) as { [K in keyof PilotMetricCounts]: typeof countSchema };
export const pilotMetricCountsSchema = z.object(metricCountShape).strict();
export const pilotMetricPeriodSchema = z.object({ from: utcDateTimeSchema, to: utcDateTimeSchema }).strict().refine(
  ({ from, to }) => from <= to, { path: ['to'], message: 'to must be on or after from' },
);
export const pilotMetricSnapshotInputSchema = z.object({ period: pilotMetricPeriodSchema, counts: pilotMetricCountsSchema }).strict();
export type PilotMetricRate = Readonly<{ numerator: number; denominator: number; value: number | null }>;
export type PilotMetricSnapshot = Readonly<{
  period: z.infer<typeof pilotMetricPeriodSchema>; counts: PilotMetricCounts; rates: Readonly<{
    approval: PilotMetricRate; withoutSiteConfirmation: PilotMetricRate; validContact: PilotMetricRate;
    manualContact: PilotMetricRate; response: PilotMetricRate; interest: PilotMetricRate;
    proposal: PilotMetricRate; conversion: PilotMetricRate;
  }>;
}>;
const rate = (numerator: number, denominator: number): PilotMetricRate => ({
  numerator, denominator, value: denominator === 0 ? null : Math.min(1, numerator / denominator),
});
export function createPilotMetricSnapshot(input: unknown): PilotMetricSnapshot {
  const { period, counts } = pilotMetricSnapshotInputSchema.parse(input);
  return { period, counts, rates: {
    approval: rate(counts.totalApproved, counts.totalAssociated),
    withoutSiteConfirmation: rate(counts.totalWithoutSiteConfirmed, counts.totalAssociated),
    validContact: rate(counts.totalValidContacts, counts.totalAssociated),
    manualContact: rate(counts.totalManualContacts, counts.totalApproved),
    response: rate(counts.totalResponses, counts.totalManualContacts),
    interest: rate(counts.totalInterested, counts.totalResponses),
    proposal: rate(counts.totalProposalRequested, counts.totalInterested),
    conversion: rate(counts.totalConversions, counts.totalProposalRequested),
  } };
}

export type PilotRunCreateInput = z.infer<typeof pilotRunCreateSchema>;
export type PilotRunStatusChangeInput = z.infer<typeof pilotRunStatusChangeSchema>;
export type PilotLeadAddInput = z.infer<typeof pilotLeadAddSchema>;
export type PilotReviewInput = z.infer<typeof pilotReviewSchema>;
export type PilotManualContactInput = z.infer<typeof pilotManualContactSchema>;
export type PilotResultInput = z.infer<typeof pilotResultSchema>;
