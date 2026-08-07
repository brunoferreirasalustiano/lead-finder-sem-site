import { createHash, createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
  type MessageTemplate,
  type MessagingChannel,
} from '@lead-finder/messaging';
import {
  isTrustedAuthorizationContext,
  type AuthorizationContext,
} from '@lead-finder/shared';
import type { Database } from './index.js';
import {
  ManualMessagingError,
  prepareManualMessage as prepareLegacyManualMessage,
  recordManualOpen as recordLegacyManualOpen,
} from './manual-messaging.js';

const provider = new DeterministicFakeMessagingProvider();
const EMAIL_TEMPLATE_ID = 'pilot-email-first-contact' as const;

type PrepareInput = Readonly<{
  contactId: string;
  requestedChannel: MessagingChannel;
  templateId: string;
  templateVersion: string;
  idempotencyKey: string;
}>;

type PreparedSnapshot = Readonly<{
  schemaVersion: 2;
  channel: 'EMAIL';
  templateId: string;
  templateVersion: string;
  variables: Record<string, never>;
  renderedInputsFingerprint: string;
  contactFingerprint: string;
  messageFingerprint: string;
}>;

type ContactContextRow = Readonly<{
  contact_fingerprint: string;
  contact_source: string;
  lead_name: string;
}>;

type PreparationContextRow = Readonly<{
  pilot_run_id: string;
  lead_id: string;
  contact_id: string;
  template_id: string;
  template_version: string;
  result_fingerprint: string;
  result_snapshot: unknown;
  contact_value: string;
  contact_fingerprint: string;
  contact_source: string;
  lead_name: string;
  expires_at: Date;
}>;

type AttemptRow = Readonly<{
  id: string;
  reserved_at: Date;
  replayed: boolean;
  event_type: 'DELIVERED' | 'FAILED' | 'AMBIGUOUS' | null;
  provider_message_fingerprint: string | null;
  error_code: string | null;
  event_created_at: Date | null;
}>;

type TerminalEvent = 'DELIVERED' | 'FAILED' | 'AMBIGUOUS';

type TerminalRow = Readonly<{
  id: string;
  event_type: TerminalEvent;
  provider_message_fingerprint: string | null;
  error_code: string | null;
  created_at: Date;
  replayed: boolean;
}>;

type PreparedEmail = Readonly<{
  channel: 'EMAIL';
  templateId: string;
  templateVersion: string;
  subject: string;
  body: string;
  fingerprint: string;
}>;

export type RestrictedManualEmailDeliveryResult = Readonly<{
  state: TerminalEvent | 'IN_PROGRESS';
  provider: 'GMAIL_API';
  messageIdFingerprint?: string;
  errorCode?: string;
  replayed: boolean;
  attemptId: string;
}>;

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/**
 * V1 preparations persisted this exact pre-0025 JSON representation.  Keep
 * this narrowly scoped to the historical email snapshot shape; V2 snapshots
 * must continue to bind to the opaque contact-resolution fingerprint.
 */
const legacyV1ContactFingerprint = (contactId: string, contactValue: string) =>
  createHash('sha256')
    .update(JSON.stringify({ channel: 'EMAIL', contactId, value: contactValue }))
    .digest('hex');

const keyedFingerprint = (key: string, domain: string, value: string) =>
  createHmac('sha256', key).update(domain).update('\u0000').update(value).digest('hex');

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

const templateForEmail = (id: string, version: string): MessageTemplate => {
  if (id !== EMAIL_TEMPLATE_ID) {
    throw new ManualMessagingError('Template is not approved', 'INVALID_STATE');
  }
  if (version === approvedTemplates.emailV1.version) return approvedTemplates.emailV1;
  if (version === approvedTemplates.emailV2.version) return approvedTemplates.emailV2;
  throw new ManualMessagingError('Template is not approved', 'INVALID_STATE');
};

const variablesFor = (leadName: string, contactSource: string) => ({
  EMPRESA: leadName,
  FONTE: contactSource,
});

