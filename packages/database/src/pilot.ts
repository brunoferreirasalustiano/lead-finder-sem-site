import { createHash } from 'node:crypto';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  assertPilotResultTransition, assertPilotRunTransition, createPilotMetricSnapshot, evaluatePilotReadiness,
  isTrustedAuthorizationContext, type AuthorizationContext, type PilotCommercialResult, type PilotLeadAddInput,
  type PilotManualContactInput, type PilotResultInput, type PilotReviewInput, type PilotRunCreateInput,
  type PilotRunStatus, type PilotRunStatusChangeInput,
} from '@lead-finder/shared';
import type { Database } from './index.js';
import {
  campaignOptOuts, crmTimelineEvents, leadContacts, leads, pilotIdempotencyKeys, pilotLeads, pilotManualContacts,
  pilotResults, pilotReviews, pilotRuns, pilotTimelineEvents,
} from './schema.js';

export const pilotPersistenceErrorCodes = ['NOT_FOUND','INVALID_INPUT','INELIGIBLE_LEAD','INVALID_STATE','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','LOGICAL_CONFLICT'] as const;
export type PilotPersistenceErrorCode = (typeof pilotPersistenceErrorCodes)[number];
export class PilotPersistenceError extends Error {
  readonly name = 'PilotPersistenceError';
  constructor(message: string, readonly code: PilotPersistenceErrorCode) { super(message); Object.setPrototypeOf(this, new.target.prototype); }
}
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type MutationResult<T> = { data: T; replayed: boolean };
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,n]) => [k,canonical(n)])) : v;
export const pilotFingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const trusted = (auth: AuthorizationContext) => {
  if (!isTrustedAuthorizationContext(auth)) throw new PilotPersistenceError('Trusted authorization context is required', 'INVALID_INPUT');
  return auth;
};
const lock = (tx: Tx, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
async function replay<T>(tx: Tx, scope: string, key: string, payload: unknown): Promise<MutationResult<T>|null> {
  await lock(tx, `pilot:${scope}:${key}`);
  const row = (await tx.select().from(pilotIdempotencyKeys).where(and(eq(pilotIdempotencyKeys.scope,scope),eq(pilotIdempotencyKeys.idempotencyKey,key))).limit(1))[0];
  if (!row) return null;
  if (row.payloadFingerprint !== pilotFingerprint(payload)) throw new PilotPersistenceError('Idempotency key reused with divergent payload','IDEMPOTENCY_CONFLICT');
  return { data: row.result as T, replayed: true };
}
const remember = (tx: Tx, scope: string, key: string, payload: unknown, type: string, id: string, result: unknown) => tx.insert(pilotIdempotencyKeys).values({ scope,idempotencyKey:key,payloadFingerprint:pilotFingerprint(payload),resourceType:type,resourceId:id,result });
const timeline = (tx: Tx, value: typeof pilotTimelineEvents.$inferInsert) => tx.insert(pilotTimelineEvents).values(value);
const sanitize = (value?: string, max=500) => value?.replace(/\p{Cc}/gu,' ').trim().slice(0,max) || undefined;
const hasPostgresCode = (error: unknown, expectedCode: string): boolean => {
  let current = error;
  while (current && typeof current === 'object') {
    if ('code' in current && (current as {code?:unknown}).code === expectedCode) return true;
    current = 'cause' in current ? (current as {cause?:unknown}).cause : undefined;
  }
  return false;
};

async function eligibility(tx: Tx, leadId: string, contactId?: string, expected?: {region:string;category:string}) {
  await lock(tx, `pilot:lead:${leadId}`);
  const rows = await tx.execute(sql<{id:string; qualification_status:string; website_status:string; is_blocked:boolean; do_not_contact:boolean; crm_stage:string|null; city:string|null;category:string;has_contact:boolean; has_opt_out:boolean; has_required_evidence:boolean}[]>`
    select l.id,l.qualification_status,l.website_status,l.is_blocked,l.do_not_contact,l.crm_stage,l.city,l.category,
      exists(select 1 from lead_contacts c where c.lead_id=l.id and c.is_valid=true and c.verified_at is not null and btrim(c.source)<>'empty' ${contactId ? sql`and c.id=${contactId}::uuid` : sql``}) has_contact,
      exists(select 1 from campaign_opt_outs o where o.lead_id=l.id) has_opt_out,
      exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='BUSINESS_IDENTITY' and e.verification_status='VERIFIED' and e.result='BUSINESS_IDENTITY_CONFIRMED')
        and exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='BUSINESS_ACTIVITY' and e.verification_status='VERIFIED' and e.result='ACTIVE')
        and exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='WEBSITE' and e.verification_status='VERIFIED' and e.result='NO_OFFICIAL_SITE_CONFIRMED')
        and exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='BUSINESS_EMAIL' and e.verification_status='VERIFIED' and e.result='EMAIL_BUSINESS_ASSOCIATION_PASS') has_required_evidence
      from leads l where l.id=${leadId}::uuid for update`);
  const l = rows[0] as {id:string; qualification_status:string; website_status:string; is_blocked:boolean; do_not_contact:boolean; crm_stage:string|null;city:string|null;category:string;has_contact:boolean;has_opt_out:boolean;has_required_evidence:boolean}|undefined;
  if (!l) throw new PilotPersistenceError('Lead not found','NOT_FOUND');
  if (l.qualification_status!=='SEM_SITE_CONFIRMADO'||l.website_status!=='NO_OFFICIAL_SITE_CONFIRMED'||!l.has_required_evidence||l.is_blocked||l.do_not_contact||l.crm_stage==='NAO_CONTATAR'||l.has_opt_out||!l.has_contact)
    throw new PilotPersistenceError('Lead is not eligible for pilot operations','INELIGIBLE_LEAD');
  if(expected && ((l.city && l.city.localeCompare(expected.region,undefined,{sensitivity:'accent'})!==0)||l.category.localeCompare(expected.category,undefined,{sensitivity:'accent'})!==0))
    throw new PilotPersistenceError('Lead is outside pilot region or category','INELIGIBLE_LEAD');
  return l;
}
async function currentReview(tx: Tx,pilotRunId:string,leadId:string) { return (await tx.select().from(pilotReviews).where(and(eq(pilotReviews.pilotRunId,pilotRunId),eq(pilotReviews.leadId,leadId))).orderBy(desc(pilotReviews.version)).limit(1))[0]??null; }
async function currentResult(tx: Tx,pilotRunId:string,leadId:string) { return (await tx.select().from(pilotResults).where(and(eq(pilotResults.pilotRunId,pilotRunId),eq(pilotResults.leadId,leadId))).orderBy(desc(pilotResults.version)).limit(1))[0]??null; }
async function hasManualContact(tx: Tx,pilotRunId:string,leadId:string) { return !!(await tx.select({id:pilotManualContacts.id}).from(pilotManualContacts).where(and(eq(pilotManualContacts.pilotRunId,pilotRunId),eq(pilotManualContacts.leadId,leadId))).limit(1))[0]; }

export async function createPilotRun(db: Database,input: PilotRunCreateInput,authorization: AuthorizationContext) {
  const auth=trusted(authorization); const payload={name:input.name,region:input.region,category:input.category,targetLeadCount:input.targetLeadCount};
  return db.transaction(async tx=>{ const prior=await replay<typeof pilotRuns.$inferSelect>(tx,'create',input.idempotencyKey,payload); if(prior)return prior;
    const row=(await tx.insert(pilotRuns).values({...payload,createdBy:auth.principalId}).returning())[0]!;
    await timeline(tx,{pilotRunId:row.id,eventType:'PILOT_CREATED',principalId:auth.principalId,newValue:row,metadata:{requestId:sanitize(auth.requestId,100)}});
    await remember(tx,'create',input.idempotencyKey,payload,'pilot-run',row.id,row); return {data:row,replayed:false}; });
}
export async function listPilotRuns(db: Database,{page=1,pageSize=20,status}:{page?:number;pageSize?:number;status?:PilotRunStatus}={}) {
  const limit=Math.min(100,Math.max(1,pageSize)),offset=(Math.max(1,page)-1)*limit,where=status?eq(pilotRuns.status,status):undefined;
  const [items,total]=await Promise.all([db.select().from(pilotRuns).where(where).orderBy(desc(pilotRuns.updatedAt),desc(pilotRuns.id)).limit(limit).offset(offset),db.select({value:count()}).from(pilotRuns).where(where)]);
  return {items,pagination:{page:Math.max(1,page),pageSize:limit,total:total[0]?.value??0}};
}
export async function getPilotRun(db: Database,id:string) {
  const run=(await db.select().from(pilotRuns).where(eq(pilotRuns.id,id)).limit(1))[0]; if(!run) throw new PilotPersistenceError('Pilot run not found','NOT_FOUND');
  const associated=await db.select().from(pilotLeads).where(eq(pilotLeads.pilotRunId,id)); return {...run,leads:associated};
}
export interface PilotRuntimeSafety { shadowModeEnabled:boolean; realProviderConfigured:boolean; collectionEgressEnabled:boolean }
const safeRuntime: PilotRuntimeSafety={shadowModeEnabled:false,realProviderConfigured:false,collectionEgressEnabled:false};
async function assertReady(tx:Tx,run:typeof pilotRuns.$inferSelect,safety:PilotRuntimeSafety) {
  const associated=await tx.execute(sql<{qualification_status:string;website_status:string;is_blocked:boolean;do_not_contact:boolean;crm_stage:string|null;has_contact:boolean;has_opt_out:boolean;has_required_evidence:boolean;decision:string|null}[]>`
   select l.qualification_status,l.website_status,l.is_blocked,l.do_not_contact,l.crm_stage,
   exists(select 1 from lead_contacts c where c.lead_id=l.id and c.is_valid and c.verified_at is not null and btrim(c.source)<>'') has_contact,
   exists(select 1 from campaign_opt_outs o where o.lead_id=l.id) has_opt_out,
   exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='BUSINESS_IDENTITY' and e.verification_status='VERIFIED' and e.result='BUSINESS_IDENTITY_CONFIRMED')
     and exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='BUSINESS_ACTIVITY' and e.verification_status='VERIFIED' and e.result='ACTIVE')
     and exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='WEBSITE' and e.verification_status='VERIFIED' and e.result='NO_OFFICIAL_SITE_CONFIRMED')
     and exists(select 1 from lead_evidence e where e.lead_id=l.id and e.evidence_type='BUSINESS_EMAIL' and e.verification_status='VERIFIED' and e.result='EMAIL_BUSINESS_ASSOCIATION_PASS') has_required_evidence,
   (select r.decision from pilot_reviews r where r.pilot_run_id=pl.pilot_run_id and r.lead_id=pl.lead_id order by r.version desc limit 1) decision
   from pilot_leads pl join leads l on l.id=pl.lead_id where pl.pilot_run_id=${run.id}::uuid for update of l`);
  // Pilot runs currently have no command that can attach a campaign. A non-null legacy/forged
  // association is therefore not proof of simulation and must fail closed.
  const campaignSimulated=run.campaignId===null;
  const readinessRows=associated as unknown as Array<{qualification_status:string;website_status:string;is_blocked:boolean;do_not_contact:boolean;crm_stage:string|null;has_contact:boolean;has_opt_out:boolean;has_required_evidence:boolean;decision:string|null}>;
  const check=evaluatePilotReadiness({name:run.name,region:run.region,category:run.category,targetLeadCount:run.targetLeadCount,
    leads:readinessRows.map(l=>({reviewDecision:l.decision as 'APPROVED'|'REJECTED'|'NEEDS_REVIEW'|null,qualificationStatus:l.qualification_status,websiteStatus:l.website_status as 'UNKNOWN'|'OFFICIAL_SITE_FOUND'|'NO_OFFICIAL_SITE_CONFIRMED',hasRequiredEvidence:l.has_required_evidence,hasValidVerifiedContact:l.has_contact,isBlocked:l.is_blocked,doNotContact:l.do_not_contact,hasActiveOptOut:l.has_opt_out,crmStage:l.crm_stage??'NOVO',versionConsistent:true})),
    shadowModeEnabled:safety.shadowModeEnabled,campaignSimulated,realProviderConfigured:safety.realProviderConfigured,collectionEgressEnabled:safety.collectionEgressEnabled,versionConsistent:true});
  if(!check.ready) throw new PilotPersistenceError(`Pilot readiness failed: ${check.reasons.join(',')}`,'INVALID_STATE');
}
export async function updatePilotRunStatus(db:Database,id:string,input:PilotRunStatusChangeInput,authorization:AuthorizationContext,safety: PilotRuntimeSafety=safeRuntime) {
 const auth=trusted(authorization),payload={id,...input}; return db.transaction(async tx=>{const prior=await replay<typeof pilotRuns.$inferSelect>(tx,`status:${id}`,input.idempotencyKey,payload);if(prior)return prior;
  const current=(await tx.select().from(pilotRuns).where(eq(pilotRuns.id,id)).for('update').limit(1))[0];if(!current)throw new PilotPersistenceError('Pilot run not found','NOT_FOUND');
  if(current.version!==input.expectedVersion)throw new PilotPersistenceError('Pilot version conflict','VERSION_CONFLICT');
  try{assertPilotRunTransition(current.status as PilotRunStatus,input.status);}catch{throw new PilotPersistenceError('Invalid pilot state transition','INVALID_STATE');}
  if(input.status==='READY'||input.status==='RUNNING')await assertReady(tx,current,safety);
  const now=new Date(),row=(await tx.update(pilotRuns).set({status:input.status,version:sql`${pilotRuns.version}+1`,updatedAt:now,...(input.status==='RUNNING'&&!current.startedAt?{startedAt:now}:{}),...(['COMPLETED','CANCELLED'].includes(input.status)?{completedAt:now}:{})}).where(and(eq(pilotRuns.id,id),eq(pilotRuns.version,input.expectedVersion))).returning())[0];
  if(!row)throw new PilotPersistenceError('Pilot version conflict','VERSION_CONFLICT');await timeline(tx,{pilotRunId:id,eventType:'PILOT_STATUS_CHANGED',principalId:auth.principalId,previousValue:current,newValue:row});await remember(tx,`status:${id}`,input.idempotencyKey,payload,'pilot-run',id,row);return{data:row,replayed:false};});
}
export async function addPilotLead(db:Database,pilotRunId:string,input:PilotLeadAddInput,authorization:AuthorizationContext) {
 const auth=trusted(authorization),payload={pilotRunId,...input};return db.transaction(async tx=>{const prior=await replay<typeof pilotLeads.$inferSelect>(tx,`lead:${pilotRunId}`,input.idempotencyKey,payload);if(prior)return prior;
  if(input.source==='COLLECTION')throw new PilotPersistenceError('Collection egress cannot be initiated by pilot','INVALID_INPUT');
  const run=(await tx.select().from(pilotRuns).where(eq(pilotRuns.id,pilotRunId)).for('update').limit(1))[0];if(!run)throw new PilotPersistenceError('Pilot run not found','NOT_FOUND');if(run.status!=='DRAFT'||run.version!==input.expectedVersion)throw new PilotPersistenceError('Pilot state or version conflict','VERSION_CONFLICT');
  await lock(tx,`pilot:lead:${input.leadId}`);
  await eligibility(tx,input.leadId,undefined,{region:run.region,category:run.category});
  const total=(await tx.select({value:count()}).from(pilotLeads).where(eq(pilotLeads.pilotRunId,pilotRunId)))[0]?.value??0;if(total>=run.targetLeadCount)throw new PilotPersistenceError('Pilot target lead count exceeded','LOGICAL_CONFLICT');
  try{const row=(await tx.insert(pilotLeads).values({pilotRunId,leadId:input.leadId,source:input.source,addedBy:auth.principalId}).returning())[0]!;await tx.update(pilotRuns).set({version:sql`${pilotRuns.version}+1`,updatedAt:new Date()}).where(and(eq(pilotRuns.id,pilotRunId),eq(pilotRuns.version,input.expectedVersion)));await timeline(tx,{pilotRunId,leadId:input.leadId,eventType:'PILOT_LEAD_ADDED',principalId:auth.principalId,newValue:row});await remember(tx,`lead:${pilotRunId}`,input.idempotencyKey,payload,'pilot-lead',input.leadId,row);return{data:row,replayed:false};}catch(e){if(hasPostgresCode(e,'23505'))throw new PilotPersistenceError('Lead already belongs to this or another active pilot','LOGICAL_CONFLICT');throw e;}});
}
export async function reviewPilotLead(db:Database,pilotRunId:string,leadId:string,input:PilotReviewInput,authorization:AuthorizationContext) {
 const auth=trusted(authorization),payload={pilotRunId,leadId,...input};return db.transaction(async tx=>{const prior=await replay<typeof pilotReviews.$inferSelect>(tx,`review:${pilotRunId}:${leadId}`,input.idempotencyKey,payload);if(prior)return prior;await lock(tx,`pilot:review:${pilotRunId}:${leadId}`);
  const run=(await tx.select().from(pilotRuns).where(eq(pilotRuns.id,pilotRunId)).for('update').limit(1))[0];if(!run)throw new PilotPersistenceError('Pilot run not found','NOT_FOUND');if(run.status!=='DRAFT')throw new PilotPersistenceError('Pilot is not in draft','INVALID_STATE');
  const association=(await tx.select().from(pilotLeads).where(and(eq(pilotLeads.pilotRunId,pilotRunId),eq(pilotLeads.leadId,leadId))).limit(1))[0];if(!association)throw new PilotPersistenceError('Pilot lead not found','NOT_FOUND');const previous=await currentReview(tx,pilotRunId,leadId);if((previous?.version??0)!==input.expectedVersion)throw new PilotPersistenceError('Review version conflict','VERSION_CONFLICT');
  const row=(await tx.insert(pilotReviews).values({pilotRunId,leadId,decision:input.decision,reason:sanitize(input.reason,1000),reviewerPrincipalId:auth.principalId,version:input.expectedVersion+1}).returning())[0]!;await timeline(tx,{pilotRunId,leadId,eventType:'PILOT_REVIEW_RECORDED',principalId:auth.principalId,previousValue:previous,newValue:row});await remember(tx,`review:${pilotRunId}:${leadId}`,input.idempotencyKey,payload,'pilot-review',row.id,row);return{data:row,replayed:false};});
}
export async function recordPilotManualContact(db:Database,pilotRunId:string,leadId:string,input:PilotManualContactInput,authorization:AuthorizationContext) {
 const auth=trusted(authorization),payload={pilotRunId,leadId,...input};return db.transaction(async tx=>{const prior=await replay<typeof pilotManualContacts.$inferSelect>(tx,`contact:${pilotRunId}`,input.idempotencyKey,payload);if(prior)return prior;const run=(await tx.select().from(pilotRuns).where(eq(pilotRuns.id,pilotRunId)).for('update').limit(1))[0];if(!run)throw new PilotPersistenceError('Pilot run not found','NOT_FOUND');if(run.status!=='RUNNING')throw new PilotPersistenceError('Pilot is not running','INVALID_STATE');const review=await currentReview(tx,pilotRunId,leadId);if(review?.decision!=='APPROVED')throw new PilotPersistenceError('Lead review is not approved','INELIGIBLE_LEAD');
  await eligibility(tx,leadId,input.contactId,{region:run.region,category:run.category});
  const association=(await tx.select().from(pilotLeads).where(and(eq(pilotLeads.pilotRunId,pilotRunId),eq(pilotLeads.leadId,leadId))).for('update').limit(1))[0];
  if(!association)throw new PilotPersistenceError('Pilot lead not found','NOT_FOUND');
  if(association.version!==input.expectedVersion)throw new PilotPersistenceError('Pilot lead version conflict','VERSION_CONFLICT');
  const row=(await tx.insert(pilotManualContacts).values({pilotRunId,leadId,contactId:input.contactId,channel:input.channel,approvedTemplateVersionId:input.approvedTemplateVersionId,operatorPrincipalId:auth.principalId,requestId:sanitize(auth.requestId,100),observation:sanitize(input.observation,500),idempotencyKey:input.idempotencyKey,payloadFingerprint:pilotFingerprint(payload)}).returning())[0]!;
  const versioned=(await tx.update(pilotLeads).set({version:sql`${pilotLeads.version}+1`}).where(and(eq(pilotLeads.pilotRunId,pilotRunId),eq(pilotLeads.leadId,leadId),eq(pilotLeads.version,input.expectedVersion))).returning())[0];
  if(!versioned)throw new PilotPersistenceError('Pilot lead version conflict','VERSION_CONFLICT');
  await timeline(tx,{pilotRunId,leadId,eventType:'MANUAL_CONTACT_RECORDED',principalId:auth.principalId,newValue:{id:row.id,channel:row.channel,contactId:row.contactId,recordedAt:row.recordedAt,associationVersion:versioned.version},metadata:{requestId:row.requestId}});await remember(tx,`contact:${pilotRunId}`,input.idempotencyKey,payload,'manual-contact',row.id,row);return{data:row,replayed:false};});
}
export async function recordPilotResult(db:Database,pilotRunId:string,leadId:string,input:PilotResultInput,authorization:AuthorizationContext) {
 const auth=trusted(authorization),payload={pilotRunId,leadId,...input};return db.transaction(async tx=>{const prior=await replay<typeof pilotResults.$inferSelect>(tx,`result:${pilotRunId}`,input.idempotencyKey,payload);if(prior)return prior;const run=(await tx.select().from(pilotRuns).where(eq(pilotRuns.id,pilotRunId)).for('update').limit(1))[0];if(!run)throw new PilotPersistenceError('Pilot run not found','NOT_FOUND');if(run.status!=='RUNNING')throw new PilotPersistenceError('Pilot is not running','INVALID_STATE');await eligibility(tx,leadId,undefined,{region:run.region,category:run.category});const review=await currentReview(tx,pilotRunId,leadId);if(review?.decision!=='APPROVED')throw new PilotPersistenceError('Lead review is not approved','INELIGIBLE_LEAD');const previous=await currentResult(tx,pilotRunId,leadId);const expected=previous?.version??0;if(expected!==input.expectedVersion)throw new PilotPersistenceError('Result version conflict','VERSION_CONFLICT');
  const manualContact=await hasManualContact(tx,pilotRunId,leadId);
  if(previous)try{assertPilotResultTransition(previous.result as PilotCommercialResult,input.result,input.humanConfirmedConversion===true);}catch{throw new PilotPersistenceError('Invalid commercial result transition','INVALID_STATE');}
  else if(!['NOT_CONTACTED','INVALID_CONTACT','DO_NOT_CONTACT'].includes(input.result)&&!(input.result==='CONTACTED'&&manualContact))throw new PilotPersistenceError('A persisted manual contact and CONTACTED result are required before later results','INVALID_STATE');
  if(['CONTACTED','NO_RESPONSE','RESPONDED','INTERESTED','MEETING_REQUESTED','PROPOSAL_REQUESTED','NOT_INTERESTED','CONVERTED'].includes(input.result)&&!manualContact)throw new PilotPersistenceError('A persisted manual contact is required for this result','INVALID_STATE');
  if(input.result==='DO_NOT_CONTACT'){const before=(await tx.select().from(leads).where(eq(leads.id,leadId)).limit(1))[0]!;const blocked=(await tx.update(leads).set({isBlocked:true,doNotContact:true,crmStage:'NAO_CONTATAR',crmVersion:sql`${leads.crmVersion}+1`,crmUpdatedAt:new Date(),updatedAt:new Date()}).where(eq(leads.id,leadId)).returning())[0]!;await tx.insert(campaignOptOuts).values({leadId,channel:null,reason:sanitize(input.reason,1000)!,source:'PILOT_MANUAL_RESULT'}).onConflictDoNothing();await tx.insert(crmTimelineEvents).values({leadId,eventType:'DO_NOT_CONTACT',actor:auth.principalId,reason:sanitize(input.reason,1000),previousValue:before,newValue:blocked,metadata:{source:'PILOT_MANUAL_RESULT',pilotRunId}});}
  if(input.result==='INVALID_CONTACT'){
    const contact=(await tx.select().from(leadContacts).where(and(eq(leadContacts.id,input.contactId!),eq(leadContacts.leadId,leadId))).for('update').limit(1))[0];
    if(!contact||!contact.isValid||!contact.verifiedAt||!contact.source.trim())throw new PilotPersistenceError('Contact is not eligible for invalidation','INELIGIBLE_LEAD');
    const updated=(await tx.update(leadContacts).set({isValid:false,updatedAt:new Date()}).where(and(eq(leadContacts.id,input.contactId!),eq(leadContacts.leadId,leadId))).returning({id:leadContacts.id}))[0];
    if(!updated)throw new PilotPersistenceError('Contact not found','NOT_FOUND');
  }
  const row=(await tx.insert(pilotResults).values({pilotRunId,leadId,result:input.result,channel:input.channel,principalId:auth.principalId,reason:sanitize(input.reason??input.observation,1000),nextAction:sanitize(input.nextAction,500),humanConfirmed:input.humanConfirmedConversion===true,version:expected+1,idempotencyKey:input.idempotencyKey,payloadFingerprint:pilotFingerprint(payload)}).returning())[0]!;await timeline(tx,{pilotRunId,leadId,eventType:'PILOT_RESULT_RECORDED',principalId:auth.principalId,previousValue:previous,newValue:{id:row.id,result:row.result,channel:row.channel,recordedAt:row.recordedAt,version:row.version}});await remember(tx,`result:${pilotRunId}`,input.idempotencyKey,payload,'pilot-result',row.id,row);return{data:row,replayed:false};});
}
export async function getPilotSnapshot(db:Database,pilotRunId:string,period:{from:Date;to:Date}={from:new Date(0),to:new Date()}) {
 // Funnel metrics use milestone-achieved semantics within the requested period. Every metric counts
 // distinct leads, never event rows; no state outside the period is inferred.
 const periodFrom=period.from.toISOString(),periodTo=period.to.toISOString();
 const withinPeriod=(recordedAt:SQL)=>sql`${recordedAt} >= ${periodFrom}::timestamptz and ${recordedAt} < (${periodTo}::timestamptz + interval '1 millisecond')`;
 const run=(await db.select().from(pilotRuns).where(eq(pilotRuns.id,pilotRunId)).limit(1))[0];if(!run)throw new PilotPersistenceError('Pilot run not found','NOT_FOUND');
 const rows=await db.execute(sql<{total_associated:number;total_approved:number;total_rejected:number;total_needs_review:number;total_without_site:number;total_valid_contacts:number;total_manual_contacts:number;total_responses:number;total_interested:number;total_meetings:number;total_proposals:number;total_conversions:number;total_opt_outs:number;total_invalid:number;total_blocked:number}[]>`
 select count(distinct pl.lead_id)::int total_associated,
 count(distinct pl.lead_id) filter(where rv.decision='APPROVED')::int total_approved,count(distinct pl.lead_id) filter(where rv.decision='REJECTED')::int total_rejected,count(distinct pl.lead_id) filter(where rv.decision='NEEDS_REVIEW' or rv.decision is null)::int total_needs_review,
 count(distinct pl.lead_id) filter(where l.qualification_status='SEM_SITE_CONFIRMADO')::int total_without_site,count(distinct pl.lead_id) filter(where exists(select 1 from lead_contacts c where c.lead_id=l.id and c.is_valid and c.verified_at is not null))::int total_valid_contacts,
 (select count(distinct c.lead_id)::int from pilot_manual_contacts c where c.pilot_run_id=${pilotRunId}::uuid and ${withinPeriod(sql`c.recorded_at`)}) total_manual_contacts,
 (select count(distinct r.lead_id)::int from pilot_results r where r.pilot_run_id=${pilotRunId}::uuid and ${withinPeriod(sql`r.recorded_at`)} and r.result in ('RESPONDED','INTERESTED','MEETING_REQUESTED','PROPOSAL_REQUESTED','CONVERTED')) total_responses,
 (select count(distinct r.lead_id)::int from pilot_results r where r.pilot_run_id=${pilotRunId}::uuid and ${withinPeriod(sql`r.recorded_at`)} and r.result in ('INTERESTED','MEETING_REQUESTED','PROPOSAL_REQUESTED','CONVERTED')) total_interested,
 (select count(distinct r.lead_id)::int from pilot_results r where r.pilot_run_id=${pilotRunId}::uuid and ${withinPeriod(sql`r.recorded_at`)} and r.result='MEETING_REQUESTED') total_meetings,
 (select count(distinct r.lead_id)::int from pilot_results r where r.pilot_run_id=${pilotRunId}::uuid and ${withinPeriod(sql`r.recorded_at`)} and r.result in ('PROPOSAL_REQUESTED','CONVERTED')) total_proposals,
 (select count(distinct r.lead_id)::int from pilot_results r where r.pilot_run_id=${pilotRunId}::uuid and ${withinPeriod(sql`r.recorded_at`)} and r.result='CONVERTED' and r.human_confirmed) total_conversions,
 count(distinct pl.lead_id) filter(where exists(select 1 from campaign_opt_outs o where o.lead_id=pl.lead_id))::int total_opt_outs,
 (select count(distinct r.lead_id)::int from pilot_results r where r.pilot_run_id=${pilotRunId}::uuid and ${withinPeriod(sql`r.recorded_at`)} and r.result='INVALID_CONTACT') total_invalid,
 count(distinct pl.lead_id) filter(where l.is_blocked)::int total_blocked from pilot_leads pl join leads l on l.id=pl.lead_id
 left join lateral(select decision from pilot_reviews r where r.pilot_run_id=pl.pilot_run_id and r.lead_id=pl.lead_id order by version desc limit 1) rv on true where pl.pilot_run_id=${pilotRunId}::uuid`);
 const r=rows[0]!,counts={totalAssociated:r.total_associated,totalApproved:r.total_approved,totalRejected:r.total_rejected,totalNeedsReview:r.total_needs_review,totalWithoutSiteConfirmed:r.total_without_site,totalValidContacts:r.total_valid_contacts,totalManualContacts:r.total_manual_contacts,totalResponses:r.total_responses,totalInterested:r.total_interested,totalMeetingRequested:r.total_meetings,totalProposalRequested:r.total_proposals,totalConversions:r.total_conversions,totalOptOuts:r.total_opt_outs,totalInvalidContacts:r.total_invalid,totalBlocked:r.total_blocked,totalIncidents:0};
 return createPilotMetricSnapshot({period:{from:periodFrom,to:periodTo},counts});
}
