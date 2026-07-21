import { connect, databaseUrl } from './db.js';
import type { SuppressionManifest } from './types.js';

export async function verifyReconciliation(manifest: SuppressionManifest,url=databaseUrl()): Promise<'RESTORE_SUPPRESSION_SAFE'> {
  const sql=connect(url);
  try {
    const evidence=await sql<{attempt_count:string;provider_event_count:string;verified_at:Date|null}[]>`SELECT attempt_count::text,provider_event_count::text,verified_at FROM restore_suppression_runs WHERE run_id=${manifest.runId}::uuid AND manifest_digest=${manifest.digest} AND state='RESTORE_SUPPRESSION_SAFE'`;
    if(evidence.length!==1) throw new Error('RECONCILIATION_EVIDENCE_MISSING');
    for(const entry of manifest.entries){
      const rows=await sql<{id:string;is_blocked:boolean;do_not_contact:boolean;crm_stage:string|null;has_opt_out:boolean;eligible:boolean;claimable:boolean}[]>`SELECT l.id::text,l.is_blocked,l.do_not_contact,l.crm_stage,EXISTS(SELECT 1 FROM campaign_opt_outs o WHERE o.lead_id=l.id AND o.channel IS NOT DISTINCT FROM ${entry.channel ?? null}) has_opt_out,(l.qualification_status='SEM_SITE_CONFIRMADO' AND NOT l.is_blocked AND NOT l.do_not_contact AND l.crm_stage IS DISTINCT FROM 'NAO_CONTATAR' AND NOT EXISTS(SELECT 1 FROM campaign_opt_outs o WHERE o.lead_id=l.id AND (o.channel IS NULL OR o.channel=${entry.channel ?? 'EMAIL'}))) eligible,EXISTS(SELECT 1 FROM campaign_recipients r JOIN campaign_outbox o ON o.aggregate_id=r.id WHERE r.lead_id=l.id AND o.status='PENDING' AND o.available_at<=now()) claimable FROM leads l WHERE l.id=${entry.leadId ?? '00000000-0000-0000-0000-000000000000'}::uuid OR (l.osm_type=${entry.stableIdentity?.osmType ?? ''} AND l.osm_id=${entry.stableIdentity?.osmId ?? ''})`;
      if(rows.length!==1) throw new Error('UNRESOLVED_SUPPRESSION_TARGETS'); const row=rows[0]!;
      const applied=entry.suppressionType==='IS_BLOCKED'?row.is_blocked:entry.suppressionType==='DO_NOT_CONTACT'?row.do_not_contact:entry.suppressionType==='CRM_NAO_CONTATAR'?row.crm_stage==='NAO_CONTATAR':row.has_opt_out;
      if(!applied||row.eligible||row.claimable) throw new Error('POST_APPLY_SUPPRESSION_REGRESSION');
    }
    const counts=await sql<{attempt_count:string;provider_count:string;duplicates:string}[]>`SELECT (SELECT count(*) FROM campaign_attempts)::text attempt_count,(SELECT count(*) FROM campaign_provider_events)::text provider_count,(SELECT count(*) FROM (SELECT lead_id,channel,count(*) FROM campaign_opt_outs GROUP BY 1,2 HAVING count(*)>1) d)::text duplicates`;
    if(counts[0]!.attempt_count!==evidence[0]!.attempt_count||counts[0]!.provider_count!==evidence[0]!.provider_event_count||counts[0]!.duplicates!=='0') throw new Error('POST_APPLY_SIDE_EFFECT_DETECTED');
    if(!evidence[0]!.verified_at) await sql`UPDATE restore_suppression_runs SET verified_at=now() WHERE run_id=${manifest.runId}::uuid AND verified_at IS NULL`;
    return 'RESTORE_SUPPRESSION_SAFE';
  } finally { await sql.end(); }
}
