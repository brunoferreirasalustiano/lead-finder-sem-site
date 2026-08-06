import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { z } from 'zod';

const inputSchema = z.object({
  recipient: z.string().trim().toLowerCase().email().max(320),
  reason: z.enum(['HARD_BOUNCE', 'INVALID_CONTACT', 'OPT_OUT', 'COMPLAINT']),
  source: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  eventId: z.string().trim().min(1).max(500),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

class ReconciliationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const readStdin = async () => {
  process.stdin.setEncoding('utf8');
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
};

const canonicalFingerprint = (
  key: string,
  input: z.infer<typeof inputSchema>,
) => createHmac('sha256', key).update(JSON.stringify({
  recipient: input.recipient,
  reason: input.reason,
  source: input.source,
  eventId: input.eventId,
  occurredAt: new Date(input.occurredAt).toISOString(),
})).digest('hex');

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new ReconciliationError('DATABASE_URL_REQUIRED');
  const fingerprintKey = process.env['EMAIL_SUPPRESSION_FINGERPRINT_KEY']?.trim() ?? '';
  if (fingerprintKey.length < 32) {
    throw new ReconciliationError('EMAIL_SUPPRESSION_FINGERPRINT_KEY_INVALID');
  }

  const rawInput = await readStdin();
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawInput);
  } catch {
    throw new ReconciliationError('INPUT_JSON_INVALID');
  }
  const parsed = inputSchema.safeParse(decoded);
  if (!parsed.success) throw new ReconciliationError('INPUT_CONTRACT_INVALID');

  const eventFingerprint = canonicalFingerprint(fingerprintKey, parsed.data);
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const contacts = await sql<{ contact_id: string; lead_id: string; fingerprint: string }[]>`
      select id contact_id,lead_id,contact_resolution_fingerprint fingerprint
      from public.lead_contacts
      where upper(type)='EMAIL'
        and lower(normalized_value)=${parsed.data.recipient}
      order by id
      limit 2`;
    if (contacts.length === 0) throw new ReconciliationError('CONTACT_NOT_FOUND');
    if (contacts.length !== 1) throw new ReconciliationError('CONTACT_MATCH_AMBIGUOUS');
    const contact = contacts[0]!;

    const result = (await sql<{
      replayed: boolean;
      contact_invalidated: boolean;
      lead_email_suppressed: boolean;
    }[]>`
      select replayed,contact_invalidated,lead_email_suppressed
      from public.record_email_delivery_suppression(
        ${contact.contact_id}::uuid,
        ${contact.lead_id}::uuid,
        ${contact.fingerprint}::char(64),
        ${parsed.data.reason},
        ${parsed.data.source},
        ${eventFingerprint}::char(64),
        ${new Date(parsed.data.occurredAt)}::timestamptz
      )`)[0];
    if (!result) throw new ReconciliationError('SUPPRESSION_RESULT_EMPTY');

    console.log(JSON.stringify({
      result: 'EMAIL_SUPPRESSION_RECORDED',
      reason: parsed.data.reason,
      replayed: result.replayed,
      contactInvalidated: result.contact_invalidated,
      leadEmailSuppressed: result.lead_email_suppressed,
    }));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  const code = error instanceof ReconciliationError
    ? error.code
    : 'EMAIL_SUPPRESSION_RECONCILIATION_FAILED';
  console.error(JSON.stringify({ result: 'FAILED', code }));
  process.exitCode = 1;
});
