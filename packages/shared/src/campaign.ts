import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CrmStage } from './crm.js';
import type { QualificationStatus } from './qualification.js';

export const campaignStates = ['RASCUNHO', 'ATIVA', 'PAUSADA', 'CANCELADA', 'CONCLUIDA'] as const;
export type CampaignState = (typeof campaignStates)[number];
export const campaignStateSchema = z.enum(campaignStates);

export const campaignVersionStates = ['RASCUNHO', 'PENDENTE_APROVACAO', 'APROVADA', 'ARQUIVADA'] as const;
export type CampaignVersionState = (typeof campaignVersionStates)[number];
export const campaignVersionStateSchema = z.enum(campaignVersionStates);

export const campaignRecipientStates = ['PENDENTE', 'ELEGIVEL', 'BLOQUEADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO', 'OPT_OUT'] as const;
export type CampaignRecipientState = (typeof campaignRecipientStates)[number];
export const campaignRecipientStateSchema = z.enum(campaignRecipientStates);

export const campaignAttemptStates = ['PENDENTE', 'APROVADA', 'BLOQUEADA', 'CANCELADA', 'CONCLUIDA', 'FALHOU'] as const;
export type CampaignAttemptState = (typeof campaignAttemptStates)[number];
export const campaignAttemptStateSchema = z.enum(campaignAttemptStates);

export const campaignChannels = ['EMAIL', 'WHATSAPP'] as const;
export type CampaignChannel = (typeof campaignChannels)[number];
export const campaignChannelSchema = z.enum(campaignChannels);
export const optOutScopes = [...campaignChannels, 'TODOS'] as const;
export type OptOutScope = (typeof optOutScopes)[number];
export const optOutScopeSchema = z.enum(optOutScopes);

const transitionGraphs = {
  campaign: {
    RASCUNHO: ['ATIVA', 'CANCELADA'], ATIVA: ['PAUSADA', 'CANCELADA', 'CONCLUIDA'],
    PAUSADA: ['ATIVA', 'CANCELADA'], CANCELADA: [], CONCLUIDA: [],
  },
  version: {
    RASCUNHO: ['PENDENTE_APROVACAO', 'ARQUIVADA'], PENDENTE_APROVACAO: ['RASCUNHO', 'APROVADA', 'ARQUIVADA'],
    APROVADA: ['ARQUIVADA'], ARQUIVADA: [],
  },
  recipient: {
    PENDENTE: ['ELEGIVEL', 'BLOQUEADO', 'CANCELADO', 'OPT_OUT'], ELEGIVEL: ['EM_ANDAMENTO', 'BLOQUEADO', 'CANCELADO', 'OPT_OUT'],
    BLOQUEADO: ['ELEGIVEL', 'CANCELADO', 'OPT_OUT'], EM_ANDAMENTO: ['CONCLUIDO', 'BLOQUEADO', 'CANCELADO', 'OPT_OUT'],
    CONCLUIDO: [], CANCELADO: [], OPT_OUT: [],
  },
  attempt: {
    PENDENTE: ['APROVADA', 'BLOQUEADA', 'CANCELADA'], APROVADA: ['CONCLUIDA', 'FALHOU', 'BLOQUEADA', 'CANCELADA'],
    BLOQUEADA: [], CANCELADA: [], CONCLUIDA: [], FALHOU: [],
  },
} as const;

export const campaignTransitionGraph: Readonly<Record<CampaignState, readonly CampaignState[]>> = transitionGraphs.campaign;
export const campaignVersionTransitionGraph: Readonly<Record<CampaignVersionState, readonly CampaignVersionState[]>> = transitionGraphs.version;
export const campaignRecipientTransitionGraph: Readonly<Record<CampaignRecipientState, readonly CampaignRecipientState[]>> = transitionGraphs.recipient;
export const campaignAttemptTransitionGraph: Readonly<Record<CampaignAttemptState, readonly CampaignAttemptState[]>> = transitionGraphs.attempt;

export const campaignDomainErrorCodes = ['INVALID_TRANSITION', 'INELIGIBLE', 'INVALID_TEMPLATE', 'MISSING_VARIABLE', 'UNKNOWN_VARIABLE'] as const;
export type CampaignDomainErrorCode = (typeof campaignDomainErrorCodes)[number];
export class CampaignDomainError extends Error {
  readonly name = 'CampaignDomainError';
  constructor(message: string, readonly code: CampaignDomainErrorCode) { super(message); Object.setPrototypeOf(this, new.target.prototype); }
}

const canTransition = <T extends string>(graph: Readonly<Record<T, readonly T[]>>, from: T, to: T) => graph[from].includes(to);
export const canTransitionCampaign = (from: CampaignState, to: CampaignState) => canTransition(campaignTransitionGraph, from, to);
export const canTransitionCampaignVersion = (from: CampaignVersionState, to: CampaignVersionState) => canTransition(campaignVersionTransitionGraph, from, to);
export const canTransitionCampaignRecipient = (from: CampaignRecipientState, to: CampaignRecipientState) => canTransition(campaignRecipientTransitionGraph, from, to);
export const canTransitionCampaignAttempt = (from: CampaignAttemptState, to: CampaignAttemptState) => canTransition(campaignAttemptTransitionGraph, from, to);
export function assertCampaignTransition<T extends string>(graph: Readonly<Record<T, readonly T[]>>, from: T, to: T): void {
  if (!canTransition(graph, from, to)) throw new CampaignDomainError(`Transition from ${from} to ${to} is not allowed`, 'INVALID_TRANSITION');
}

