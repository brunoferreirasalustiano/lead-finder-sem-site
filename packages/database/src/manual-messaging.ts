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
  email_ownership: 'BUSINESS' | 'PERSONAL' | 'UNKNOWN' | null;
  email_evidence_origin: string | null;
  email_human_decision: 'APPROVED' | 'REJECTED' | null;
};
async function candidate(
  tx: Pick<Database, 'execute'>,
  pilotRunId: string,
  leadId: string,
  contactId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`manual-messaging:${leadId}:${contactId}`},0))`,
  );
  const rows = await tx.execute(
    sql<
      Candidate[]
    >`select pr.status pilot_status,l.name,l.is_blocked,l.do_not_contact,l.crm_stage,c.id contact_id,c.type,c.normalized_value,c.source,c.is_valid,c.verified_at,exists(select 1 from contact_channel_authorizations a where a.contact_id=c.id and a.lead_id=l.id and a.channel='WHATSAPP' and a.purpose='B2B_PROSPECTION') whatsapp_authorized,exists(select 1 from campaign_opt_outs o where o.lead_id=l.id and o.channel is null) global_opt_out,exists(select 1 from campaign_opt_outs o where o.lead_id=l.id and o.channel='WHATSAPP') whatsapp_opt_out,exists(select 1 from campaign_opt_outs o where o.lead_id=l.id and o.channel='EMAIL') email_opt_out,coalesce((select r.decision='APPROVED' from pilot_reviews r where r.pilot_run_id=pl.pilot_run_id and r.lead_id=pl.lead_id order by r.version desc limit 1),false) review_approved,ee.ownership email_ownership,ee.origin email_evidence_origin,ee.human_decision email_human_decision from pilot_runs pr join pilot_leads pl on pl.pilot_run_id=pr.id join leads l on l.id=pl.lead_id join lead_contacts c on c.lead_id=l.id left join lateral(select e.ownership,e.origin,e.human_decision from contact_email_business_evidence e where e.contact_id=c.id and e.lead_id=l.id and e.channel='EMAIL' order by e.version desc limit 1) ee on true where pr.id=${pilotRunId}::uuid and l.id=${leadId}::uuid and c.id=${contactId}::uuid for update of pr,pl,l,c`,
  );
  const exact = (rows as unknown as Candidate[])[0];
  if (!exact) throw new ManualMessagingError('Contact does not belong to lead', 'INELIGIBLE');
  return exact;
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
  r.email_ownership === 'BUSINESS' &&
  r.email_human_decision === 'APPROVED' &&
  ['PUBLIC_BUSINESS_SOURCE', 'DIRECTLY_PROVIDED', 'SIGNED_RECORD'].includes(
    r.email_evidence_origin ?? '',
  ) &&
  !r.email_opt_out &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.normalized_value);
function choose(row: Candidate, requested: MessagingChannel) {
  if (requested === 'WHATSAPP' && wa(row)) return { row, channel: 'WHATSAPP' as const };
  if (requested === 'EMAIL' && email(row)) return { row, channel: 'EMAIL' as const };
  throw new ManualMessagingError('Requested contact and channel are not permitted', 'INELIGIBLE');
}
function requirePreparedContact(row: Candidate, channel: MessagingChannel) {
  if (!(channel === 'WHATSAPP' ? wa(row) : email(row)))
    throw new ManualMessagingError('Prepared contact is no longer eligible', 'INELIGIBLE');
}
const templateFor = (channel: MessagingChannel, id: string, version: string) => {
  const template = channel === 'WHATSAPP' ? approvedTemplates.whatsappV1 : approvedTemplates.emailV1;
  if (template.id !== id || template.version !== version)
    throw new ManualMessagingError('Persisted template is unavailable', 'INVALID_STATE');
  return template;
};
const variablesFor = (row: Candidate) => ({ EMPRESA: row.name ?? 'empresa', FONTE: row.source });
const contactFingerprint = (row: Candidate) =>
  digest({ contactId: row.contact_id, channel: row.type.toUpperCase(), value: row.normalized_value });
const responseFor = (row: Candidate, channel: MessagingChannel, templateId: string, templateVersion: string) => {
  const variables = variablesFor(row);
  const prepared = provider.prepare(templateFor(channel, templateId, templateVersion), variables);
  const link = channel === 'WHATSAPP'
    ? createWhatsAppManualUrl(row.normalized_value, prepared.body)
    : `mailto:${encodeURIComponent(row.normalized_value)}?subject=${encodeURIComponent(prepared.subject ?? '')}&body=${encodeURIComponent(prepared.body)}`;
  return { variables, prepared, link };
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
      sql<
        { id: string; contact_id: string; channel: MessagingChannel; payload_fingerprint: string; result_fingerprint: string; result_snapshot: unknown; prepared_at: Date; operator_principal_id: string }[]
      >`select id,contact_id,channel,payload_fingerprint,result_fingerprint,result_snapshot,prepared_at,operator_principal_id from pilot_manual_message_preparations where pilot_run_id=${pilotRunId}::uuid and idempotency_key=${input.idempotencyKey}`,
    );
    if (prior[0] && (prior[0].operator_principal_id !== auth.principalId || prior[0].payload_fingerprint !== fingerprint))
      throw new ManualMessagingError('Idempotency conflict', 'IDEMPOTENCY_CONFLICT');
    if (prior[0]) {
      const persisted = prior[0];
      if (digest(persisted.result_snapshot) !== persisted.result_fingerprint)
        throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
      const snapshot = persisted.result_snapshot as Record<string, unknown>;
      if (
        !['WHATSAPP', 'EMAIL'].includes(String(snapshot['channel'])) ||
        typeof snapshot['templateId'] !== 'string' ||
        typeof snapshot['templateVersion'] !== 'string' ||
        typeof snapshot['variables'] !== 'object' ||
        typeof snapshot['contactFingerprint'] !== 'string' ||
        typeof snapshot['messageFingerprint'] !== 'string'
      ) throw new ManualMessagingError('Persisted preparation snapshot is invalid', 'INVALID_STATE');
      const persistedChannel = persisted.channel as MessagingChannel;
      const persistedContactId = String(persisted.contact_id);
      const row = await candidate(tx, pilotRunId, leadId, persistedContactId);
      requirePreparedContact(row, persistedChannel);
      if (contactFingerprint(row) !== snapshot['contactFingerprint'])
        throw new ManualMessagingError('Prepared contact changed', 'INVALID_STATE');
      const rebuilt = responseFor(row, persistedChannel, String(snapshot['templateId']), String(snapshot['templateVersion']));
      if (digest(rebuilt.variables) !== digest(snapshot['variables']) || rebuilt.prepared.fingerprint !== snapshot['messageFingerprint'])
        throw new ManualMessagingError('Persisted preparation cannot be reconstructed', 'INVALID_STATE');
      return {
        preparationId: persisted.id,
        state: 'PREPARED' as const,
        channel: snapshot['channel'] as MessagingChannel,
        templateId: snapshot['templateId'],
        templateVersion: snapshot['templateVersion'],
        contactFingerprint: snapshot['contactFingerprint'],
        messageFingerprint: snapshot['messageFingerprint'],
        message: rebuilt.prepared.body,
        subject: rebuilt.prepared.subject,
        link: rebuilt.link,
        preparedAt: persisted.prepared_at,
        replayed: true,
      };
    }
    const selected = choose(
      await candidate(tx, pilotRunId, leadId, input.contactId),
      input.requestedChannel,
    );
    const template =
      selected.channel === 'WHATSAPP' ? approvedTemplates.whatsappV1 : approvedTemplates.emailV1;
    if (template.id !== input.templateId || template.version !== input.templateVersion)
      throw new ManualMessagingError('Template is not approved', 'INELIGIBLE');
    const { variables, prepared, link } = responseFor(selected.row, selected.channel, template.id, template.version);
    const selectedContactFingerprint = contactFingerprint(selected.row);
    const snapshot = {
      channel: selected.channel,
      templateId: template.id,
      templateVersion: template.version,
      variables,
      contactFingerprint: selectedContactFingerprint,
      messageFingerprint: prepared.fingerprint,
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
      contactFingerprint: selectedContactFingerprint,
      messageFingerprint: prepared.fingerprint,
      message: prepared.body,
      subject: prepared.subject,
      link,
      preparedAt: saved.prepared_at,
      replayed: false,
    };
  });
}
