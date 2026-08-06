import { domainToASCII } from 'node:url';

export const technicalEmailStates = ['VALID', 'INVALID', 'UNCERTAIN', 'BLOCKED'] as const;
export type TechnicalEmailState = (typeof technicalEmailStates)[number];

export const emailDomainExistence = ['YES', 'NO', 'UNKNOWN'] as const;
export type EmailDomainExistence = (typeof emailDomainExistence)[number];

export const emailMxStatuses = ['PRESENT', 'ABSENT', 'UNKNOWN'] as const;
export type EmailMxStatus = (typeof emailMxStatuses)[number];

export const emailPublicBusinessProvenance = ['CONFIRMED', 'NOT_CONFIRMED', 'UNKNOWN'] as const;
export type EmailPublicBusinessProvenance = (typeof emailPublicBusinessProvenance)[number];

export const technicalEmailSafetySignals = [
  'HARD_BOUNCE',
  'OPT_OUT',
  'COMPLAINT',
  'DO_NOT_CONTACT',
  'NAO_CONTATAR',
  'BLOCKED',
] as const;
export type TechnicalEmailSafetySignal = (typeof technicalEmailSafetySignals)[number];

export const technicalEmailReasons = [
  'VALIDATED',
  'INVALID_INPUT',
  'INVALID_SYNTAX',
  'DOMAIN_NOT_FOUND',
  'MX_NOT_FOUND',
  'DNS_TIMEOUT',
  'DNS_RESOLVER_ERROR',
  'DNS_RESPONSE_MALFORMED',
  'DNS_RESULT_UNKNOWN',
  'PUBLIC_BUSINESS_PROVENANCE_UNCERTAIN',
  'SUPPRESSION_EVIDENCE_UNKNOWN',
  'HARD_BOUNCE',
  'OPT_OUT',
  'COMPLAINT',
  'DO_NOT_CONTACT',
  'NAO_CONTATAR',
  'BLOCKED',
] as const;
export type TechnicalEmailReason = (typeof technicalEmailReasons)[number];

export type SuppressionSignal = boolean | 'UNKNOWN';

export interface EmailSuppressionEvidence {
  hardBounce: SuppressionSignal;
  optOut: SuppressionSignal;
  complaint: SuppressionSignal;
  doNotContact: SuppressionSignal;
  naoContatar: SuppressionSignal;
  blocked: SuppressionSignal;
}

export interface EmailDomainResolution {
  domainExists: EmailDomainExistence;
  mx: EmailMxStatus;
}

export interface EmailDomainResolver {
  resolve(domain: string, options: { timeoutMs: number }): Promise<unknown>;
}

export interface TechnicalEmailEvaluationInput {
  email: unknown;
  domainResolution?: unknown;
  publicBusinessProvenance: unknown;
  suppression: unknown;
}

export interface EmailSyntaxInspection {
  valid: boolean;
  domain: string | null;
  issue: 'INVALID_INPUT' | 'INVALID_SYNTAX' | null;
}

export interface TechnicalEmailQualificationResult {
  state: TechnicalEmailState;
  domain: string | null;
  syntax: 'VALID' | 'INVALID' | 'UNKNOWN';
  domainExists: EmailDomainExistence;
  mx: EmailMxStatus;
  publicBusinessProvenance: EmailPublicBusinessProvenance;
  blockedBy: readonly TechnicalEmailSafetySignal[];
  reason: TechnicalEmailReason;
}

export interface TechnicalEmailResolverOptions {
  timeoutMs?: number;
}

const DEFAULT_RESOLVER_TIMEOUT_MS = 2_000;
const MAX_RESOLVER_TIMEOUT_MS = 10_000;
const MAX_EMAIL_LENGTH = 254;
const MAX_DOMAIN_LENGTH = 253;

const isOneOf = <T extends readonly string[]>(value: unknown, values: T): value is T[number] =>
  typeof value === 'string' && values.includes(value);

const hasControlOrWhitespace = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x20 || codePoint === 0x7f;
});

const isValidLocalPart = (local: string): boolean => {
  if (local.length === 0 || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  for (const character of local) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x21 || codePoint > 0x7e || '()<>[]:;,@"'.includes(character)) return false;
  }
  return true;
};

