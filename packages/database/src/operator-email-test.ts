import { createHash, createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
} from '@lead-finder/messaging';
import {
  isTrustedAuthorizationContext,
  type AuthorizationContext,
} from '@lead-finder/shared';
import type { Database } from './index.js';

export type OperatorEmailTestRuntime = Readonly<{
  enabled: boolean;
  killSwitchEnabled: boolean;
  authorizedRecipient?: string | undefined;
  authorizedSender?: string | undefined;
  fingerprintKey?: string | undefined;
}>;

export type OperatorEmailDelivery = (
  message: Readonly<{ subject: string; body: string }>,
) => Promise<Readonly<{
  provider: 'GMAIL_SMTP';
  messageId: string;
  response: string;
}>>;

export class OperatorEmailTestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'DISABLED'
      | 'KILL_SWITCH_ENGAGED'
      | 'INVALID_CONFIGURATION'
      | 'FORBIDDEN'
      | 'IDEMPOTENCY_CONFLICT'
      | 'AMBIGUOUS_STATE'
      | 'DELIVERY_FAILED',
  ) {
    super(message);
  }
}

const provider = new DeterministicFakeMessagingProvider();
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

const hmac = (key: string, domain: string, value: string) =>
  createHmac('sha256', key).update(`${domain}\u0000${value}`).digest('hex');

const resolvedRuntime = (runtime: OperatorEmailTestRuntime) => {
  if (!runtime.enabled) {
    throw new OperatorEmailTestError('Operator email test is disabled', 'DISABLED');
  }
  if (runtime.killSwitchEnabled) {
    throw new OperatorEmailTestError(
      'Operator email test kill switch is engaged',
      'KILL_SWITCH_ENGAGED',
    );
  }
  const recipient = runtime.authorizedRecipient?.trim().toLowerCase() ?? '';
  const sender = runtime.authorizedSender?.trim().toLowerCase() ?? '';
  const fingerprintKey = runtime.fingerprintKey?.trim() ?? '';
  if (
    !emailPattern.test(recipient)
    || recipient !== sender
    || fingerprintKey.length < 32
  ) {
    throw new OperatorEmailTestError(
      'Operator email test configuration is invalid',
      'INVALID_CONFIGURATION',
    );
  }
  return { recipient, sender, fingerprintKey } as const;
};

const requirePermission = (auth: AuthorizationContext) => {
  if (
    !isTrustedAuthorizationContext(auth)
    || !auth.permissions.has('operator-email-test:send')
  ) {
    throw new OperatorEmailTestError(
      'Operator email test permission denied',
      'FORBIDDEN',
    );
  }
};

type PersistedAttempt = {
  id: string;
  payload_fingerprint: string;
  message_fingerprint: string;
  reserved_at: Date;
};

type PersistedEvent = {
  id: string;
  outcome: 'DELIVERED' | 'FAILED';
  occurred_at: Date;
};