export const pauseCampaign = (state: CampaignState): CampaignState => { assertCampaignTransition(campaignTransitionGraph, state, 'PAUSADA'); return 'PAUSADA'; };
export const resumeCampaign = (state: CampaignState): CampaignState => { assertCampaignTransition(campaignTransitionGraph, state, 'ATIVA'); return 'ATIVA'; };
export const cancelCampaign = (state: CampaignState): CampaignState => { assertCampaignTransition(campaignTransitionGraph, state, 'CANCELADA'); return 'CANCELADA'; };

export interface CampaignEligibilityCandidate {
  qualificationStatus: QualificationStatus;
  crmStage: CrmStage;
  isBlocked: boolean;
  doNotContact: boolean;
  contact: { channel: CampaignChannel; isValid: boolean; verifiedAt: Date | string | null };
  optOuts: readonly OptOutScope[];
  isFirstContact: boolean;
  firstContactApproval?: { approvedBy: string; approvedAt: Date | string } | null;
}
export const campaignIneligibilityReasons = [
  'QUALIFICATION_REQUIRED', 'CONTACT_NOT_VERIFIED', 'LEAD_DISCARDED', 'LEAD_BLOCKED',
  'DO_NOT_CONTACT', 'CRM_DO_NOT_CONTACT', 'CHANNEL_OPT_OUT', 'FIRST_CONTACT_APPROVAL_REQUIRED',
] as const;
export type CampaignIneligibilityReason = (typeof campaignIneligibilityReasons)[number];
export function evaluateCampaignEligibility(candidate: CampaignEligibilityCandidate): { eligible: true } | { eligible: false; reason: CampaignIneligibilityReason } {
  if (candidate.qualificationStatus === 'DESCARTADO') return { eligible: false, reason: 'LEAD_DISCARDED' };
  if (candidate.qualificationStatus !== 'SEM_SITE_CONFIRMADO') return { eligible: false, reason: 'QUALIFICATION_REQUIRED' };
  if (!candidate.contact.isValid || candidate.contact.verifiedAt === null) return { eligible: false, reason: 'CONTACT_NOT_VERIFIED' };
  if (candidate.isBlocked) return { eligible: false, reason: 'LEAD_BLOCKED' };
  if (candidate.doNotContact) return { eligible: false, reason: 'DO_NOT_CONTACT' };
  if (candidate.crmStage === 'NAO_CONTATAR') return { eligible: false, reason: 'CRM_DO_NOT_CONTACT' };
  if (candidate.optOuts.includes('TODOS') || candidate.optOuts.includes(candidate.contact.channel)) return { eligible: false, reason: 'CHANNEL_OPT_OUT' };
  const approval = candidate.firstContactApproval;
  if (candidate.isFirstContact && (!approval || !approval.approvedBy.trim() || !Number.isFinite(new Date(approval.approvedAt).getTime()))) return { eligible: false, reason: 'FIRST_CONTACT_APPROVAL_REQUIRED' };
  return { eligible: true };
}

const variableName = /^[A-Za-z][A-Za-z0-9_]*$/;
const reservedVariableNames = new Set(['__proto__', 'prototype', 'constructor']);
const placeholder = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;
const unsafeTemplate = /<\s*\/?\s*[A-Za-z][^>]*>|javascript\s*:|on[A-Za-z]+\s*=|{{{?|}}}?/i;
const isAllowedVariableName = (name: string) => variableName.test(name) && !reservedVariableNames.has(name);
export interface CampaignTemplate { content: string; allowedVariables: readonly string[] }
export function defineCampaignTemplate(content: string, allowedVariables: readonly string[]): CampaignTemplate {
  const unique = [...new Set(allowedVariables)];
  if (!content || unique.some((name) => !isAllowedVariableName(name))) throw new CampaignDomainError('Invalid template definition', 'INVALID_TEMPLATE');
  validateTemplate(content, unique);
  return { content, allowedVariables: unique };
}
export function templateVariables(content: string): string[] {
  const variables: string[] = []; let match: RegExpExecArray | null;
  placeholder.lastIndex = 0; while ((match = placeholder.exec(content))) variables.push(match[1]!);
  return [...new Set(variables)];
}
export function validateTemplate(content: string, allowedVariables: readonly string[]): void {
  const stripped = content.replace(placeholder, '');
  if (unsafeTemplate.test(stripped) || /[{}]/.test(stripped)) throw new CampaignDomainError('Malformed or unsafe template', 'INVALID_TEMPLATE');
  for (const name of templateVariables(content)) if (!isAllowedVariableName(name) || !allowedVariables.includes(name)) throw new CampaignDomainError(`Unknown template variable: ${name}`, 'UNKNOWN_VARIABLE');
}
export function renderCampaignTemplate(template: CampaignTemplate, values: Readonly<Record<string, string>>): string {
  validateTemplate(template.content, template.allowedVariables);
  for (const key of Object.keys(values)) if (!template.allowedVariables.includes(key)) throw new CampaignDomainError(`Unknown template variable: ${key}`, 'UNKNOWN_VARIABLE');
  for (const name of templateVariables(template.content)) if (!Object.hasOwn(values, name)) throw new CampaignDomainError(`Missing template variable: ${name}`, 'MISSING_VARIABLE');
  for (const value of Object.values(values)) if (unsafeTemplate.test(value)) throw new CampaignDomainError('Unsafe template variable value', 'INVALID_TEMPLATE');
  placeholder.lastIndex = 0;
  return template.content.replace(placeholder, (_match, name: string) => values[name]!);
}

const normalizeFingerprintPart = (value: string) => value.normalize('NFKC').replace(/\r\n?/g, '\n').trim().replace(/[ \t]+/g, ' ');
export function campaignFingerprint(parts: readonly string[]): string {
  const normalized = parts.map(normalizeFingerprintPart);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
