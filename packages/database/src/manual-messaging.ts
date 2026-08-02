import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
  type MessagingChannel,
} from '@lead-finder/messaging';
import { createWhatsAppManualUrl } from '@lead-finder/whatsapp';
import type { AuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';
export const CONTACT_RESOLUTION_PURPOSE = 'B2B_PROSPECTION' as const;
const E164_PHONE_PATTERN = String.raw`^\+[1-9][0-9]{7,14}$`;
export type ContactResolutionAction =
  | 'MANUAL_MESSAGE_PREPARE'
  | 'MANUAL_MESSAGE_REPLAY'
  | 'MANUAL_MESSAGE_OPEN';
export type ManualMessagingResult =
  | 'SENT_CONFIRMED'
  | 'NOT_SENT'
  | 'INVALID_CONTACT'
  | 'CHANNEL_UNAVAILABLE'
  | 'POSITIVE_REPLY'
  | 'NEGATIVE_REPLY'
  | 'OPT_OUT'
  | 'OPERATIONAL_ERROR';
export class ManualMessagingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID_STATE'
      | 'INELIGIBLE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'EMAIL_CONSUMER_UNAVAILABLE',
  ) {
    super(message);
  }
}
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clean = (v: string | undefined) =>
  Array.from(v ?? '', (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  })
    .join('')
    .trim()
    .slice(0, 500) || undefined;
const provider = new DeterministicFakeMessagingProvider();
type EligibleContact = {
  contact_id: string;
  channel: MessagingChannel;
  contact_fingerprint: string;
  legacy_contact_fingerprint: string;
  contact_source: string;
  lead_name: string;
  contact_value: string;
};
async function exactEligibleContact(
  tx: Pick<Database, 'execute'>,
  pilotRunId: string,
  leadId: string,
  contactId: string,
  requestedChannel: MessagingChannel,
) {
  // Fixed order shared with migration 0025 writers: lead, then lead+purpose.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'manual-messaging:' + leadId},0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`manual-messaging-purpose:${leadId}:${CONTACT_RESOLUTION_PURPOSE}`},0))`,
  );
  const rows = await tx.execute(
    sql<EligibleContact[]>`select c.id contact_id,c.normalized_value contact_value,${requestedChannel}::text channel,
      c.contact_resolution_fingerprint contact_fingerprint,
      pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(
            pg_catalog.format(
              '{"channel":%s,"contactId":%s,"value":%s}',
              pg_catalog.to_json(upper(c.type))::text,
              pg_catalog.to_json(c.id::text)::text,
              pg_catalog.to_json(c.normalized_value)::text
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) legacy_contact_fingerprint,
      c.source contact_source,coalesce(l.name,'empresa') lead_name
      from pilot_runs pr
      join pilot_leads pl on pl.pilot_run_id=pr.id
      join leads l on l.id=pl.lead_id
      join lead_contacts c on c.id=${contactId}::uuid and c.lead_id=l.id
      left join lateral(
        select e.ownership,e.origin,e.human_decision
        from contact_email_business_evidence e
        where e.contact_id=c.id and e.lead_id=l.id and e.channel='EMAIL'
        order by e.version desc limit 1
      ) ee on true
      where pr.id=${pilotRunId}::uuid and l.id=${leadId}::uuid
        and pr.status='RUNNING'
        and coalesce((select r.decision='APPROVED' from pilot_reviews r
          where r.pilot_run_id=pl.pilot_run_id and r.lead_id=pl.lead_id
          order by r.version desc limit 1),false)
        and not l.is_blocked and not l.do_not_contact
        and l.crm_stage is distinct from 'NAO_CONTATAR'
        and c.is_valid and c.verified_at is not null and btrim(c.source)<>''
        and not exists(select 1 from campaign_opt_outs o
          where o.lead_id=l.id and (o.channel is null or o.channel=${requestedChannel}))
        and (
          (${requestedChannel}='WHATSAPP'
            and upper(c.type) in ('TELEFONE','PHONE','WHATSAPP')
            and c.normalized_value ~ ${E164_PHONE_PATTERN}
            and exists(select 1 from contact_channel_authorizations a
              where a.contact_id=c.id and a.lead_id=l.id
                and a.channel='WHATSAPP' and a.purpose=${CONTACT_RESOLUTION_PURPOSE}
                and not exists(select 1 from contact_channel_authorization_revocations rev
                  where rev.authorization_id=a.id and rev.contact_id=c.id
                    and rev.lead_id=l.id and rev.purpose=${CONTACT_RESOLUTION_PURPOSE})))
          or
          (${requestedChannel}='EMAIL'
            and upper(c.type)='EMAIL'
            and c.normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
            and ee.ownership='BUSINESS' and ee.human_decision='APPROVED'
            and ee.origin in ('PUBLIC_BUSINESS_SOURCE','DIRECTLY_PROVIDED','SIGNED_RECORD'))
        )
      for update of pr,pl,l,c`,
  );
  const row = (rows as unknown as EligibleContact[])[0];
  if (!row) throw new ManualMessagingError('Requested contact is ineligible', 'INELIGIBLE');
  return row;
}
const templateFor = (channel: MessagingChannel, id: string, version: string) => {
  const template = channel === 'WHATSAPP' ? approvedTemplates.whatsappV1 : approvedTemplates.emailV1;
  if (template.id !== id || template.version !== version)
    throw new ManualMessagingError('Persisted template is unavailable', 'INVALID_STATE');
  return template;
};
const renderedVariablesFor = (row: EligibleContact, channel: MessagingChannel) =>
  channel === 'WHATSAPP'
    ? { EMPRESA: row.lead_name }
    : { EMPRESA: row.lead_name, FONTE: row.contact_source };
