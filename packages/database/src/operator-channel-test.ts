import { createHash, createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
} from '@lead-finder/messaging';
import { createWhatsAppManualUrl, normalizePhoneE164 } from '@lead-finder/whatsapp';
import { isTrustedAuthorizationContext, type AuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';

export type OperatorTestConfirmationResult =
  | 'SENT_CONFIRMED'
  | 'NOT_SENT'
  | 'OPERATIONAL_ERROR';
export type OperatorTestResponseResult =
  | 'RECEIVED_CONFIRMED'
  | 'NOT_RECEIVED'
  | 'READ_CONFIRMED';
type OperatorTestResult = OperatorTestConfirmationResult | OperatorTestResponseResult;

export type OperatorTestRuntime = Readonly<{
  enabled: boolean;
  killSwitchEnabled: boolean;
  authorizedPhoneE164?: string | undefined;
  fingerprintKey?: string | undefined;
}>;

export class OperatorChannelTestError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID_STATE'
      | 'DISABLED'
      | 'KILL_SWITCH_ENGAGED'
      | 'INVALID_RECIPIENT'
      | 'INVALID_FINGERPRINT_KEY'
      | 'IDEMPOTENCY_CONFLICT'
      | 'FORBIDDEN',
  ) {
    super(message);
  }
}

const provider = new DeterministicFakeMessagingProvider();

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

const fingerprint = (key: string, domain: string, value: string) =>
  createHmac('sha256', key).update(`${domain}\u0000${value}`).digest('hex');

const fingerprintKeyFor = (runtime: OperatorTestRuntime) => {
  const fingerprintKey = runtime.fingerprintKey?.trim();
  if (!fingerprintKey || fingerprintKey.length < 32) {
    throw new OperatorChannelTestError(
      'Operator test fingerprint key is invalid',
      'INVALID_FINGERPRINT_KEY',
    );
  }
  return fingerprintKey;
};

const requirePermission = (auth: AuthorizationContext, permission: string) => {
  if (!isTrustedAuthorizationContext(auth) || !auth.permissions.has(permission)) {
    throw new OperatorChannelTestError('Operator test permission denied', 'FORBIDDEN');
  }
};

export function resolveOperatorTestRecipient(runtime: OperatorTestRuntime) {
  if (!runtime.enabled) throw new OperatorChannelTestError('Operator test is disabled', 'DISABLED');
  if (runtime.killSwitchEnabled) {
    throw new OperatorChannelTestError('Operator test kill switch is engaged', 'KILL_SWITCH_ENGAGED');
  }
  const fingerprintKey = fingerprintKeyFor(runtime);
  const normalized = normalizePhoneE164(runtime.authorizedPhoneE164);
  if (!normalized.ok) {
    throw new OperatorChannelTestError('Authorized operator recipient is invalid', 'INVALID_RECIPIENT');
  }
  return {
    e164: normalized.e164,
    digits: normalized.digits,
    fingerprint: fingerprint(fingerprintKey, 'OPERATOR_TEST:RECIPIENT', normalized.e164),
  } as const;
}

export function buildOperatorTestPreparation(runtime: OperatorTestRuntime) {
  const recipient = resolveOperatorTestRecipient(runtime);
  const template = approvedTemplates.operatorWhatsappTestV1;
  const prepared = provider.prepare(template, {});
  return {
    recipient,
    template,
    prepared,
    link: createWhatsAppManualUrl(recipient.e164, prepared.body),
  } as const;
}

