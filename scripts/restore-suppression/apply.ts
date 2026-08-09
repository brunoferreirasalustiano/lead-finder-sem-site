import { connect, databaseUrl } from './db.js';
import { suppressionChannel } from './scope.js';
import type { ReconciliationReport, SuppressionEntry, SuppressionManifest } from './types.js';

type Resolved = { entry: SuppressionEntry; leadId: string; already: boolean };
type PrecontactInspection = { keyMatched: boolean; fingerprints: number; events: number; alreadyApplied: number; requiringChange: number; conflicts: number };

async function resolveEntries(sql: ReturnType<typeof connect>, manifest: SuppressionManifest): Promise<{ resolved: Resolved[]; unresolved: number }> {
  const resolved: Resolved[] = []; let unresolved = 0;
  for (const entry of manifest.entries) {
    const rows = entry.leadId && entry.stableIdentity
      ? await sql<{id:string;is_blocked:boolean;do_not_contact:boolean;crm_stage:string|null;has_opt_out:boolean}[]>`SELECT l.id::text,l.is_blocked,l.do_not_contact,l.crm_stage,EXISTS(SELECT 1 FROM campaign_opt_outs o WHERE o.lead_id=l.id AND o.channel IS NOT DISTINCT FROM ${entry.channel ?? null}) has_opt_out FROM leads l WHERE l.id=${entry.leadId}::uuid AND l.osm_type=${entry.stableIdentity.osmType} AND l.osm_id=${entry.stableIdentity.osmId}`
      : entry.leadId
        ? await sql<{id:string;is_blocked:boolean;do_not_contact:boolean;crm_stage:string|null;has_opt_out:boolean}[]>`SELECT l.id::text,l.is_blocked,l.do_not_contact,l.crm_stage,EXISTS(SELECT 1 FROM campaign_opt_outs o WHERE o.lead_id=l.id AND o.channel IS NOT DISTINCT FROM ${entry.channel ?? null}) has_opt_out FROM leads l WHERE l.id=${entry.leadId}::uuid`
        : await sql<{id:string;is_blocked:boolean;do_not_contact:boolean;crm_stage:string|null;has_opt_out:boolean}[]>`SELECT l.id::text,l.is_blocked,l.do_not_contact,l.crm_stage,EXISTS(SELECT 1 FROM campaign_opt_outs o WHERE o.lead_id=l.id AND o.channel IS NOT DISTINCT FROM ${entry.channel ?? null}) has_opt_out FROM leads l WHERE l.osm_type=${entry.stableIdentity!.osmType} AND l.osm_id=${entry.stableIdentity!.osmId}`;
    if (rows.length !== 1) { unresolved++; continue; }
    const row=rows[0]!;
    const already = entry.suppressionType==='IS_BLOCKED' ? row.is_blocked : entry.suppressionType==='DO_NOT_CONTACT' ? row.do_not_contact : entry.suppressionType==='CRM_NAO_CONTATAR' ? row.crm_stage==='NAO_CONTATAR' : row.has_opt_out;
    resolved.push({ entry, leadId:row.id, already });
  }
  return { resolved, unresolved };
}

async function inspectPrecontactPermanent(sql: ReturnType<typeof connect>, manifest: SuppressionManifest): Promise<PrecontactInspection> {
  const state = manifest.precontactPermanent;
  const keyRows = await sql<{ key_digest: string }[]>`
    SELECT encode(extensions.digest(secret,'sha256'),'hex') key_digest
    FROM lead_finder_private.email_suppression_hmac_key
    WHERE singleton=true`;
  const keyMatched = keyRows.length === 1 && keyRows[0]!.key_digest === state.keyDigest;
  if (!keyMatched) return { keyMatched:false, fingerprints:state.fingerprints.length, events:state.events.length, alreadyApplied:0, requiringChange:state.fingerprints.length+state.events.length, conflicts:0 };

  const fingerprintRows = state.fingerprints.length === 0 ? [] : await sql<{ identity_fingerprint: string; suppressed: boolean }[]>`
    SELECT identity_fingerprint::text identity_fingerprint,suppressed
    FROM lead_finder_private.email_contact_identities
    WHERE identity_fingerprint::text = ANY(${state.fingerprints}::text[])`;
  const suppressed = new Set(fingerprintRows.filter((row) => row.suppressed).map((row) => row.identity_fingerprint));

  const requestedEvents = state.events.map((event) => event.eventFingerprint);
  const persistedEvents = requestedEvents.length === 0 ? [] : await sql<{ identity_fingerprint: string; reason: string; source: string; event_fingerprint: string; occurred_at: Date }[]>`
    SELECT identity_fingerprint::text identity_fingerprint,reason,source,event_fingerprint::text event_fingerprint,occurred_at
    FROM public.email_precontact_delivery_suppressions
    WHERE event_fingerprint::text = ANY(${requestedEvents}::text[])`;
  const persistedByEvent = new Map(persistedEvents.map((event) => [event.event_fingerprint,event]));
  let exactEvents = 0; let missingEvents = 0; let conflicts = 0;
  for (const event of state.events) {
    const persisted = persistedByEvent.get(event.eventFingerprint);
    if (!persisted) { missingEvents++; continue; }
    if (persisted.identity_fingerprint !== event.identityFingerprint
      || persisted.reason !== event.reasonCode
      || persisted.source !== event.operationalSource
      || persisted.occurred_at.toISOString() !== event.occurredAt) conflicts++;
    else exactEvents++;
  }
  const exactFingerprints = state.fingerprints.filter((fingerprint) => suppressed.has(fingerprint)).length;
  return {
    keyMatched:true,
    fingerprints:state.fingerprints.length,
    events:state.events.length,
    alreadyApplied:exactFingerprints+exactEvents,
    requiringChange:(state.fingerprints.length-exactFingerprints)+missingEvents,
    conflicts,
  };
}