const legacyVariablesFor = (row: EligibleContact) => ({
  EMPRESA: row.lead_name,
  FONTE: row.contact_source,
});
const preparedFor = (
  row: EligibleContact,
  channel: MessagingChannel,
  templateId: string,
  templateVersion: string,
  variables: Readonly<Record<string, string>>,
) => provider.prepare(templateFor(channel, templateId, templateVersion), variables);
const snapshotRecord = (value: unknown) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
  return value as Record<string, unknown>;
};
const validatePreparedSnapshot = (
  row: EligibleContact,
  persistedChannel: MessagingChannel,
  resultSnapshot: unknown,
  resultFingerprint: string,
) => {
  if (digest(resultSnapshot) !== resultFingerprint)
    throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
  const snapshot = snapshotRecord(resultSnapshot);
  if (
    snapshot['channel'] !== persistedChannel ||
    typeof snapshot['templateId'] !== 'string' ||
    typeof snapshot['templateVersion'] !== 'string' ||
    typeof snapshot['contactFingerprint'] !== 'string' ||
    typeof snapshot['messageFingerprint'] !== 'string'
  ) throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');

  if (snapshot['schemaVersion'] === 2) {
    if (typeof snapshot['renderedInputsFingerprint'] !== 'string')
      throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
    if (row.contact_fingerprint !== snapshot['contactFingerprint'])
      throw new ManualMessagingError('Prepared contact changed', 'INVALID_STATE');
    const variables = renderedVariablesFor(row, persistedChannel);
    const prepared = preparedFor(
      row,
      persistedChannel,
      snapshot['templateId'],
      snapshot['templateVersion'],
      variables,
    );
    if (
      digest(variables) !== snapshot['renderedInputsFingerprint'] ||
      prepared.fingerprint !== snapshot['messageFingerprint']
    ) throw new ManualMessagingError('Persisted preparation cannot be reconstructed', 'INVALID_STATE');
    return { prepared, contactFingerprint: row.contact_fingerprint };
  }

  if (snapshot['schemaVersion'] === undefined && snapshot['variables'] !== null && typeof snapshot['variables'] === 'object') {
    if (row.legacy_contact_fingerprint !== snapshot['contactFingerprint'])
      throw new ManualMessagingError('Prepared contact changed', 'INVALID_STATE');
    const variables = legacyVariablesFor(row);
    const prepared = preparedFor(
      row,
      persistedChannel,
      snapshot['templateId'],
      snapshot['templateVersion'],
      variables,
    );
    if (
      digest(variables) !== digest(snapshot['variables']) ||
      prepared.fingerprint !== snapshot['messageFingerprint']
    ) throw new ManualMessagingError('Persisted preparation cannot be reconstructed', 'INVALID_STATE');
    return { prepared, contactFingerprint: row.contact_fingerprint };
  }

  throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
};
export async function prepareManualMessage(
  db: Database,
  pilotRunId: string,
  leadId: string,
  input: {
    contactId: string;
    requestedChannel: MessagingChannel;
    templateId: string;
    templateVersion: string;
    idempotencyKey: string;
  },
  auth: AuthorizationContext,
) {
  const fingerprint = digest({ pilotRunId, leadId, ...input, principalId: auth.principalId });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${pilotRunId}:${input.idempotencyKey}`},0))`,
    );
    const prior = await tx.execute(
      sql<{ id: string; contact_id: string; channel: MessagingChannel; payload_fingerprint: string; result_fingerprint: string; result_snapshot: unknown; prepared_at: Date; operator_principal_id: string }[]>`select id,contact_id,channel,payload_fingerprint,result_fingerprint,result_snapshot,prepared_at,operator_principal_id from pilot_manual_message_preparations where pilot_run_id=${pilotRunId}::uuid and idempotency_key=${input.idempotencyKey}`,
    );
    if (prior[0] && (prior[0].operator_principal_id !== auth.principalId || prior[0].payload_fingerprint !== fingerprint))
      throw new ManualMessagingError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    if (prior[0]) {
      const persisted = prior[0];
      const persistedChannel = persisted.channel as MessagingChannel;
      const row = await exactEligibleContact(
        tx,
        pilotRunId,
        leadId,
        String(persisted.contact_id),
        persistedChannel,
      );
      const validated = validatePreparedSnapshot(
        row,
        persistedChannel,
        persisted.result_snapshot,
        String(persisted.result_fingerprint),
      );
      if (persistedChannel === 'EMAIL')
        throw new ManualMessagingError(
          'Restricted local email consumer is unavailable',
          'EMAIL_CONSUMER_UNAVAILABLE',
        );
      const snapshot = snapshotRecord(persisted.result_snapshot);
      return {
        preparationId: persisted.id,
        state: 'PREPARED' as const,
        channel: persistedChannel,
        templateId: String(snapshot['templateId']),
        templateVersion: String(snapshot['templateVersion']),
        contactFingerprint: validated.contactFingerprint,
        messageFingerprint: validated.prepared.fingerprint,
        preparedAt: persisted.prepared_at,
        replayed: true,
      };
    }
    const selected = await exactEligibleContact(
      tx,
      pilotRunId,
      leadId,
      input.contactId,
      input.requestedChannel,
    );
    const template = templateFor(input.requestedChannel, input.templateId, input.templateVersion);
    if (template.id !== input.templateId || template.version !== input.templateVersion)
      throw new ManualMessagingError('Template is not approved', 'INELIGIBLE');
    if (input.requestedChannel === 'EMAIL')
      throw new ManualMessagingError(
        'Restricted local email consumer is unavailable',
        'EMAIL_CONSUMER_UNAVAILABLE',
      );
    const variables = renderedVariablesFor(selected, input.requestedChannel);
    const prepared = provider.prepare(template, variables);
    const renderedInputsFingerprint = digest(variables);
    const snapshot = {
      schemaVersion: 2,
      channel: input.requestedChannel,
      templateId: template.id,
      templateVersion: template.version,
      variables: {},
      renderedInputsFingerprint,
      contactFingerprint: selected.contact_fingerprint,
      messageFingerprint: prepared.fingerprint,
    };
    const saved = (
      await tx.execute(
        sql<{ id: string; prepared_at: Date }[]>`insert into pilot_manual_message_preparations(pilot_run_id,lead_id,contact_id,channel,template_id,template_version,operator_principal_id,payload_fingerprint,idempotency_key,result_fingerprint,result_snapshot) values(${pilotRunId}::uuid,${leadId}::uuid,${selected.contact_id}::uuid,${input.requestedChannel},${template.id},${template.version},${auth.principalId},${fingerprint},${input.idempotencyKey},${digest(snapshot)},${JSON.stringify(snapshot)}::jsonb) returning id,prepared_at`,
      )
    )[0]!;
    return {
      preparationId: saved.id,
      state: 'PREPARED' as const,
      channel: input.requestedChannel,
      templateId: template.id,
      templateVersion: template.version,
      contactFingerprint: selected.contact_fingerprint,
      messageFingerprint: prepared.fingerprint,
      preparedAt: saved.prepared_at,
      replayed: false,
    };
  });
}

