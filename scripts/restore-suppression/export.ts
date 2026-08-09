import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { connect, databaseUrl } from './db.js';
import { canonicalJson, sha256 } from './canonical.js';
import { manifestContentSchema, type PrecontactPermanentEvent, type SuppressionEntry, type SuppressionManifest } from './types.js';

export async function exportManifest(output: string, url = databaseUrl()): Promise<SuppressionManifest> {
  const sql = connect(url);
  try {
    const cutoffAt = new Date().toISOString();
    const rows = await sql<{ lead_id: string; osm_type: 'node'|'way'|'relation'; osm_id: string; is_blocked: boolean; do_not_contact: boolean; crm_stage: string|null; channel: 'EMAIL'|'WHATSAPP'|null; optout_at: Date|null; reason: string|null; source: string|null }[]>`
      SELECT l.id::text lead_id,l.osm_type,l.osm_id,l.is_blocked,l.do_not_contact,l.crm_stage,o.channel,o.created_at optout_at,o.reason,o.source
      FROM leads l LEFT JOIN campaign_opt_outs o ON o.lead_id=l.id
      WHERE l.is_blocked OR l.do_not_contact OR l.crm_stage='NAO_CONTATAR' OR o.id IS NOT NULL ORDER BY l.id,o.channel NULLS FIRST`;
    const entries: SuppressionEntry[] = [];
    const add = (row: typeof rows[number], suppressionType: SuppressionEntry['suppressionType'], occurredAt: Date|string, channel?: 'EMAIL'|'WHATSAPP', reasonCode: string = suppressionType, source = 'RESTORE_EXPORT') => entries.push({ leadId: row.lead_id, stableIdentity: { osmType: row.osm_type, osmId: row.osm_id }, suppressionType, monotonicState: 'ENFORCED', occurredAt: new Date(occurredAt).toISOString(), reasonCode: reasonCode.replace(/[^A-Z0-9_]/giu, '_').toUpperCase().slice(0,80) || suppressionType, operationalSource: source.replace(/[^A-Z0-9_.:-]/giu, '_').toUpperCase().slice(0,100) || 'RESTORE_EXPORT', ...(channel ? { channel } : {}) });
    for (const row of rows) {
      if (row.is_blocked && !entries.some((e) => e.leadId===row.lead_id && e.suppressionType==='IS_BLOCKED')) add(row,'IS_BLOCKED',cutoffAt);
      if (row.do_not_contact && !entries.some((e) => e.leadId===row.lead_id && e.suppressionType==='DO_NOT_CONTACT')) add(row,'DO_NOT_CONTACT',cutoffAt);
      if (row.crm_stage==='NAO_CONTATAR' && !entries.some((e) => e.leadId===row.lead_id && e.suppressionType==='CRM_NAO_CONTATAR')) add(row,'CRM_NAO_CONTATAR',cutoffAt);
      if (row.optout_at) add(row,row.channel ? 'OPT_OUT_CHANNEL':'OPT_OUT_GLOBAL',row.optout_at,row.channel ?? undefined,'EXISTING_OPT_OUT','CAMPAIGN_OPT_OUT');
    }
    const keyRows = await sql<{ key_digest: string }[]>`
      SELECT encode(extensions.digest(secret,'sha256'),'hex') key_digest
      FROM lead_finder_private.email_suppression_hmac_key
      WHERE singleton=true`;
    if (keyRows.length !== 1) throw new Error('PRECONTACT_SUPPRESSION_KEY_UNAVAILABLE');
    const fingerprintRows = await sql<{ identity_fingerprint: string }[]>`
      SELECT identity_fingerprint::text identity_fingerprint
      FROM lead_finder_private.email_contact_identities
      WHERE suppressed=true
      ORDER BY identity_fingerprint`;
    const eventRows = await sql<{ identity_fingerprint: string; reason: 'HARD_BOUNCE'|'INVALID_CONTACT'; source: string; event_fingerprint: string; occurred_at: Date }[]>`
      SELECT identity_fingerprint::text identity_fingerprint,reason,source,event_fingerprint::text event_fingerprint,occurred_at
      FROM public.email_precontact_delivery_suppressions
      ORDER BY occurred_at,event_fingerprint`;
    const fingerprints = fingerprintRows.map((row) => row.identity_fingerprint);
    const fingerprintSet = new Set(fingerprints);
    const events: PrecontactPermanentEvent[] = eventRows.map((row) => ({
      identityFingerprint: row.identity_fingerprint,
      reasonCode: row.reason,
      operationalSource: row.source,
      eventFingerprint: row.event_fingerprint,
      occurredAt: row.occurred_at.toISOString(),
    }));
    if (events.some((event) => !fingerprintSet.has(event.identityFingerprint))) throw new Error('PRECONTACT_SUPPRESSION_STATE_INCONSISTENT');
    const byType = Object.fromEntries(['IS_BLOCKED','DO_NOT_CONTACT','CRM_NAO_CONTATAR','OPT_OUT_GLOBAL','OPT_OUT_CHANNEL'].map((type) => [type, entries.filter((entry) => entry.suppressionType===type).length])) as Record<SuppressionEntry['suppressionType'],number>;
    const content = manifestContentSchema.parse({
      schemaVersion:'1.0', runId:randomUUID(), logicalOrigin:'DATABASE_PRE_RESTORE', cutoffAt, entries,
      counts:{ total:entries.length, byType },
      precontactPermanent:{
        keyDigest:keyRows[0]!.key_digest,
        fingerprints,
        events,
        counts:{ fingerprints:fingerprints.length, events:events.length },
      },
    });
    const manifest = { ...content, digest: sha256(content) };
    await writeFile(output, `${canonicalJson(manifest)}\n`, { encoding:'utf8', mode:0o600, flag:'wx' });
    return manifest;
  } finally { await sql.end(); }
}