const requirePermission = (
  auth: AuthorizationContext,
  permission: 'manual-messaging:prepare' | 'manual-messaging:open' | 'manual-messaging:send',
) => {
  if (!isTrustedAuthorizationContext(auth) || !auth.permissions.has(permission)) {
    throw new ManualMessagingError('Manual email operation is not authorized', 'INELIGIBLE');
  }
};

type PostgresErrorLike = { code?: unknown; cause?: unknown };
const postgresCode = (error: unknown): string | undefined => {
  const visited = new Set<object>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = current as PostgresErrorLike;
    if (typeof candidate.code === 'string') return candidate.code;
    current = candidate.cause;
  }
  return undefined;
};

const mapDatabaseError = (error: unknown): ManualMessagingError | undefined => {
  if (error instanceof ManualMessagingError) return error;
  switch (postgresCode(error)) {
    case 'P0002': return new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    case '23505': return new ManualMessagingError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    case '42501':
    case 'P0001': return new ManualMessagingError('Requested email operation is ineligible', 'INELIGIBLE');
    case '55000': return new ManualMessagingError('Manual email preparation is not usable', 'INVALID_STATE');
    default: return undefined;
  }
};

const withDatabaseErrorMapping = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    throw error;
  }
};

const validateSnapshot = (
  context: Pick<PreparationContextRow,
    'template_id' | 'template_version' | 'result_snapshot' | 'result_fingerprint'
    | 'contact_id' | 'contact_value' | 'contact_fingerprint' | 'contact_source' | 'lead_name'>,
): PreparedEmail => {
  const snapshot = record(context.result_snapshot);
  if (digest(snapshot) !== String(context.result_fingerprint).trim()) {
    throw new ManualMessagingError('Persisted preparation fingerprint changed', 'INVALID_STATE');
  }
  if (snapshot['channel'] !== 'EMAIL'
    || snapshot['templateId'] !== context.template_id
    || snapshot['templateVersion'] !== context.template_version) {
    throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
  }
  const isHistoricalV1 = context.template_version === approvedTemplates.emailV1.version
    && snapshot['schemaVersion'] === undefined;
  if (isHistoricalV1) {
    if (snapshot['contactFingerprint'] !== legacyV1ContactFingerprint(
      String(context.contact_id),
      String(context.contact_value),
    )) {
      throw new ManualMessagingError('Prepared contact changed', 'INVALID_STATE');
    }
  } else if (snapshot['schemaVersion'] !== 2
    || snapshot['contactFingerprint'] !== String(context.contact_fingerprint).trim()) {
    throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
  }
  const template = templateForEmail(context.template_id, context.template_version);
  const variables = variablesFor(context.lead_name, context.contact_source);
  const prepared = provider.prepare(template, variables);
  if (prepared.channel !== 'EMAIL' || !prepared.subject) {
    throw new ManualMessagingError('Approved email template has no subject', 'INVALID_STATE');
  }

  if (snapshot['schemaVersion'] === 2) {
    if (snapshot['renderedInputsFingerprint'] !== digest(variables)
      || snapshot['messageFingerprint'] !== prepared.fingerprint
      || JSON.stringify(snapshot['variables']) !== '{}') {
      throw new ManualMessagingError('Persisted preparation cannot be reconstructed', 'INVALID_STATE');
    }
    return { ...prepared, channel: 'EMAIL', subject: prepared.subject };
  }

  const historicalVariables = record(snapshot['variables']);
  if (digest(historicalVariables) !== digest(variables)
    || snapshot['messageFingerprint'] !== prepared.fingerprint) {
    throw new ManualMessagingError('Historical preparation cannot be reconstructed', 'INVALID_STATE');
  }
  return { ...prepared, channel: 'EMAIL', subject: prepared.subject };
};