/**
 * Builds a browser hand-off for an already prepared WhatsApp message.
 * The URL is intentionally kept out of JSON DTOs because it contains the
 * recipient and message; callers should issue a redirect after authorization.
 */
export async function getPreparedWhatsAppLink(
  db: Database,
  preparationId: string,
  auth: AuthorizationContext,
) {
  return db.transaction(async (tx) => {
    const prep = (await tx.execute(sql<{
      pilot_run_id: string;
      lead_id: string;
      contact_id: string;
      channel: MessagingChannel;
      operator_principal_id: string;
      result_fingerprint: string;
      result_snapshot: unknown;
    }[]>`select pilot_run_id,lead_id,contact_id,channel,result_fingerprint,result_snapshot
      ,operator_principal_id
      from pilot_manual_message_preparations
      where id=${preparationId}::uuid`))[0];
    if (!prep) throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    if (prep.operator_principal_id !== auth.principalId)
      throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    if (prep.channel !== 'WHATSAPP') {
      throw new ManualMessagingError('Preparation is not a WhatsApp message', 'INVALID_STATE');
    }
    const events = await tx.execute(sql<{ event_type: string }[]>`select event_type
      from pilot_manual_message_events
      where preparation_id=${preparationId}::uuid`);
    if (!events.some((event) => event.event_type === 'OPENED'))
      throw new ManualMessagingError('Preparation must be opened before redirect', 'INVALID_STATE');
    if (events.some((event) => event.event_type === 'CONTACT_CONFIRMED' || event.event_type === 'RESPONSE_RECORDED'))
      throw new ManualMessagingError('Preparation is already concluded', 'INVALID_STATE');

    const eligible = await exactEligibleContact(
      tx,
      String(prep.pilot_run_id),
      String(prep.lead_id),
      String(prep.contact_id),
      'WHATSAPP',
    );
    const validated = validatePreparedSnapshot(
      eligible,
      'WHATSAPP',
      prep.result_snapshot,
      String(prep.result_fingerprint),
    );
    return {
      link: createWhatsAppManualUrl(eligible.contact_value, validated.prepared.body),
    };
  });
}

