import {
  evaluateCommunicationVariant,
  type CommunicationChannel,
  type CommunicationEvaluation,
  type CommunicationVariant,
  type SourceType,
} from './communication-lab.js';

export const diagnosticEvidenceStates = ['VERIFIED', 'UNVERIFIED', 'NOT_APPLICABLE'] as const;
export type DiagnosticEvidenceState = (typeof diagnosticEvidenceStates)[number];

export interface CommunicationEvidenceContext {
  diagnosticEvidence: DiagnosticEvidenceState;
}

const allowedSourcesByChannel: Readonly<Record<CommunicationChannel, ReadonlySet<SourceType>>> = {
  EMAIL: new Set(['OFFICIAL_WEBSITE', 'PUBLIC_BUSINESS_DIRECTORY', 'DIRECTLY_PROVIDED']),
  CONTACT_FORM: new Set(['OFFICIAL_CONTACT_FORM']),
  BUSINESS_DM: new Set(['OFFICIAL_BUSINESS_PROFILE']),
  WHATSAPP_OPT_IN: new Set(['DIRECTLY_PROVIDED']),
};

export function communicationRequiresDiagnosticEvidence(variant: CommunicationVariant): boolean {
  return variant.opening === 'DIAGNOSIS_FIRST' || variant.personalization === 'DIAGNOSIS';
}

export function validateCommunicationEvidence(
  variant: CommunicationVariant,
  context: CommunicationEvidenceContext,
): { codes: string[]; warnings: string[] } {
  const codes: string[] = [];
  const warnings: string[] = [];

  if (!allowedSourcesByChannel[variant.channel].has(variant.sourceType)) {
    codes.push('CHANNEL_SOURCE_MISMATCH');
  }

  const requiresDiagnosticEvidence = communicationRequiresDiagnosticEvidence(variant);
  if (requiresDiagnosticEvidence && context.diagnosticEvidence !== 'VERIFIED') {
    codes.push('DIAGNOSTIC_EVIDENCE_REQUIRED');
  }
  if (!requiresDiagnosticEvidence && context.diagnosticEvidence === 'UNVERIFIED') {
    warnings.push('UNVERIFIED_DIAGNOSTIC_NOT_USED');
  }
  if (!requiresDiagnosticEvidence && context.diagnosticEvidence === 'VERIFIED') {
    warnings.push('DIAGNOSTIC_EVIDENCE_AVAILABLE_BUT_NOT_USED');
  }

  return {
    codes: [...new Set(codes)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

export function evaluateGuardedCommunicationVariant(
  variant: CommunicationVariant,
  context: CommunicationEvidenceContext,
): CommunicationEvaluation {
  const base = evaluateCommunicationVariant(variant);
  const evidence = validateCommunicationEvidence(variant, context);
  const codes = [...new Set([...base.codes, ...evidence.codes])].sort();
  const warnings = [...new Set([...base.warnings, ...evidence.warnings])].sort();
  const eligible = codes.length === 0;

  return {
    ...base,
    eligible,
    score: eligible ? base.score : 0,
    codes,
    warnings,
  };
}