const report = (manifest: SuppressionManifest, resolved: Resolved[], unresolved: number, precontact: PrecontactInspection): ReconciliationReport => {
  const conflicts = precontact.conflicts + (precontact.keyMatched ? 0 : 1);
  const result = unresolved===0 && conflicts===0 ? 'SAFE' : 'BLOCKED';
  const reason = !precontact.keyMatched ? 'PRECONTACT_SUPPRESSION_KEY_MISMATCH' : precontact.conflicts ? 'PRECONTACT_SUPPRESSION_CONFLICT' : unresolved ? 'UNRESOLVED_SUPPRESSION_TARGETS' : undefined;
  return {
    version:'1.0', totalEntries:manifest.entries.length, validEntries:manifest.entries.length,
    alreadyApplied:resolved.filter((item)=>item.already).length, requiringChange:resolved.filter((item)=>!item.already).length,
    unresolved, conflicts, result, ...(reason ? { reason } : {}),
    precontactPermanent:precontact,
  };
};

async function applyPrecontactPermanent(tx: Parameters<Parameters<ReturnType<typeof connect>['begin']>[0]>[0], manifest: SuppressionManifest): Promise<void> {
  const state = manifest.precontactPermanent;
  if (state.fingerprints.length) {
    await tx`
      INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint,suppressed)
      SELECT value::char(64),true
      FROM jsonb_array_elements_text(${tx.json(state.fingerprints)}::jsonb)
      ON CONFLICT (identity_fingerprint) DO UPDATE
      SET suppressed=true,updated_at=clock_timestamp()`;
  }
  if (state.events.length) {
    await tx`
      INSERT INTO public.email_precontact_delivery_suppressions(
        identity_fingerprint,reason,source,event_fingerprint,occurred_at
      )
      SELECT
        (entry->>'identityFingerprint')::char(64),
        entry->>'reasonCode',
        entry->>'operationalSource',
        (entry->>'eventFingerprint')::char(64),
        (entry->>'occurredAt')::timestamptz
      FROM jsonb_array_elements(${tx.json(state.events)}::jsonb) entry
      ON CONFLICT (event_fingerprint) DO NOTHING`;
  }
  await tx`
    UPDATE public.lead_contacts contact
    SET is_valid=false,updated_at=clock_timestamp()
    FROM lead_finder_private.email_contact_identities identity
    WHERE identity.suppressed
      AND contact.email_precontact_identity_fingerprint=identity.identity_fingerprint
      AND upper(contact.type)='EMAIL'
      AND contact.is_valid`;
}