export async function sendPreparedManualEmail(
  db: Database,
  preparationId: string,
  auth: AuthorizationContext,
  input: {
    sender: string;
    fingerprintKey: string;
    sendEnabled: boolean;
    killSwitchEnabled: boolean;
    deliver: (message: { subject: string; body: string; recipient: string }) => Promise<{ provider: 'GMAIL_API'; messageId: string }>;
  },
) {
  if (!input.sendEnabled || input.killSwitchEnabled)
    throw new ManualMessagingError('Manual email delivery is disabled', 'EMAIL_CONSUMER_UNAVAILABLE');
  const fingerprint = (value: string) => createHash('sha256').update(`${input.fingerprintKey}:${value}`).digest('hex');
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`manual-email:${preparationId}`},0))`);
    const prep = (await tx.execute(sql<{ pilot_run_id: string; lead_id: string; contact_id: string; channel: MessagingChannel; result_fingerprint: string; result_snapshot: unknown }[]>`select pilot_run_id,lead_id,contact_id,channel,result_fingerprint,result_snapshot from pilot_manual_message_preparations where id=${preparationId}::uuid for update`))[0];
    if (!prep) throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    if (prep.channel !== 'EMAIL') throw new ManualMessagingError('Only email preparations can be sent', 'INVALID_STATE');
    const opened = (await tx.execute(sql<{ id: string }[]>`select id from pilot_manual_message_events where preparation_id=${preparationId}::uuid and event_type='OPENED' limit 1`))[0];
    if (!opened) throw new ManualMessagingError('Preparation must be opened before delivery', 'INVALID_STATE');
    const prior = (await tx.execute(sql<{ id: string }[]>`select id from pilot_manual_email_send_attempts where preparation_id=${preparationId}::uuid`))[0];
    if (prior) throw new ManualMessagingError('Email delivery already reserved', 'IDEMPOTENCY_CONFLICT');
    const eligible = await exactEligibleContact(tx, String(prep.pilot_run_id), String(prep.lead_id), String(prep.contact_id), 'EMAIL');
    const validated = validatePreparedSnapshot(eligible, 'EMAIL', prep.result_snapshot, String(prep.result_fingerprint));
    if (!validated.prepared.subject) throw new ManualMessagingError('Prepared email subject is missing', 'INVALID_STATE');
    const attempt = (await tx.execute(sql<{ id: string }[]>`insert into pilot_manual_email_send_attempts(preparation_id,pilot_run_id,lead_id,contact_id,operator_principal_id,sender_fingerprint,recipient_fingerprint,message_fingerprint,provider) values(${preparationId}::uuid,${prep.pilot_run_id}::uuid,${prep.lead_id}::uuid,${prep.contact_id}::uuid,${auth.principalId},${fingerprint(input.sender)},${fingerprint(eligible.contact_value)},${validated.prepared.fingerprint},'GMAIL_API') returning id`))[0]!;
    return { attemptId: attempt.id, subject: validated.prepared.subject, body: validated.prepared.body, recipient: eligible.contact_value };
  });
  try {
    const receipt = await input.deliver({ subject: reservation.subject, body: reservation.body, recipient: reservation.recipient });
    await db.execute(sql`insert into pilot_manual_email_send_events(attempt_id,event_type,provider_message_fingerprint) values(${reservation.attemptId}::uuid,'DELIVERED',${fingerprint(receipt.messageId)})`);
    return { state: 'DELIVERED' as const, provider: receipt.provider, messageIdFingerprint: fingerprint(receipt.messageId), replayed: false };
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'DELIVERY_REJECTED';
    await db.execute(sql`insert into pilot_manual_email_send_events(attempt_id,event_type,error_code) values(${reservation.attemptId}::uuid,'FAILED',${code})`);
    throw new ManualMessagingError('Manual email delivery failed', 'EMAIL_CONSUMER_UNAVAILABLE');
  }
}
export async function resolveNarrowContact(
  db: Database,
  input: {
    pilotRunId: string;
    leadId: string;
    contactId: string;
    requestedChannel: MessagingChannel;
    principalId: string;
    action: ContactResolutionAction;
    purpose: typeof CONTACT_RESOLUTION_PURPOSE;
    localManualMode: boolean;
    noProviderMode: boolean;
    killSwitchEnabled: boolean;
    manualMessagingEnabled: boolean;
    realProviderEnabled: boolean;
  },
) {
  if (
    input.killSwitchEnabled ||
    !input.manualMessagingEnabled ||
    !input.localManualMode ||
    !input.noProviderMode ||
    input.realProviderEnabled ||
    input.purpose !== CONTACT_RESOLUTION_PURPOSE
  ) throw new ManualMessagingError('Contact resolution is disabled', 'INELIGIBLE');
  const rows = await (async () => {
    try {
      return await db.execute(
        sql<{ contact_value: string; contact_fingerprint: string; contact_source: string; lead_name: string | null }[]>`select * from resolve_narrow_contact(
          ${input.pilotRunId}::uuid,
          ${input.leadId}::uuid,
          ${input.contactId}::uuid,
          ${input.requestedChannel},
          ${input.principalId},
          ${input.action},
          ${input.purpose}
        )`,
      );
    } catch {
      throw new ManualMessagingError('Requested contact is ineligible', 'INELIGIBLE');
    }
  })();
  const resolved = (rows as unknown as {
    contact_value: string;
    contact_fingerprint: string;
    contact_source: string;
    lead_name: string | null;
  }[])[0];
  if (!resolved) throw new ManualMessagingError('Requested contact is ineligible', 'INELIGIBLE');
  return {
    value: resolved.contact_value,
    fingerprint: resolved.contact_fingerprint,
    source: resolved.contact_source,
    leadName: resolved.lead_name ?? 'empresa',
    channel: input.requestedChannel,
  };
}
export const recordManualOpen = (
  db: Database,
  id: string,
  input: { idempotencyKey: string },
  auth: AuthorizationContext,
) => event(db, id, 'OPENED', undefined, input.idempotencyKey, undefined, auth);
export const confirmManualResult = (
  db: Database,
  id: string,
  input: {
    result: Extract<ManualMessagingResult, 'SENT_CONFIRMED' | 'NOT_SENT' | 'INVALID_CONTACT' | 'CHANNEL_UNAVAILABLE' | 'OPERATIONAL_ERROR'>;
    idempotencyKey: string;
    observation?: string | undefined;
  },
  auth: AuthorizationContext,
) => event(db, id, 'CONTACT_CONFIRMED', input.result, input.idempotencyKey, input.observation, auth);
export const recordManualResponse = (
  db: Database,
  id: string,
  input: {
    result: Extract<ManualMessagingResult, 'POSITIVE_REPLY' | 'NEGATIVE_REPLY' | 'OPT_OUT'>;
    idempotencyKey: string;
    observation?: string | undefined;
  },
  auth: AuthorizationContext,
) => event(db, id, 'RESPONSE_RECORDED', input.result, input.idempotencyKey, input.observation, auth);
async function event(
  db: Database,
  id: string,
  eventType: 'OPENED' | 'CONTACT_CONFIRMED' | 'RESPONSE_RECORDED',
  result: ManualMessagingResult | undefined,
  key: string,
  observation: string | undefined,
  auth: AuthorizationContext,
) {
  const fingerprint = digest({
    id,
    eventType,
    result,
    observation: clean(observation),
    principalId: auth.principalId,
  });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`manual-message-preparation:${id}`},0))`,
    );
    const prior = await tx.execute(
      sql<{ id: string; payload_fingerprint: string; created_at: Date; operator_principal_id: string }[]>`select id,payload_fingerprint,created_at,operator_principal_id from pilot_manual_message_events where preparation_id=${id}::uuid and event_type=${eventType} and idempotency_key=${key}`,
    );
    if (
      prior[0] &&
      (prior[0].operator_principal_id !== auth.principalId || prior[0].payload_fingerprint !== fingerprint)
    ) throw new ManualMessagingError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    const p = (
      await tx.execute(
      sql<{ pilot_run_id: string; lead_id: string; contact_id: string; channel: MessagingChannel; operator_principal_id: string; result_fingerprint: string; result_snapshot: unknown }[]>`select pilot_run_id,lead_id,contact_id,channel,operator_principal_id,result_fingerprint,result_snapshot from pilot_manual_message_preparations where id=${id}::uuid for update`,
      )
    )[0] as unknown as
      | { pilot_run_id: string; lead_id: string; contact_id: string; channel: MessagingChannel; operator_principal_id: string; result_fingerprint: string; result_snapshot: unknown }
      | undefined;
    if (!p) throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    if (p.operator_principal_id !== auth.principalId)
      throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    const eligible = await exactEligibleContact(tx, p.pilot_run_id, p.lead_id, p.contact_id, p.channel);
    if (eventType === 'OPENED')
      validatePreparedSnapshot(eligible, p.channel, p.result_snapshot, String(p.result_fingerprint));
    const existing = await tx.execute(
      sql<{ id: string; event_type: string; result: ManualMessagingResult | null; created_at: Date; operator_principal_id: string; payload_fingerprint: string }[]>`select id,event_type,result,created_at,operator_principal_id,payload_fingerprint from pilot_manual_message_events where preparation_id=${id}::uuid order by created_at,id`,
    );
    const confirmed = existing.find((item) => item.event_type === 'CONTACT_CONFIRMED');
    const responded = existing.some((item) => item.event_type === 'RESPONSE_RECORDED');
    if (eventType === 'OPENED' && (confirmed || responded))
      throw new ManualMessagingError('Invalid OPENED transition', 'INVALID_STATE');
    const sameType = existing.find((item) => item.event_type === eventType);
    if (sameType) {
      if (sameType.operator_principal_id !== auth.principalId || sameType.result !== (result ?? null) || sameType.payload_fingerprint !== fingerprint)
        throw new ManualMessagingError('Contradictory state transition', 'INVALID_STATE');
      return { eventId: sameType.id, state: eventType, result, createdAt: sameType.created_at, replayed: true };
    }
    const opened = existing.some((item) => item.event_type === 'OPENED');
    if (eventType === 'OPENED' && (opened || confirmed || responded))
      throw new ManualMessagingError('Invalid OPENED transition', 'INVALID_STATE');
    if (eventType === 'CONTACT_CONFIRMED' && (!opened || confirmed || responded))
      throw new ManualMessagingError('Invalid CONTACT_CONFIRMED transition', 'INVALID_STATE');
    if (eventType === 'RESPONSE_RECORDED' && (confirmed?.result !== 'SENT_CONFIRMED' || responded))
      throw new ManualMessagingError('Invalid RESPONSE_RECORDED transition', 'INVALID_STATE');
    if (eventType === 'RESPONSE_RECORDED' && result === 'OPT_OUT')
      await tx.execute(
        sql`insert into campaign_opt_outs(lead_id,channel,reason,source) values(${p.lead_id}::uuid,${p.channel},'MANUAL_OPT_OUT','PILOT_MANUAL_MESSAGING') on conflict do nothing`,
      );
    const row = (
      await tx.execute(
        sql<{ id: string; created_at: Date }[]>`insert into pilot_manual_message_events(preparation_id,event_type,result,operator_principal_id,observation,payload_fingerprint,idempotency_key) values(${id}::uuid,${eventType},${result ?? null},${auth.principalId},${clean(observation) ?? null},${fingerprint},${key}) returning id,created_at`,
      )
    )[0]!;
    return {
      eventId: row.id,
      state: eventType,
      result,
      createdAt: row.created_at,
      replayed: false,
    };
  });
}
