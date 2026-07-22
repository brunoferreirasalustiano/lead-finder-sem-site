import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  approvedTemplates,
  DeterministicFakeMessagingProvider,
  type MessagingChannel,
} from '@lead-finder/messaging';
import { createWhatsAppManualUrl, normalizePhoneE164 } from '@lead-finder/whatsapp';
import type { AuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';
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
    public readonly code: 'NOT_FOUND' | 'INVALID_STATE' | 'INELIGIBLE' | 'IDEMPOTENCY_CONFLICT',
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
type Candidate = {
  pilot_status: string;
  name: string | null;
  is_blocked: boolean;
  do_not_contact: boolean;
  crm_stage: string | null;
  contact_id: string;
  type: string;
  normalized_value: string;
  source: string;
  is_valid: boolean;
  verified_at: Date | null;
  whatsapp_authorized: boolean;
  global_opt_out: boolean;
  whatsapp_opt_out: boolean;
  email_opt_out: boolean;
  review_approved: boolean;
};
async function candidates(tx: Pick<Database, 'execute'>, pilotRunId: string, leadId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'manual-messaging:' + leadId},0))`,
  );
  const rows = await tx.execute(
    sql<
      Candidate[]
    >`select pr.status pilot_status,l.name,l.is_blocked,l.do_not_contact,l.crm_stage,c.id contact_id,c.type,c.normalized_value,c.source,c.is_valid,c.verified_at,exists(select 1 from contact_channel_authorizations a where a.contact_id=c.id and a.lead_id=l.id and a.channel='WHATSAPP' and a.purpose='B2B_PROSPECTION') whatsapp_authorized,exists(select 1 from campaign_opt_outs o where o.lead_id=l.id and o.channel is null) global_opt_out,exists(select 1 from campaign_opt_outs o where o.lead_id=l.id and o.channel='WHATSAPP') whatsapp_opt_out,exists(select 1 from campaign_opt_outs o where o.lead_id=l.id and o.channel='EMAIL') email_opt_out,coalesce((select r.decision='APPROVED' from pilot_reviews r where r.pilot_run_id=pl.pilot_run_id and r.lead_id=pl.lead_id order by r.version desc limit 1),false) review_approved from pilot_runs pr join pilot_leads pl on pl.pilot_run_id=pr.id join leads l on l.id=pl.lead_id join lead_contacts c on c.lead_id=l.id where pr.id=${pilotRunId}::uuid and l.id=${leadId}::uuid for update of pr,pl,l,c`,
  );
  return rows as unknown as Candidate[];
}
const base = (r: Candidate) =>
  r.pilot_status === 'RUNNING' &&
  r.review_approved &&
  !r.is_blocked &&
  !r.do_not_contact &&
  r.crm_stage !== 'NAO_CONTATAR' &&
  !r.global_opt_out &&
  r.is_valid &&
  r.verified_at !== null &&
  r.source.trim().length > 0;
const wa = (r: Candidate) =>
  base(r) &&
  ['TELEFONE', 'PHONE', 'WHATSAPP'].includes(r.type.toUpperCase()) &&
  r.whatsapp_authorized &&
  !r.whatsapp_opt_out &&
  normalizePhoneE164(r.normalized_value).ok;
const email = (r: Candidate) =>
  base(r) &&
  r.type.toUpperCase() === 'EMAIL' &&
  !r.email_opt_out &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.normalized_value);
function choose(rows: Candidate[], requested: MessagingChannel, contactId: string) {
  const exact = rows.find((r) => r.contact_id === contactId);
  if (!exact) throw new ManualMessagingError('Contact does not belong to lead', 'INELIGIBLE');
  if (requested === 'WHATSAPP') {
    if (wa(exact)) return { row: exact, channel: 'WHATSAPP' as const };
    const fallback = rows.find(email);
    if (fallback) return { row: fallback, channel: 'EMAIL' as const };
  } else if (email(exact)) return { row: exact, channel: 'EMAIL' as const };
  throw new ManualMessagingError('No permitted channel', 'INELIGIBLE');
}
function requirePreparedContact(rows: Candidate[], channel: MessagingChannel, contactId: string) {
  const exact = rows.find((row) => row.contact_id === contactId);
  if (!exact || !(channel === 'WHATSAPP' ? wa(exact) : email(exact)))
    throw new ManualMessagingError('Prepared contact is no longer eligible', 'INELIGIBLE');
}
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
      sql<
        { id: string; contact_id: string; channel: MessagingChannel; payload_fingerprint: string; result_fingerprint: string; result_snapshot: unknown; prepared_at: Date; operator_principal_id: string }[]
      >`select id,contact_id,channel,payload_fingerprint,result_fingerprint,result_snapshot,prepared_at,operator_principal_id from pilot_manual_message_preparations where pilot_run_id=${pilotRunId}::uuid and idempotency_key=${input.idempotencyKey}`,
    );
    if (prior[0] && (prior[0].operator_principal_id !== auth.principalId || prior[0].payload_fingerprint !== fingerprint))
      throw new ManualMessagingError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    if (prior[0]) {
      requirePreparedContact(
        await candidates(tx, pilotRunId, leadId),
        prior[0].channel as MessagingChannel,
        String(prior[0].contact_id),
      );
      if (digest(prior[0].result_snapshot) !== prior[0].result_fingerprint)
        throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
      const snapshot = prior[0].result_snapshot as Record<string, unknown>;
      if (
        !['WHATSAPP', 'EMAIL'].includes(String(snapshot['channel'])) ||
        typeof snapshot['templateId'] !== 'string' ||
        typeof snapshot['templateVersion'] !== 'string' ||
        typeof snapshot['message'] !== 'string' ||
        typeof snapshot['link'] !== 'string' ||
        (snapshot['subject'] !== undefined && typeof snapshot['subject'] !== 'string')
      ) throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
      return {
        preparationId: prior[0].id,
        state: 'PREPARED' as const,
        channel: snapshot['channel'] as MessagingChannel,
        templateId: snapshot['templateId'],
        templateVersion: snapshot['templateVersion'],
        message: snapshot['message'],
        subject: snapshot['subject'],
        link: snapshot['link'],
        preparedAt: prior[0].prepared_at,
        replayed: true,
      };
    }
    const selected = choose(
      await candidates(tx, pilotRunId, leadId),
      input.requestedChannel,
      input.contactId,
    );
    const template =
      selected.channel === 'WHATSAPP' ? approvedTemplates.whatsappV1 : approvedTemplates.emailV1;
    if (
      selected.channel === input.requestedChannel &&
      (template.id !== input.templateId || template.version !== input.templateVersion)
    )
      throw new ManualMessagingError('Template is not approved', 'INELIGIBLE');
    const prepared = provider.prepare(template, {
      EMPRESA: selected.row.name ?? 'empresa',
      FONTE: selected.row.source,
    });
    const link =
      selected.channel === 'WHATSAPP'
        ? createWhatsAppManualUrl(selected.row.normalized_value, prepared.body)
        : `mailto:${encodeURIComponent(selected.row.normalized_value)}?subject=${encodeURIComponent(prepared.subject ?? '')}&body=${encodeURIComponent(prepared.body)}`;
    const snapshot = {
      channel: selected.channel,
      templateId: template.id,
      templateVersion: template.version,
      message: prepared.body,
      ...(prepared.subject === undefined ? {} : { subject: prepared.subject }),
      link,
    };
    const saved = (
        await tx.execute(
          sql<
            { id: string; prepared_at: Date }[]
          >`insert into pilot_manual_message_preparations(pilot_run_id,lead_id,contact_id,channel,template_id,template_version,operator_principal_id,payload_fingerprint,idempotency_key,result_fingerprint,result_snapshot) values(${pilotRunId}::uuid,${leadId}::uuid,${selected.row.contact_id}::uuid,${selected.channel},${template.id},${template.version},${auth.principalId},${fingerprint},${input.idempotencyKey},${digest(snapshot)},${JSON.stringify(snapshot)}::jsonb) returning id,prepared_at`,
        )
      )[0]!;
    return {
      preparationId: saved.id,
      state: 'PREPARED' as const,
      channel: selected.channel,
      templateId: template.id,
      templateVersion: template.version,
      message: prepared.body,
      subject: prepared.subject,
      link,
      preparedAt: saved.prepared_at,
      replayed: false,
    };
  });
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
    result: ManualMessagingResult;
    idempotencyKey: string;
    observation?: string | undefined;
  },
  auth: AuthorizationContext,
) =>
  event(db, id, 'CONTACT_CONFIRMED', input.result, input.idempotencyKey, input.observation, auth);
async function event(
  db: Database,
  id: string,
  eventType: 'OPENED' | 'CONTACT_CONFIRMED',
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
      sql`select pg_advisory_xact_lock(hashtextextended(${`${id}:${eventType}:${key}`},0))`,
    );
    const prior = await tx.execute(
      sql<
        { id: string; payload_fingerprint: string; created_at: Date; operator_principal_id: string }[]
      >`select id,payload_fingerprint,created_at,operator_principal_id from pilot_manual_message_events where preparation_id=${id}::uuid and event_type=${eventType} and idempotency_key=${key}`,
    );
    if (
      prior[0] &&
      (prior[0].operator_principal_id !== auth.principalId ||
        prior[0].payload_fingerprint !== fingerprint)
    )
      throw new ManualMessagingError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    if (prior[0])
      return {
        eventId: prior[0].id,
        state: eventType,
        result,
        createdAt: prior[0].created_at,
        replayed: true,
      };
    const p = (
      await tx.execute(
        sql<
          { pilot_run_id: string; lead_id: string; contact_id: string; channel: MessagingChannel }[]
        >`select pilot_run_id,lead_id,contact_id,channel from pilot_manual_message_preparations where id=${id}::uuid for update`,
      )
    )[0] as unknown as
      | { pilot_run_id: string; lead_id: string; contact_id: string; channel: MessagingChannel }
      | undefined;
    if (!p) throw new ManualMessagingError('Preparation not found', 'NOT_FOUND');
    requirePreparedContact(await candidates(tx, p.pilot_run_id, p.lead_id), p.channel, p.contact_id);
    if (eventType === 'CONTACT_CONFIRMED' && result === 'OPT_OUT')
      await tx.execute(
        sql`insert into campaign_opt_outs(lead_id,channel,reason,source) values(${p.lead_id}::uuid,${p.channel},'MANUAL_OPT_OUT','PILOT_MANUAL_MESSAGING') on conflict do nothing`,
      );
    const row = (
      await tx.execute(
        sql<
          { id: string; created_at: Date }[]
        >`insert into pilot_manual_message_events(preparation_id,event_type,result,operator_principal_id,observation,payload_fingerprint,idempotency_key) values(${id}::uuid,${eventType},${result ?? null},${auth.principalId},${clean(observation) ?? null},${fingerprint},${key}) returning id,created_at`,
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