export async function prepareOperatorWhatsAppTest(
  db: Database,
  input: {
    templateId: string;
    templateVersion: string;
    idempotencyKey: string;
  },
  auth: AuthorizationContext,
  runtime: OperatorTestRuntime,
) {
  requirePermission(auth, 'operator-test:prepare');
  const built = buildOperatorTestPreparation(runtime);
  const fingerprintKey = fingerprintKeyFor(runtime);
  const principalFingerprint = fingerprint(fingerprintKey, 'OPERATOR_TEST:PRINCIPAL', auth.principalId);
  const idempotencyFingerprint = fingerprint(fingerprintKey, 'OPERATOR_TEST:IDEMPOTENCY', input.idempotencyKey);
  if (
    input.templateId !== built.template.id
    || input.templateVersion !== built.template.version
  ) {
    throw new OperatorChannelTestError('Template is not approved for operator test', 'INVALID_STATE');
  }

  const payloadFingerprint = digest({
    purpose: 'OPERATOR_TEST',
    channel: 'WHATSAPP',
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    recipientFingerprint: built.recipient.fingerprint,
    principalFingerprint,
  });

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`operator-channel-test:${principalFingerprint}:${idempotencyFingerprint}`},0))`,
    );

    const prior = await tx.execute(
      sql<{
        id: string;
        recipient_fingerprint: string;
        payload_fingerprint: string;
        template_id: string;
        template_version: string;
        message_fingerprint: string;
        result_fingerprint: string;
        prepared_at: Date;
      }[]>`select id,recipient_fingerprint,payload_fingerprint,template_id,template_version,
          message_fingerprint,result_fingerprint,prepared_at
          from operator_channel_test_preparations
          where operator_principal_fingerprint=${principalFingerprint}::char(64)
            and idempotency_fingerprint=${idempotencyFingerprint}::char(64)`,
    );

    if (prior[0] && prior[0].payload_fingerprint !== payloadFingerprint) {
      throw new OperatorChannelTestError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    }

    if (prior[0]) {
      const persisted = prior[0];
      const resultFingerprint = digest({
        channel: 'WHATSAPP',
        purpose: 'OPERATOR_TEST',
        templateId: persisted.template_id,
        templateVersion: persisted.template_version,
        recipientFingerprint: persisted.recipient_fingerprint,
        messageFingerprint: persisted.message_fingerprint,
      });
      if (resultFingerprint !== persisted.result_fingerprint) {
        throw new OperatorChannelTestError('Persisted operator test snapshot is invalid', 'INVALID_STATE');
      }
      if (
        persisted.template_id !== built.template.id
        || persisted.template_version !== built.template.version
        || persisted.recipient_fingerprint !== built.recipient.fingerprint
        || persisted.message_fingerprint !== built.prepared.fingerprint
      ) {
        throw new OperatorChannelTestError('Persisted operator test cannot be reconstructed', 'INVALID_STATE');
      }
      return {
        preparationId: persisted.id,
        state: 'PREPARED' as const,
        purpose: 'OPERATOR_TEST' as const,
        channel: 'WHATSAPP' as const,
        templateId: built.template.id,
        templateVersion: built.template.version,
        recipientFingerprint: built.recipient.fingerprint,
        message: built.prepared.body,
        link: built.link,
        preparedAt: persisted.prepared_at,
        replayed: true,
      };
    }

    const resultFingerprint = digest({
      channel: 'WHATSAPP',
      purpose: 'OPERATOR_TEST',
      templateId: built.template.id,
      templateVersion: built.template.version,
      recipientFingerprint: built.recipient.fingerprint,
      messageFingerprint: built.prepared.fingerprint,
    });

    const saved = (
      await tx.execute(
        sql<{ id: string; prepared_at: Date }[]>`select id,prepared_at
          from public.create_operator_channel_test_preparation(
            ${built.recipient.fingerprint}::char(64),${principalFingerprint}::char(64),
            ${payloadFingerprint}::char(64),${idempotencyFingerprint}::char(64),
            ${built.prepared.fingerprint}::char(64),${resultFingerprint}::char(64)
          )`,
      )
    )[0]!;

    return {
      preparationId: saved.id,
      state: 'PREPARED' as const,
      purpose: 'OPERATOR_TEST' as const,
      channel: 'WHATSAPP' as const,
      templateId: built.template.id,
      templateVersion: built.template.version,
      recipientFingerprint: built.recipient.fingerprint,
      message: built.prepared.body,
      link: built.link,
      preparedAt: saved.prepared_at,
      replayed: false,
    };
  });
}

export const recordOperatorTestOpen = (
  db: Database,
  preparationId: string,
  input: { idempotencyKey: string },
  auth: AuthorizationContext,
  runtime: OperatorTestRuntime,
) => operatorTestEvent(
  db,
  preparationId,
  'OPENED',
  undefined,
  input.idempotencyKey,
  auth,
  runtime,
  'operator-test:open',
);

export const confirmOperatorTestResult = (
  db: Database,
  preparationId: string,
  input: {
    result: OperatorTestConfirmationResult;
    idempotencyKey: string;
  },
  auth: AuthorizationContext,
  runtime: OperatorTestRuntime,
) => operatorTestEvent(
  db,
  preparationId,
  'CONTACT_CONFIRMED',
  input.result,
  input.idempotencyKey,
  auth,
  runtime,
  'operator-test:confirm',
);

export const recordOperatorTestResponse = (
  db: Database,
  preparationId: string,
  input: {
    result: OperatorTestResponseResult;
    idempotencyKey: string;
  },
  auth: AuthorizationContext,
  runtime: OperatorTestRuntime,
) => operatorTestEvent(
  db,
  preparationId,
  'RESPONSE_RECORDED',
  input.result,
  input.idempotencyKey,
  auth,
  runtime,
  'operator-test:response',
);

async function operatorTestEvent(
  db: Database,
  preparationId: string,
  eventType: 'OPENED' | 'CONTACT_CONFIRMED' | 'RESPONSE_RECORDED',
  result: OperatorTestResult | undefined,
  idempotencyKey: string,
  auth: AuthorizationContext,
  runtime: OperatorTestRuntime,
  requiredPermission: string,
) {
  requirePermission(auth, requiredPermission);
  const recipient = resolveOperatorTestRecipient(runtime);
  const fingerprintKey = fingerprintKeyFor(runtime);
  const principalFingerprint = fingerprint(fingerprintKey, 'OPERATOR_TEST:PRINCIPAL', auth.principalId);
  const idempotencyFingerprint = fingerprint(fingerprintKey, 'OPERATOR_TEST:IDEMPOTENCY', idempotencyKey);
  const payloadFingerprint = digest({
    preparationId,
    eventType,
    result,
    principalFingerprint,
  });

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`operator-channel-test:${preparationId}`},0))`,
    );

    const prior = await tx.execute(
      sql<{
        id: string;
        payload_fingerprint: string;
        created_at: Date;
        operator_principal_fingerprint: string;
      }[]>`select id,payload_fingerprint,created_at,operator_principal_fingerprint
          from operator_channel_test_events
          where preparation_id=${preparationId}::uuid
            and event_type=${eventType}
            and idempotency_fingerprint=${idempotencyFingerprint}::char(64)`,
    );

    if (
      prior[0]
      && (
        prior[0].operator_principal_fingerprint !== principalFingerprint
        || prior[0].payload_fingerprint !== payloadFingerprint
      )
    ) {
      throw new OperatorChannelTestError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    }

    const preparation = (
      await tx.execute(
        sql<{
          recipient_fingerprint: string;
          operator_principal_fingerprint: string;
        }[]>`select recipient_fingerprint,operator_principal_fingerprint
            from operator_channel_test_preparations
            where id=${preparationId}::uuid for update`,
      )
    )[0];

    if (!preparation) {
      throw new OperatorChannelTestError('Operator test preparation not found', 'NOT_FOUND');
    }
    if (
      preparation.operator_principal_fingerprint !== principalFingerprint
      || preparation.recipient_fingerprint !== recipient.fingerprint
    ) {
      throw new OperatorChannelTestError('Operator test preparation is not valid for this runtime', 'INVALID_STATE');
    }

    const existing = await tx.execute(
      sql<{
        id: string;
        event_type: string;
        result: OperatorTestResult | null;
        created_at: Date;
        operator_principal_fingerprint: string;
        payload_fingerprint: string;
      }[]>`select id,event_type,result,created_at,operator_principal_fingerprint,payload_fingerprint
          from operator_channel_test_events
          where preparation_id=${preparationId}::uuid
          order by created_at,id`,
    );

    const sameType = existing.find((item) => item.event_type === eventType);
    if (sameType) {
      if (
        sameType.operator_principal_fingerprint !== principalFingerprint
        || sameType.result !== (result ?? null)
        || sameType.payload_fingerprint !== payloadFingerprint
      ) {
        throw new OperatorChannelTestError('Contradictory state transition', 'INVALID_STATE');
      }
      return {
        eventId: sameType.id,
        state: eventType,
        result,
        createdAt: sameType.created_at,
        replayed: true,
      };
    }

    const opened = existing.some((item) => item.event_type === 'OPENED');
    const confirmed = existing.find((item) => item.event_type === 'CONTACT_CONFIRMED');
    const responded = existing.some((item) => item.event_type === 'RESPONSE_RECORDED');

    if (eventType === 'OPENED' && (opened || confirmed || responded)) {
      throw new OperatorChannelTestError('Invalid OPENED transition', 'INVALID_STATE');
    }
    if (eventType === 'CONTACT_CONFIRMED' && (!opened || confirmed || responded)) {
      throw new OperatorChannelTestError('Invalid CONTACT_CONFIRMED transition', 'INVALID_STATE');
    }
    if (
      eventType === 'RESPONSE_RECORDED'
      && (confirmed?.result !== 'SENT_CONFIRMED' || responded)
    ) {
      throw new OperatorChannelTestError('Invalid RESPONSE_RECORDED transition', 'INVALID_STATE');
    }

    const saved = (
      await tx.execute(
        sql<{ id: string; created_at: Date }[]>`select id,created_at
          from public.append_operator_channel_test_event(
            ${preparationId}::uuid,${eventType},${result ?? null},${principalFingerprint}::char(64),
            ${payloadFingerprint}::char(64),${idempotencyFingerprint}::char(64)
          )`,
      )
    )[0]!;

    return {
      eventId: saved.id,
      state: eventType,
      result,
      createdAt: saved.created_at,
      replayed: false,
    };
  });
}