export async function prepareManualMessage(
  db: Database,
  pilotRunId: string,
  leadId: string,
  input: PrepareInput,
  auth: AuthorizationContext,
) {
  if (input.requestedChannel !== 'EMAIL') {
    return prepareLegacyManualMessage(db, pilotRunId, leadId, input, auth);
  }
  requirePermission(auth, 'manual-messaging:prepare');
  const template = templateForEmail(input.templateId, input.templateVersion);
  const payloadFingerprint = digest({
    pilotRunId,
    leadId,
    ...input,
    principalId: auth.principalId,
  });

  try {
    return await db.transaction(async (tx) => {
      const contextRows = await tx.execute<ContactContextRow>(sql`
        select * from public.resolve_manual_email_contact_context(
          ${pilotRunId}::uuid,
          ${leadId}::uuid,
          ${input.contactId}::uuid,
          ${auth.principalId}
        )
      `);
      const context = contextRows[0];
      if (!context) throw new ManualMessagingError('Requested contact is ineligible', 'INELIGIBLE');

      const variables = variablesFor(context.lead_name, context.contact_source);
      const prepared = provider.prepare(template, variables);
      const snapshot: PreparedSnapshot = {
        schemaVersion: 2,
        channel: 'EMAIL',
        templateId: template.id,
        templateVersion: template.version,
        variables: {},
        renderedInputsFingerprint: digest(variables),
        contactFingerprint: String(context.contact_fingerprint).trim(),
        messageFingerprint: prepared.fingerprint,
      };
      const resultFingerprint = digest(snapshot);
      const rows = await tx.execute<{
        id: string;
        prepared_at: Date;
        expires_at: Date;
        result_snapshot: unknown;
        replayed: boolean;
      }>(sql`
        select id,prepared_at,expires_at,result_snapshot,replayed
        from public.create_manual_email_preparation(
          ${pilotRunId}::uuid,
          ${leadId}::uuid,
          ${input.contactId}::uuid,
          ${template.id},
          ${template.version},
          ${auth.principalId},
          ${payloadFingerprint}::char(64),
          ${input.idempotencyKey},
          ${resultFingerprint}::char(64),
          ${JSON.stringify(snapshot)}::jsonb
        )
      `);
      const saved = rows[0];
      if (!saved) throw new Error('MANUAL_EMAIL_PREPARATION_RESULT_MISSING');
      const persistedSnapshot = record(saved.result_snapshot);
      const persistedContactFingerprint = persistedSnapshot['contactFingerprint'];
      const persistedMessageFingerprint = persistedSnapshot['messageFingerprint'];
      if (typeof persistedContactFingerprint !== 'string'
        || !/^[0-9a-f]{64}$/.test(persistedContactFingerprint)
        || typeof persistedMessageFingerprint !== 'string'
        || !/^[0-9a-f]{64}$/.test(persistedMessageFingerprint)) {
        throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
      }
      return {
        preparationId: saved.id,
        state: 'PREPARED' as const,
        channel: 'EMAIL' as const,
        templateId: template.id,
        templateVersion: template.version,
        contactFingerprint: persistedContactFingerprint,
        messageFingerprint: persistedMessageFingerprint,
        preparedAt: saved.prepared_at,
        expiresAt: saved.expires_at,
        replayed: saved.replayed,
      };
    });
  } catch (error) {
    if (input.templateVersion === approvedTemplates.emailV1.version
      && postgresCode(error) === '42501') {
      throw new ManualMessagingError(
        'New manual email preparations require template v2',
        'EMAIL_CONSUMER_UNAVAILABLE',
      );
    }
    const mapped = mapDatabaseError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

export async function recordManualOpen(
  db: Database,
  preparationId: string,
  input: { idempotencyKey: string },
  auth: AuthorizationContext,
) {
  requirePermission(auth, 'manual-messaging:open');
  try {
    return await withDatabaseErrorMapping(() => db.transaction(async (tx) => {
      const payloadFingerprint = digest({
        preparationId,
        eventType: 'OPENED',
        idempotencyKey: input.idempotencyKey,
        principalId: auth.principalId,
      });
      // PostgreSQL checks for the persisted OPENED fact before consulting live
      // expiry, pilot, or contact eligibility.  This is the only historical
      // replay exception; a first open still performs all live gates in SQL.
      const events = await tx.execute<{
        id: string;
        created_at: Date;
        replayed: boolean;
      }>(sql`
        select * from public.append_manual_email_open_event(
          ${preparationId}::uuid,
          ${auth.principalId},
          ${payloadFingerprint}::char(64),
          ${input.idempotencyKey}
        )
      `);
      const event = events[0];
      if (!event) throw new Error('MANUAL_EMAIL_OPEN_RESULT_MISSING');
      if (event.replayed) {
        return {
          preparationId,
          state: 'OPENED' as const,
          eventId: event.id,
          createdAt: event.created_at,
          replayed: true,
        };
      }

      const contexts = await tx.execute<PreparationContextRow>(sql`
        select * from public.resolve_manual_email_preparation_context(
           ${preparationId}::uuid,
           ${auth.principalId},
           true
         )
      `);
      const context = contexts[0];
      if (!context) throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
      validateSnapshot(context);
      return {
        preparationId,
        state: 'OPENED' as const,
        eventId: event.id,
        createdAt: event.created_at,
        replayed: false,
      };
    }));
  } catch (error) {
    const code = postgresCode(error);
    if (code === '42809' || code === '42883') {
      return recordLegacyManualOpen(db, preparationId, input, auth);
    }
    throw error;
  }
}

const terminalResult = (
  attempt: AttemptRow,
  replayed: boolean,
): RestrictedManualEmailDeliveryResult | undefined => {
  if (!attempt.event_type) return undefined;
  return {
    state: attempt.event_type,
    provider: 'GMAIL_API',
    ...(attempt.provider_message_fingerprint
      ? { messageIdFingerprint: String(attempt.provider_message_fingerprint).trim() }
      : {}),
    ...(attempt.error_code ? { errorCode: attempt.error_code } : {}),
    replayed,
    attemptId: attempt.id,
  };
};

const readExistingAttempt = async (
  db: Database,
  preparationId: string,
  auth: AuthorizationContext,
): Promise<AttemptRow | undefined> => withDatabaseErrorMapping(async () => {
  const rows = await db.execute<AttemptRow>(sql`
    select * from public.get_manual_email_send_attempt(
      ${preparationId}::uuid,
      ${auth.principalId}
    )
  `);
  return rows[0];
});

const appendTerminal = async (
  db: Database,
  attemptId: string,
  auth: AuthorizationContext,
  eventType: TerminalEvent,
  providerMessageFingerprint: string | undefined,
  errorCode: string | undefined,
) => withDatabaseErrorMapping(async () => {
  const rows = await db.execute<TerminalRow>(sql`
    select * from public.append_manual_email_send_event(
      ${attemptId}::uuid,
      ${auth.principalId},
      ${eventType},
      ${providerMessageFingerprint ?? null}::char(64),
      ${errorCode ?? null}
    )
  `);
  const event = rows[0];
  if (!event) throw new Error('MANUAL_EMAIL_TERMINAL_RESULT_MISSING');
  return event;
});

const errorCodeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;

const classifyDeliveryFailure = (error: unknown): Readonly<{
  eventType: 'FAILED' | 'AMBIGUOUS';
  errorCode: string;
}> => {
  switch (errorCodeOf(error)) {
    case 'INVALID_CONFIGURATION':
      return { eventType: 'FAILED', errorCode: 'INVALID_CONFIGURATION' };
    case 'TOKEN_EXCHANGE_FAILED':
      return { eventType: 'FAILED', errorCode: 'TOKEN_EXCHANGE_FAILED' };
    case 'DELIVERY_REJECTED':
      return { eventType: 'FAILED', errorCode: 'DELIVERY_REJECTED' };
    case 'DELIVERY_AMBIGUOUS':
      return { eventType: 'AMBIGUOUS', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' };
    default:
      return { eventType: 'AMBIGUOUS', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' };
  }
};

export async function sendPreparedManualEmail(
  db: Database,
  preparationId: string,
  auth: AuthorizationContext,
  runtime: {
    sendEnabled: boolean;
    killSwitchEnabled: boolean;
    sender: string;
    fingerprintKey: string;
    deliver: (message: {
      subject: string;
      body: string;
      recipient: string;
    }) => Promise<{ provider: 'GMAIL_API'; messageId: string }>;
  },
): Promise<RestrictedManualEmailDeliveryResult> {
  requirePermission(auth, 'manual-messaging:send');

  const existingAttempt = await readExistingAttempt(db, preparationId, auth);
  if (existingAttempt) {
    const persistedTerminal = terminalResult(existingAttempt, true);
    if (persistedTerminal) return persistedTerminal;
    return {
      state: 'IN_PROGRESS',
      provider: 'GMAIL_API',
      replayed: true,
      attemptId: existingAttempt.id,
    };
  }

  if (!runtime.sendEnabled || runtime.killSwitchEnabled) {
    throw new ManualMessagingError('Manual email delivery is unavailable', 'EMAIL_CONSUMER_UNAVAILABLE');
  }

  const reserved = await withDatabaseErrorMapping(() => db.transaction(async (tx) => {
    const contexts = await tx.execute<PreparationContextRow>(sql`
      select * from public.resolve_manual_email_preparation_context(
        ${preparationId}::uuid,
        ${auth.principalId},
        true
      )
    `);
    const context = contexts[0];
    if (!context) throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    const prepared = validateSnapshot(context);
    const sender = runtime.sender.trim().toLowerCase();
    const recipient = context.contact_value.trim().toLowerCase();
    const senderFingerprint = keyedFingerprint(runtime.fingerprintKey, 'manual-email-sender', sender);
    const recipientFingerprint = keyedFingerprint(runtime.fingerprintKey, 'manual-email-recipient', recipient);
    const attempts = await tx.execute<AttemptRow>(sql`
      select * from public.create_manual_email_send_attempt(
        ${preparationId}::uuid,
        ${auth.principalId},
        ${senderFingerprint}::char(64),
        ${recipientFingerprint}::char(64),
        ${prepared.fingerprint}::char(64)
      )
    `);
    const attempt = attempts[0];
    if (!attempt) throw new Error('MANUAL_EMAIL_ATTEMPT_RESULT_MISSING');
    return { attempt, prepared, recipient };
  }));

  const priorTerminal = terminalResult(reserved.attempt, true);
  if (priorTerminal) return priorTerminal;

  if (reserved.attempt.replayed) {
    return {
      state: 'IN_PROGRESS',
      provider: 'GMAIL_API',
      replayed: true,
      attemptId: reserved.attempt.id,
    };
  }

  try {
    const receipt = await runtime.deliver({
      subject: reserved.prepared.subject,
      body: reserved.prepared.body,
      recipient: reserved.recipient,
    });
    if (receipt.provider !== 'GMAIL_API' || !receipt.messageId) {
      throw Object.assign(new Error('Gmail delivery result is ambiguous'), {
        code: 'DELIVERY_AMBIGUOUS',
      });
    }
    const messageIdFingerprint = keyedFingerprint(
      runtime.fingerprintKey,
      'manual-email-provider-message-id',
      receipt.messageId,
    );
    const terminal = await appendTerminal(
      db,
      reserved.attempt.id,
      auth,
      'DELIVERED',
      messageIdFingerprint,
      undefined,
    );
    return {
      state: terminal.event_type,
      provider: 'GMAIL_API',
      messageIdFingerprint,
      replayed: false,
      attemptId: reserved.attempt.id,
    };
  } catch (error) {
    const failure = classifyDeliveryFailure(error);
    try {
      const terminal = await appendTerminal(
        db,
        reserved.attempt.id,
        auth,
        failure.eventType,
        undefined,
        failure.errorCode,
      );
      return {
        state: terminal.event_type,
        provider: 'GMAIL_API',
        errorCode: terminal.error_code ?? failure.errorCode,
        replayed: false,
        attemptId: reserved.attempt.id,
      };
    } catch (terminalError) {
      const isTerminalConflict = postgresCode(terminalError) === '23505'
        || (terminalError instanceof ManualMessagingError
          && terminalError.code === 'IDEMPOTENCY_CONFLICT');
      if (!isTerminalConflict) throw terminalError;
      const replay = await sendPreparedManualEmail(db, preparationId, auth, runtime);
      return { ...replay, replayed: true };
    }
  }
}