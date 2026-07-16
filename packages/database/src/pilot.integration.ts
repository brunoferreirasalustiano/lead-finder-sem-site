import { sql } from 'drizzle-orm';
import { createAuthorizationContext } from '@lead-finder/shared';
import { addPilotLead, createPilotRun, createDatabase, reviewPilotLead } from './index.js';

export async function runPilotPersistenceIntegration(databaseUrl: string) {
  const { db, close } = createDatabase(databaseUrl);
  try {
    const required = ['pilot_runs','pilot_leads','pilot_reviews','pilot_manual_contacts','pilot_results','pilot_timeline_events','pilot_idempotency_keys'];
    for (const table of required) {
      const rows = await db.execute(sql<{ present: boolean }[]>`select to_regclass(${`public.${table}`}) is not null present`);
      if (!rows[0]?.present) throw new Error(`missing pilot table: ${table}`);
    }
    const auth=createAuthorizationContext({principalId:'pilot-integration',permissions:new Set(['pilot:write','pilot:review']),authenticationMethod:'integration'});
    const key=`pilot-integration-${crypto.randomUUID()}`;
    const created=await createPilotRun(db,{name:'Synthetic Pilot',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:1,idempotencyKey:key},auth);
    const replay=await createPilotRun(db,{name:'Synthetic Pilot',region:'Regiao Ficticia',category:'Categoria Ficticia',targetLeadCount:1,idempotencyKey:key},auth);
    if(!replay.replayed||replay.data.id!==created.data.id)throw new Error('pilot create replay failed');
    const lead=(await db.execute(sql<{id:string}[]>`insert into leads(osm_type,osm_id,name,category,city,state,score,status,qualification_status) values('node',${`pilot-${crypto.randomUUID()}`},'Empresa Ficticia','Categoria Ficticia','Regiao Ficticia','XX',1,'SEM_SITE_CADASTRADO','SEM_SITE_CONFIRMADO') returning id`))[0] as {id:string};
    await db.execute(sql`insert into lead_contacts(lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid) values(${lead.id}::uuid,'EMAIL','canary@example.invalid','canary@example.invalid','SYNTHETIC',1,now(),true)`);
    await addPilotLead(db,created.data.id,{leadId:lead.id,source:'SYNTHETIC',expectedVersion:1,idempotencyKey:`${key}-lead`},auth);
    await reviewPilotLead(db,created.data.id,lead.id,{decision:'APPROVED',expectedVersion:0,idempotencyKey:`${key}-review`},auth);
    const timeline=await db.execute(sql<{count:number}[]>`select count(*)::int count from pilot_timeline_events where pilot_run_id=${created.data.id}::uuid`);
    if((timeline[0]?.count??0)!==3)throw new Error('pilot timeline is not append-only/reconciled');
  } finally { await close(); }
}
