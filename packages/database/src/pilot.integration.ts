import { strict as assert } from 'node:assert';
import { and, count, eq, sql } from 'drizzle-orm';
import { createAuthorizationContext } from '@lead-finder/shared';
import {
  addPilotLead, createPilotRun, getPilotSnapshot, recordPilotManualContact, recordPilotResult,
  reviewPilotLead, updatePilotRunStatus,
} from './pilot.js';
import { createDatabase } from './index.js';
import {
  campaignOptOuts, campaigns, crmTimelineEvents, leadContacts, leads, pilotIdempotencyKeys,
  pilotManualContacts, pilotResults, pilotRuns, pilotTimelineEvents,
} from './schema.js';

const expectCode = async (operation: Promise<unknown>, code: string) => assert.rejects(operation, (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code);

export async function runPilotPersistenceIntegration(databaseUrl: string) {
  const { db, close } = createDatabase(databaseUrl);
  const auth=createAuthorizationContext({principalId:'pilot-integration',permissions:new Set(['pilot:write','pilot:review']),authenticationMethod:'integration'});
  const suffix=crypto.randomUUID();
  const createLead=async(label:string)=>{
    const lead=(await db.insert(leads).values({osmType:'node',osmId:`pilot-${label}-${suffix}`,name:`Empresa Ficticia ${label}`,category:'Categoria Ficticia',city:'Regiao Ficticia',state:'XX',score:1,status:'SEM_SITE_CADASTRADO',qualificationStatus:'SEM_SITE_CONFIRMADO'}).returning())[0]!;
    const contacts=await db.insert(leadContacts).values([
      {leadId:lead.id,type:'EMAIL',originalValue:`${label}@example.invalid`,normalizedValue:`${label}@example.invalid`,source:'SYNTHETIC',confidence:'1',verifiedAt:new Date(),isValid:true},
      {leadId:lead.id,type:'TELEFONE',originalValue:`+550000000${label.length}01`,normalizedValue:`+550000000${label.length}01`,source:'SYNTHETIC',confidence:'1',verifiedAt:new Date(),isValid:true},
    ]).returning();
    return {lead,email:contacts[0]!,phone:contacts[1]!};
  };
  try {
    const required=['pilot_runs','pilot_leads','pilot_reviews','pilot_manual_contacts','pilot_results','pilot_timeline_events','pilot_idempotency_keys'];
    for(const table of required){const rows=await db.execute(sql<{present:boolean}[]>`select to_regclass(${`public.${table}`}) is not null present`);assert.equal(rows[0]?.present,true,`missing pilot table: ${table}`);}

    const key=`pilot-integration-${suffix}`;
    const input={name:'Synthetic Pilot',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:3,idempotencyKey:key};
    const created=await createPilotRun(db,input,auth);
    assert.equal((await createPilotRun(db,input,auth)).replayed,true);
    await expectCode(createPilotRun(db,{...input,name:'Divergent Synthetic Pilot'},auth),'IDEMPOTENCY_CONFLICT');

    const funnel=await createLead('funil'); const invalid=await createLead('invalido'); const dnc=await createLead('bloqueado');
    for(const [index,item] of [funnel,invalid,dnc].entries()){
      await addPilotLead(db,created.data.id,{leadId:item.lead.id,source:'SYNTHETIC',expectedVersion:index+1,idempotencyKey:`${key}-lead-${index}`},auth);
      await reviewPilotLead(db,created.data.id,item.lead.id,{decision:'APPROVED',expectedVersion:0,idempotencyKey:`${key}-review-${index}`},auth);
    }
    await expectCode(updatePilotRunStatus(db,created.data.id,{status:'READY',expectedVersion:4,idempotencyKey:`${key}-ready-false`},auth,{shadowModeEnabled:false,realProviderConfigured:false,collectionEgressEnabled:false}),'INVALID_STATE');
    const forgedCampaign=(await db.insert(campaigns).values({name:'Campanha sintetica sem prova',idempotencyKey:`${key}-campaign`,payloadFingerprint:'f'.repeat(64)}).returning())[0]!;
    await db.update(pilotRuns).set({campaignId:forgedCampaign.id}).where(eq(pilotRuns.id,created.data.id));
    await expectCode(updatePilotRunStatus(db,created.data.id,{status:'READY',expectedVersion:4,idempotencyKey:`${key}-ready-campaign`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false}),'INVALID_STATE');
    await db.update(pilotRuns).set({campaignId:null}).where(eq(pilotRuns.id,created.data.id));
    await updatePilotRunStatus(db,created.data.id,{status:'READY',expectedVersion:4,idempotencyKey:`${key}-ready`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await updatePilotRunStatus(db,created.data.id,{status:'RUNNING',expectedVersion:5,idempotencyKey:`${key}-running`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});

    for(const result of ['CONTACTED','RESPONDED','INTERESTED','PROPOSAL_REQUESTED'] as const)
      await expectCode(recordPilotResult(db,created.data.id,funnel.lead.id,{result,expectedVersion:0,idempotencyKey:`${key}-blocked-${result}`},auth),'INVALID_STATE');
    const notContacted=await recordPilotResult(db,created.data.id,funnel.lead.id,{result:'NOT_CONTACTED',expectedVersion:0,idempotencyKey:`${key}-not-contacted`},auth);
    assert.equal(notContacted.data.result,'NOT_CONTACTED');
    await recordPilotManualContact(db,created.data.id,funnel.lead.id,{contactId:funnel.phone.id,channel:'PHONE',approvedTemplateVersionId:'synthetic-template-v1',expectedVersion:1,idempotencyKey:`${key}-manual`},auth);
    const sequence=['CONTACTED','RESPONDED','INTERESTED','MEETING_REQUESTED','PROPOSAL_REQUESTED'] as const;
    let version=1;
    const funnelResults=[];
    for(const result of sequence){funnelResults.push((await recordPilotResult(db,created.data.id,funnel.lead.id,{result,expectedVersion:version,idempotencyKey:`${key}-${result}`},auth)).data);version+=1;}
    const conversionCommand={result:'CONVERTED' as const,humanConfirmedConversion:true as const,expectedVersion:version,idempotencyKey:`${key}-converted`};
    const conversion=(await recordPilotResult(db,created.data.id,funnel.lead.id,conversionCommand,auth)).data;
    funnelResults.push(conversion);

    await expectCode(recordPilotResult(db,created.data.id,invalid.lead.id,{result:'INVALID_CONTACT',contactId:funnel.email.id,reason:'Contato sintetico de outro lead',expectedVersion:0,idempotencyKey:`${key}-cross-contact`},auth),'INELIGIBLE_LEAD');
    await expectCode(recordPilotResult(db,created.data.id,invalid.lead.id,{result:'INVALID_CONTACT',contactId:crypto.randomUUID(),reason:'Contato sintetico forjado',expectedVersion:0,idempotencyKey:`${key}-forged-contact`},auth),'INELIGIBLE_LEAD');
    const invalidCommand={result:'INVALID_CONTACT' as const,contactId:invalid.email.id,reason:'Email sintetico invalido',expectedVersion:0,idempotencyKey:`${key}-invalid-contact`};
    const invalidResult=await recordPilotResult(db,created.data.id,invalid.lead.id,invalidCommand,auth);
    assert.equal((await recordPilotResult(db,created.data.id,invalid.lead.id,invalidCommand,auth)).replayed,true);
    await expectCode(recordPilotResult(db,created.data.id,invalid.lead.id,{...invalidCommand,reason:'Payload divergente'},auth),'IDEMPOTENCY_CONFLICT');
    const preserved=await db.select().from(leadContacts).where(eq(leadContacts.leadId,invalid.lead.id));
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.isValid,false);
    assert.equal(preserved.find(contact=>contact.id===invalid.phone.id)?.isValid,true);
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.originalValue,invalid.email.originalValue);
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.normalizedValue,invalid.email.normalizedValue);
    assert.equal(preserved.find(contact=>contact.id===invalid.email.id)?.source,invalid.email.source);
    assert.equal((await db.select({value:count()}).from(pilotTimelineEvents).where(and(eq(pilotTimelineEvents.pilotRunId,created.data.id),eq(pilotTimelineEvents.leadId,invalid.lead.id),eq(pilotTimelineEvents.eventType,'PILOT_RESULT_RECORDED'))))[0]?.value,1);
    assert.ok(invalidResult.data.id);

    await recordPilotResult(db,created.data.id,dnc.lead.id,{result:'DO_NOT_CONTACT',reason:'Decisao humana sintetica',expectedVersion:0,idempotencyKey:`${key}-dnc`},auth);
    const blocked=(await db.select().from(leads).where(eq(leads.id,dnc.lead.id)).limit(1))[0]!;
    assert.deepEqual({isBlocked:blocked.isBlocked,doNotContact:blocked.doNotContact,crmStage:blocked.crmStage},{isBlocked:true,doNotContact:true,crmStage:'NAO_CONTATAR'});
    assert.equal((await db.select({value:count()}).from(campaignOptOuts).where(eq(campaignOptOuts.leadId,dnc.lead.id)))[0]?.value,1);
    assert.equal((await db.select({value:count()}).from(crmTimelineEvents).where(and(eq(crmTimelineEvents.leadId,dnc.lead.id),eq(crmTimelineEvents.eventType,'DO_NOT_CONTACT'))))[0]?.value,1);

    const response=funnelResults.find(result=>result.result==='RESPONDED')!;
    const snapshot=await getPilotSnapshot(db,created.data.id,{from:response.recordedAt,to:conversion.recordedAt});
    assert.deepEqual({responses:snapshot.counts.totalResponses,interested:snapshot.counts.totalInterested,meetings:snapshot.counts.totalMeetingRequested,proposals:snapshot.counts.totalProposalRequested,conversions:snapshot.counts.totalConversions},{responses:1,interested:1,meetings:1,proposals:1,conversions:1});
    assert.equal(Object.values(snapshot.rates).every(rate=>rate.value===null||rate.value<=1),true);
    assert.equal(snapshot.counts.totalAssociated,3,'multiple associated leads must be counted once each');
    assert.doesNotMatch(JSON.stringify(snapshot),/example\.invalid|\+5500|Empresa Ficticia/i,'snapshot must not expose PII');
    const before=await getPilotSnapshot(db,created.data.id,{from:new Date(0),to:new Date(response.recordedAt.getTime()-1)});
    assert.equal(before.counts.totalResponses,0,'events before the period must not be counted');
    const after=await getPilotSnapshot(db,created.data.id,{from:new Date(conversion.recordedAt.getTime()+1),to:new Date(conversion.recordedAt.getTime()+60_000)});
    assert.equal(after.counts.totalResponses,0,'events after the period must not be counted');
    assert.equal((await recordPilotResult(db,created.data.id,funnel.lead.id,conversionCommand,auth)).replayed,true);
    assert.deepEqual((await getPilotSnapshot(db,created.data.id,{from:response.recordedAt,to:conversion.recordedAt})).counts,snapshot.counts,'replay must not change metrics');

    const raceLead=await createLead('concorrente');
    const raceRuns=await Promise.all([0,1].map(index=>createPilotRun(db,{name:`Race ${index}`,region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:1,idempotencyKey:`${key}-race-run-${index}`},auth)));
    const race=await Promise.allSettled(raceRuns.map((run,index)=>addPilotLead(db,run.data.id,{leadId:raceLead.lead.id,source:'SYNTHETIC',expectedVersion:1,idempotencyKey:`${key}-race-lead-${index}`},auth)));
    assert.equal(race.filter(result=>result.status==='fulfilled').length,1,'one lead must belong to only one active pilot');

    const rollbackRun=await createPilotRun(db,{name:'Rollback Pilot',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:1,idempotencyKey:`${key}-rollback-run`},auth);
    const rollbackLead=await createLead('rollback');
    await addPilotLead(db,rollbackRun.data.id,{leadId:rollbackLead.lead.id,source:'SYNTHETIC',expectedVersion:1,idempotencyKey:`${key}-rollback-lead`},auth);
    await reviewPilotLead(db,rollbackRun.data.id,rollbackLead.lead.id,{decision:'APPROVED',expectedVersion:0,idempotencyKey:`${key}-rollback-review`},auth);
    await updatePilotRunStatus(db,rollbackRun.data.id,{status:'READY',expectedVersion:2,idempotencyKey:`${key}-rollback-ready`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await updatePilotRunStatus(db,rollbackRun.data.id,{status:'RUNNING',expectedVersion:3,idempotencyKey:`${key}-rollback-running`},auth,{shadowModeEnabled:true,realProviderConfigured:false,collectionEgressEnabled:false});
    await db.execute(sql`create or replace function pilot_test_fail_result() returns trigger language plpgsql as $$ begin raise exception 'synthetic rollback'; end $$`);
    await db.execute(sql`create trigger pilot_test_fail_result before insert on pilot_results for each row when (new.idempotency_key like 'rollback-failure-%') execute function pilot_test_fail_result()`);
    await assert.rejects(recordPilotResult(db,rollbackRun.data.id,rollbackLead.lead.id,{result:'DO_NOT_CONTACT',reason:'Rollback sintetico',expectedVersion:0,idempotencyKey:`rollback-failure-${suffix}`},auth));
    await db.execute(sql`drop trigger pilot_test_fail_result on pilot_results`); await db.execute(sql`drop function pilot_test_fail_result()`);
    const rolledBack=(await db.select().from(leads).where(eq(leads.id,rollbackLead.lead.id)).limit(1))[0]!;
    assert.deepEqual({isBlocked:rolledBack.isBlocked,doNotContact:rolledBack.doNotContact,crmStage:rolledBack.crmStage},{isBlocked:false,doNotContact:false,crmStage:null});
    assert.equal((await db.select({value:count()}).from(campaignOptOuts).where(eq(campaignOptOuts.leadId,rollbackLead.lead.id)))[0]?.value,0);
    assert.equal((await db.select({value:count()}).from(pilotResults).where(eq(pilotResults.leadId,rollbackLead.lead.id)))[0]?.value,0);

    const event=(await db.select().from(pilotTimelineEvents).where(eq(pilotTimelineEvents.pilotRunId,created.data.id)).limit(1))[0]!;
    await assert.rejects(db.update(pilotTimelineEvents).set({eventType:'FORGED'}).where(eq(pilotTimelineEvents.id,event.id)));
    await assert.rejects(db.delete(pilotTimelineEvents).where(eq(pilotTimelineEvents.id,event.id)));
    assert.ok((await db.select({value:count()}).from(pilotManualContacts).where(eq(pilotManualContacts.pilotRunId,created.data.id)))[0]!.value>0);
    assert.ok((await db.select({value:count()}).from(pilotIdempotencyKeys).where(eq(pilotIdempotencyKeys.scope,`result:${created.data.id}`)))[0]!.value>0);
  } finally { await close(); }
}