const normalizeDomain = (rawDomain: string): string | null => {
  if (rawDomain.length === 0 || rawDomain.length > MAX_DOMAIN_LENGTH || hasControlOrWhitespace(rawDomain)) return null;
  let asciiDomain: string;
  try {
    asciiDomain = domainToASCII(rawDomain).toLowerCase();
  } catch {
    return null;
  }
  if (asciiDomain.length === 0 || asciiDomain.length > MAX_DOMAIN_LENGTH || !asciiDomain.includes('.')) return null;
  const labels = asciiDomain.split('.');
  if (labels.some((label) => label.length === 0 || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return null;
  if (labels.some((label) => [...label].some((character) => !/[a-z0-9-]/u.test(character)))) return null;
  return asciiDomain;
};

/** Pure syntax and domain normalization. It never returns the complete address. */
export function inspectEmailSyntax(value: unknown): EmailSyntaxInspection {
  if (typeof value !== 'string') return { valid: false, domain: null, issue: 'INVALID_INPUT' };
  const email = value.trim();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || hasControlOrWhitespace(email)) {
    return { valid: false, domain: null, issue: 'INVALID_SYNTAX' };
  }
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) {
    return { valid: false, domain: null, issue: 'INVALID_SYNTAX' };
  }
  const local = email.slice(0, at);
  const domain = normalizeDomain(email.slice(at + 1));
  if (!isValidLocalPart(local) || domain === null) return { valid: false, domain, issue: 'INVALID_SYNTAX' };
  return { valid: true, domain, issue: null };
}

const unknownResolution: EmailDomainResolution = { domainExists: 'UNKNOWN', mx: 'UNKNOWN' };

const normalizeDomainResolution = (value: unknown): { value: EmailDomainResolution; malformed: boolean } => {
  if (value === undefined) return { value: unknownResolution, malformed: false };
  if (typeof value !== 'object' || value === null) return { value: unknownResolution, malformed: true };
  const candidate = value as Record<string, unknown>;
  const domainExists = isOneOf(candidate.domainExists, emailDomainExistence) ? candidate.domainExists : null;
  const mx = isOneOf(candidate.mx, emailMxStatuses) ? candidate.mx : null;
  if (domainExists === null || mx === null) return { value: unknownResolution, malformed: true };
  return { value: { domainExists, mx }, malformed: false };
};

const normalizeProvenance = (value: unknown): EmailPublicBusinessProvenance =>
  isOneOf(value, emailPublicBusinessProvenance) ? value : 'UNKNOWN';

const suppressionKeys = [
  ['hardBounce', 'HARD_BOUNCE'],
  ['optOut', 'OPT_OUT'],
  ['complaint', 'COMPLAINT'],
  ['doNotContact', 'DO_NOT_CONTACT'],
  ['naoContatar', 'NAO_CONTATAR'],
  ['blocked', 'BLOCKED'],
] as const;

const normalizeSuppression = (value: unknown): { values: EmailSuppressionEvidence; malformed: boolean } => {
  const candidate = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  let malformed = typeof value !== 'object' || value === null;
  const values = {} as EmailSuppressionEvidence;
  for (const [key] of suppressionKeys) {
    const signal = candidate[key];
    if (typeof signal === 'boolean' || signal === 'UNKNOWN') values[key] = signal;
    else {
      values[key] = 'UNKNOWN';
      malformed = true;
    }
  }
  return { values, malformed };
};

const blockedReasonForSignal: Record<TechnicalEmailSafetySignal, TechnicalEmailReason> = {
  HARD_BOUNCE: 'HARD_BOUNCE',
  OPT_OUT: 'OPT_OUT',
  COMPLAINT: 'COMPLAINT',
  DO_NOT_CONTACT: 'DO_NOT_CONTACT',
  NAO_CONTATAR: 'NAO_CONTATAR',
  BLOCKED: 'BLOCKED',
};

const classifyUncertain = (
  syntax: EmailSyntaxInspection,
  resolution: EmailDomainResolution,
  provenance: EmailPublicBusinessProvenance,
  blockedBy: readonly TechnicalEmailSafetySignal[],
  reason: TechnicalEmailReason,
): TechnicalEmailQualificationResult => ({
  state: 'UNCERTAIN',
  domain: syntax.domain,
  syntax: syntax.issue === 'INVALID_INPUT' ? 'UNKNOWN' : syntax.valid ? 'VALID' : 'INVALID',
  domainExists: resolution.domainExists,
  mx: resolution.mx,
  publicBusinessProvenance: provenance,
  blockedBy,
  reason,
});