export async function reconcile(manifest: SuppressionManifest, apply: boolean, actor: string, url=databaseUrl()): Promise<ReconciliationReport> {
  if (!/^[A-Za-z0-9._:@-]{1,100}$/u.test(actor)) throw new Error('INVALID_OPERATIONAL_ACTOR');
  const sql=connect(url);
  try {
    const initial=await resolveEntries(sql,manifest);
    const initialPrecontact=await inspectPrecontactPermanent(sql,manifest);
    const dry=report(manifest,initial.resolved,initial.unresolved,initialPrecontact);
    if (!apply || dry.result==='BLOCKED') return dry;
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('restore-suppression-reconciliation',0))`;
      await tx.unsafe('LOCK TABLE leads, campaign_opt_outs, campaign_recipients, campaign_attempts, campaign_outbox, restore_suppression_runs, public.lead_contacts, lead_finder_private.email_contact_identities, public.email_precontact_delivery_suppressions IN SHARE ROW EXCLUSIVE MODE');
      const previous=await tx<{manifest_digest:string}[]>`SELECT manifest_digest FROM restore_suppression_runs WHERE run_id=${manifest.runId}::uuid`;
      if(previous[0]&&previous[0].manifest_digest!==manifest.digest) throw new Error('MANIFEST_IDENTITY_CONFLICT');
      const connection=tx as unknown as ReturnType<typeof connect>;
      const locked=await resolveEntries(connection,manifest);
      const lockedPrecontact=await inspectPrecontactPermanent(connection,manifest);
      const lockedReport=report(manifest,locked.resolved,locked.unresolved,lockedPrecontact);
      if (lockedReport.result==='BLOCKED') throw new Error(lockedReport.reason ?? 'RESTORE_SUPPRESSION_BLOCKED');
      await applyPrecontactPermanent(tx,manifest);
      for (const item of locked.resolved) {
        const { entry,leadId }=item;
        const channel=suppressionChannel(entry);
        if (entry.suppressionType==='IS_BLOCKED') await tx`UPDATE leads SET is_blocked=true,updated_at=now() WHERE id=${leadId}::uuid AND is_blocked=false`;
        if (entry.suppressionType==='DO_NOT_CONTACT') await tx`UPDATE leads SET do_not_contact=true,updated_at=now() WHERE id=${leadId}::uuid AND do_not_contact=false`;
        if (entry.suppressionType==='CRM_NAO_CONTATAR') {
          const changed=await tx`UPDATE leads SET crm_stage='NAO_CONTATAR',crm_version=crm_version+1,crm_updated_at=now(),updated_at=now() WHERE id=${leadId}::uuid AND crm_stage IS DISTINCT FROM 'NAO_CONTATAR' RETURNING id`;
          if (changed.length) await tx`INSERT INTO crm_timeline_events(lead_id,event_type,actor,reason,new_value,metadata,created_at) VALUES(${leadId}::uuid,'RESTORE_SUPPRESSION_RECONCILED',${actor},${entry.reasonCode},${tx.json({stage:'NAO_CONTATAR'})},${tx.json({source:'RESTORE_SUPPRESSION',runId:manifest.runId})},${entry.occurredAt})`;
        }
        if (entry.suppressionType==='OPT_OUT_GLOBAL' || entry.suppressionType==='OPT_OUT_CHANNEL') await tx`INSERT INTO campaign_opt_outs(lead_id,channel,reason,source,created_at) SELECT ${leadId}::uuid,${entry.channel ?? null},${entry.reasonCode},${entry.operationalSource},${entry.occurredAt} WHERE NOT EXISTS(SELECT 1 FROM campaign_opt_outs WHERE lead_id=${leadId}::uuid AND channel IS NOT DISTINCT FROM ${entry.channel ?? null}) ON CONFLICT DO NOTHING`;
        await tx`UPDATE campaign_recipients SET state=CASE WHEN ${entry.suppressionType.startsWith('OPT_OUT')} THEN 'OPT_OUT' ELSE 'BLOQUEADO' END,version=version+1,updated_at=now() WHERE lead_id=${leadId}::uuid AND (${channel}::text IS NULL OR channel=${channel}) AND state IN ('PENDENTE','ELEGIVEL','EM_ANDAMENTO')`;
        await tx`UPDATE campaign_attempts a SET state='BLOQUEADA',version=a.version+1,updated_at=now() FROM campaign_recipients r WHERE a.recipient_id=r.id AND r.lead_id=${leadId}::uuid AND (${channel}::text IS NULL OR r.channel=${channel}) AND a.state IN ('PENDENTE','APROVADA')`;
        await tx`UPDATE campaign_outbox o SET status='BLOCKED',claim_worker_id=NULL,claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL WHERE o.status='PENDING' AND o.aggregate_type='attempt' AND o.event_type='ATTEMPT_CREATED' AND EXISTS(SELECT 1 FROM campaign_attempts a JOIN campaign_recipients r ON r.id=a.recipient_id WHERE a.id=o.aggregate_id AND r.lead_id=${leadId}::uuid AND (${channel}::text IS NULL OR r.channel=${channel}))`;
      }
      if (process.env['RESTORE_SUPPRESSION_TEST_FAIL_AFTER_MUTATION']==='true') throw new Error('INJECTED_TRANSACTION_FAILURE');
      const counts=await tx<{attempt_count:string;provider_count:string}[]>`SELECT (SELECT count(*) FROM campaign_attempts)::text attempt_count,(SELECT count(*) FROM campaign_provider_events)::text provider_count`;
      await tx`INSERT INTO restore_suppression_runs(run_id,schema_version,manifest_digest,logical_origin,cutoff_at,state,total_entries,applied_entries,unresolved_entries,conflict_entries,attempt_count,provider_event_count,actor) VALUES(${manifest.runId}::uuid,${manifest.schemaVersion},${manifest.digest},${manifest.logicalOrigin},${manifest.cutoffAt},'RESTORE_SUPPRESSION_SAFE',${manifest.entries.length},${locked.resolved.filter((x)=>!x.already).length},0,0,${counts[0]!.attempt_count}::bigint,${counts[0]!.provider_count}::bigint,${actor}) ON CONFLICT (manifest_digest) DO NOTHING`;
    });
    return dry;
  } finally { await sql.end(); }
}