async function appendOutcome(
  db: Database,
  input: {
    attemptId: string;
    outcome: 'DELIVERED' | 'FAILED';
    principalFingerprint: string;
    providerResponseFingerprint: string;
  },
) {
  const payloadFingerprint = digest(input);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`operator-email-test:${input.attemptId}`},0))`,
    );
    const prior = (await tx.execute(
      sql<PersistedEvent[]>`select id,outcome,occurred_at
        from operator_email_test_events
        where attempt_id=${input.attemptId}::uuid`,
    )) as unknown as PersistedEvent[];
    if (prior[0]) {
      if (prior[0].outcome !== input.outcome) {
        throw new OperatorEmailTestError(
          'Operator email test outcome conflicts with persisted state',
          'AMBIGUOUS_STATE',
        );
      }
      return { ...prior[0], replayed: true };
    }
    const saved = (
      (await tx.execute(
        sql<PersistedEvent[]>`select id,${input.outcome}::text outcome,occurred_at
          from public.append_operator_email_test_event(
            ${input.attemptId}::uuid,
            ${input.outcome},
            ${input.principalFingerprint}::char(64),
            ${input.providerResponseFingerprint}::char(64),
            ${payloadFingerprint}::char(64)
          )`,
      )) as unknown as PersistedEvent[]
    )[0]!;
    return { ...saved, replayed: false };
  });
}

export async function sendOperatorEmailTest(
  db: Database,
  input: {
    templateId: string;
    templateVersion: string;
    idempotencyKey: string;
  },
  auth: AuthorizationContext,
  runtime: OperatorEmailTestRuntime,
  deliver: OperatorEmailDelivery,
) {
  requirePermission(auth);
  const resolved = resolvedRuntime(runtime);
  const template = approvedTemplates.operatorEmailTestV1;
  if (
    input.templateId !== template.id
    || input.templateVersion !== template.version
  ) {
    throw new OperatorEmailTestError(
      'Template is not approved for operator email test',
      'INVALID_CONFIGURATION',
    );
  }
  const prepared = provider.prepare(template, {});
  if (!prepared.subject) {
    throw new OperatorEmailTestError(
      'Operator email test subject is unavailable',
      'INVALID_CONFIGURATION',
    );
  }

  const recipientFingerprint = hmac(
    resolved.fingerprintKey,
    'OPERATOR_EMAIL_TEST:RECIPIENT',
    resolved.recipient,
  );
  const senderFingerprint = hmac(
    resolved.fingerprintKey,
    'OPERATOR_EMAIL_TEST:SENDER',
    resolved.sender,
  );
  const principalFingerprint = hmac(
    resolved.fingerprintKey,
    'OPERATOR_EMAIL_TEST:PRINCIPAL',
    auth.principalId,
  );
  const idempotencyFingerprint = hmac(
    resolved.fingerprintKey,
    'OPERATOR_EMAIL_TEST:IDEMPOTENCY',
    input.idempotencyKey,
  );
  const payloadFingerprint = digest({
    purpose: 'OPERATOR_TEST',
    channel: 'EMAIL',
    recipientFingerprint,
    senderFingerprint,
    principalFingerprint,
    templateId: template.id,
    templateVersion: template.version,
    messageFingerprint: prepared.fingerprint,
  });

  const reservation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`operator-email-test:${principalFingerprint}:${idempotencyFingerprint}`},0))`,
    );
    const prior = (await tx.execute(
      sql<PersistedAttempt[]>`select id,payload_fingerprint,message_fingerprint,reserved_at
        from operator_email_test_attempts
        where operator_principal_fingerprint=${principalFingerprint}::char(64)
          and idempotency_fingerprint=${idempotencyFingerprint}::char(64)`,
    )) as unknown as PersistedAttempt[];
    if (prior[0]) {
      if (
        prior[0].payload_fingerprint !== payloadFingerprint
        || prior[0].message_fingerprint !== prepared.fingerprint
      ) {
        throw new OperatorEmailTestError(
          'Operator email test idempotency conflict',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      const event = (await tx.execute(
        sql<PersistedEvent[]>`select id,outcome,occurred_at
          from operator_email_test_events
          where attempt_id=${prior[0].id}::uuid`,
      )) as unknown as PersistedEvent[];
      if (!event[0]) {
        throw new OperatorEmailTestError(
          'Operator email test has an ambiguous prior attempt',
          'AMBIGUOUS_STATE',
        );
      }
      return { attempt: prior[0], event: event[0], replayed: true } as const;
    }
    const attempt = (
      (await tx.execute(
        sql<PersistedAttempt[]>`select id,${payloadFingerprint}::text payload_fingerprint,
            ${prepared.fingerprint}::text message_fingerprint,reserved_at
          from public.create_operator_email_test_attempt(
            ${recipientFingerprint}::char(64),
            ${senderFingerprint}::char(64),
            ${principalFingerprint}::char(64),
            ${payloadFingerprint}::char(64),
            ${idempotencyFingerprint}::char(64),
            ${prepared.fingerprint}::char(64)
          )`,
      )) as unknown as PersistedAttempt[]
    )[0]!;
    return { attempt, event: undefined, replayed: false } as const;
  });

  if (reservation.replayed && reservation.event) {
    return {
      attemptId: reservation.attempt.id,
      state: reservation.event.outcome,
      purpose: 'OPERATOR_TEST' as const,
      channel: 'EMAIL' as const,
      templateId: template.id,
      templateVersion: template.version,
      reservedAt: reservation.attempt.reserved_at,
      occurredAt: reservation.event.occurred_at,
      replayed: true,
    };
  }

  let receipt: Awaited<ReturnType<OperatorEmailDelivery>>;
  try {
    receipt = await deliver({
      subject: prepared.subject,
      body: prepared.body,
    });
  } catch (error) {
    const failureFingerprint = digest({
      provider: 'GMAIL_SMTP',
      errorType: error instanceof Error ? error.name : typeof error,
    });
    try {
      await appendOutcome(db, {
        attemptId: reservation.attempt.id,
        outcome: 'FAILED',
        principalFingerprint,
        providerResponseFingerprint: failureFingerprint,
      });
    } catch {
      throw new OperatorEmailTestError(
        'Operator email test delivery state is ambiguous',
        'AMBIGUOUS_STATE',
      );
    }
    throw new OperatorEmailTestError(
      'Operator email test delivery failed',
      'DELIVERY_FAILED',
    );
  }

  const providerResponseFingerprint = digest(receipt);
  let outcome: Awaited<ReturnType<typeof appendOutcome>>;
  try {
    outcome = await appendOutcome(db, {
      attemptId: reservation.attempt.id,
      outcome: 'DELIVERED',
      principalFingerprint,
      providerResponseFingerprint,
    });
  } catch {
    throw new OperatorEmailTestError(
      'Operator email test delivery state is ambiguous',
      'AMBIGUOUS_STATE',
    );
  }

  return {
    attemptId: reservation.attempt.id,
    state: 'DELIVERED' as const,
    purpose: 'OPERATOR_TEST' as const,
    channel: 'EMAIL' as const,
    templateId: template.id,
    templateVersion: template.version,
    reservedAt: reservation.attempt.reserved_at,
    occurredAt: outcome.occurred_at,
    replayed: false,
  };
}