export function classifyTechnicalEmail(input: TechnicalEmailEvaluationInput, resolverIssue?: TechnicalEmailReason): TechnicalEmailQualificationResult {
  const syntax = inspectEmailSyntax(input.email);
  const resolutionResult = normalizeDomainResolution(input.domainResolution);
  const provenance = normalizeProvenance(input.publicBusinessProvenance);
  const suppressionResult = normalizeSuppression(input.suppression);
  const blockedBy = suppressionKeys
    .filter(([key]) => suppressionResult.values[key] === true)
    .map(([, signal]) => signal);

  if (blockedBy.length > 0) {
    const firstSignal = blockedBy[0];
    return {
      state: 'BLOCKED',
      domain: syntax.domain,
      syntax: syntax.issue === 'INVALID_INPUT' ? 'UNKNOWN' : syntax.valid ? 'VALID' : 'INVALID',
      domainExists: resolutionResult.value.domainExists,
      mx: resolutionResult.value.mx,
      publicBusinessProvenance: provenance,
      blockedBy,
      reason: firstSignal === undefined ? 'BLOCKED' : blockedReasonForSignal[firstSignal],
    };
  }

  if (syntax.issue === 'INVALID_INPUT') return classifyUncertain(syntax, resolutionResult.value, provenance, blockedBy, 'INVALID_INPUT');
  if (!syntax.valid) return {
    state: 'INVALID',
    domain: syntax.domain,
    syntax: 'INVALID',
    domainExists: resolutionResult.value.domainExists,
    mx: resolutionResult.value.mx,
    publicBusinessProvenance: provenance,
    blockedBy,
    reason: 'INVALID_SYNTAX',
  };
  if (resolutionResult.value.domainExists === 'NO') return {
    state: 'INVALID', domain: syntax.domain, syntax: 'VALID', domainExists: 'NO', mx: resolutionResult.value.mx,
    publicBusinessProvenance: provenance, blockedBy, reason: 'DOMAIN_NOT_FOUND',
  };
  if (resolutionResult.value.mx === 'ABSENT') return {
    state: 'INVALID', domain: syntax.domain, syntax: 'VALID', domainExists: resolutionResult.value.domainExists, mx: 'ABSENT',
    publicBusinessProvenance: provenance, blockedBy, reason: 'MX_NOT_FOUND',
  };
  if (resolverIssue !== undefined) return classifyUncertain(syntax, resolutionResult.value, provenance, blockedBy, resolverIssue);
  if (resolutionResult.malformed) return classifyUncertain(syntax, resolutionResult.value, provenance, blockedBy, 'DNS_RESPONSE_MALFORMED');
  if (resolutionResult.value.domainExists === 'UNKNOWN' || resolutionResult.value.mx === 'UNKNOWN') {
    return classifyUncertain(syntax, resolutionResult.value, provenance, blockedBy, 'DNS_RESULT_UNKNOWN');
  }
  if (suppressionResult.malformed || Object.values(suppressionResult.values).some((value) => value === 'UNKNOWN')) {
    return classifyUncertain(syntax, resolutionResult.value, provenance, blockedBy, 'SUPPRESSION_EVIDENCE_UNKNOWN');
  }
  if (provenance !== 'CONFIRMED') return classifyUncertain(syntax, resolutionResult.value, provenance, blockedBy, 'PUBLIC_BUSINESS_PROVENANCE_UNCERTAIN');

  return {
    state: 'VALID', domain: syntax.domain, syntax: 'VALID', domainExists: 'YES', mx: 'PRESENT',
    publicBusinessProvenance: 'CONFIRMED', blockedBy, reason: 'VALIDATED',
  };
}

const normalizeTimeout = (timeoutMs: number | undefined): number | null => {
  const value = timeoutMs ?? DEFAULT_RESOLVER_TIMEOUT_MS;
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_RESOLVER_TIMEOUT_MS ? value : null;
};

const resolveWithTimeout = async (resolver: EmailDomainResolver, domain: string, timeoutMs: number): Promise<{ value: unknown; issue?: TechnicalEmailReason }> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ value: unknown; issue: TechnicalEmailReason }>((resolve) => {
    timer = setTimeout(() => resolve({ value: unknownResolution, issue: 'DNS_TIMEOUT' }), timeoutMs);
  });
  const resolution = Promise.resolve()
    .then(() => resolver.resolve(domain, { timeoutMs }))
    .then((value) => ({ value }))
    .catch(() => ({ value: unknownResolution, issue: 'DNS_RESOLVER_ERROR' as const }));
  const result = await Promise.race([resolution, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
};

export async function evaluateTechnicalEmail(
  input: TechnicalEmailEvaluationInput,
  resolver?: EmailDomainResolver,
  options: TechnicalEmailResolverOptions = {},
): Promise<TechnicalEmailQualificationResult> {
  const syntax = inspectEmailSyntax(input.email);
  if (!syntax.valid || syntax.domain === null) return classifyTechnicalEmail(input);
  if (resolver === undefined) return classifyTechnicalEmail(input, 'DNS_RESULT_UNKNOWN');
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  if (timeoutMs === null) return classifyTechnicalEmail(input, 'DNS_RESOLVER_ERROR');
  const resolution = await resolveWithTimeout(resolver, syntax.domain, timeoutMs);
  return classifyTechnicalEmail({ ...input, domainResolution: resolution.value }, resolution.issue);
}
