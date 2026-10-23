from pathlib import Path
root=Path('/mnt/data/update_v152')
def edit(f):return (root/f).read_text()
def save(f,s):(root/f).write_text(s)
def rep(f,a,b,n=None):
 s=edit(f); count=s.count(a)
 if n is not None and count!=n: raise RuntimeError(f'{f}: expected {n} matches, got {count}: {a[:80]}')
 if count==0:raise RuntimeError(f'NOT FOUND {f}: {a[:100]}')
 save(f,s.replace(a,b))

# Lifecycle metadata is independent from date/time, and never changes fuel history.
f='app/lib/trip-cancellation.ts'
s=edit(f)
s=s.replace(" if(!names.has('fuel_cancel_reason'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN fuel_cancel_reason text').run();", " if(!names.has('fuel_cancel_reason'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN fuel_cancel_reason text').run();\n if(!names.has('finalized_at'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN finalized_at text').run();\n if(!names.has('finalized_by'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN finalized_by integer').run();\n if(!names.has('finalized_by_name'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN finalized_by_name text').run();")
s+='\n/** Uma viagem finalizada continua no histórico, mas sai da operação. */\nexport const operationalTrip=(alias=\'t\')=>`(${activeTrip(alias)} AND COALESCE(${alias}.finalized_at,\'\')=\'\')`;\n'
save(f,s)
# Drizzle schema
f='db/schema.ts'; rep(f," cancelReason:text('cancel_reason'),"," cancelReason:text('cancel_reason'),\n finalizedAt:text('finalized_at'),\n finalizedBy:integer('finalized_by'),\n finalizedByName:text('finalized_by_name'),",1)

# v152 endpoint. Batch finish (only existing open trips), reopen only from edit card.
f='app/api/trips/finalize/route.ts'; p=root/f;p.parent.mkdir(parents=True,exist_ok=True)
p.write_text('''import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession} from '../../admin-auth';
import {ensureTripCancellation} from '@/app/lib/trip-cancellation';

/** Finalização manual somente pelo ADM. Esta operação não altera pedidos, abastecimentos ou pagamentos. */
async function loggedPOST(req:Request){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired||!(user.bootstrap||user.groupName==='adm'))return Response.json({error:'Somente ADM pode finalizar viagens.'},{status:403});
 try{
  await ensureTripCancellation();
  const payload=await req.json() as {tripIds?:unknown};
  const ids=payload.tripIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)return Response.json({error:'Selecione de 1 a 100 viagens abertas, sem duplicidade.'},{status:400});
  const marks=ids.map(()=>'?').join(',');
  const matching=await env.DB!.prepare(`SELECT id FROM trips WHERE id IN (${marks}) AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')=''`).bind(...ids).all<{id:number}>();
  if(matching.results.length!==ids.length)return Response.json({error:'Uma ou mais viagens já foram finalizadas, canceladas ou não existem. Atualize a lista.'},{status:409});
  const now=new Date().toISOString();
  const statements=ids.map(id=>env.DB!.prepare("UPDATE trips SET finalized_at=?,finalized_by=?,finalized_by_name=? WHERE id=? AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')=''").bind(now,user.bootstrap?null:user.id,user.name,id));
  await env.DB!.batch(statements);
  return Response.json({finalized:true,count:ids.length,logDetails:`Finalização manual pelo ADM de ${ids.length} viagem(ns): ${ids.join(', ')}`});
 }catch(error){console.error('Falha na finalização manual:',error);return Response.json({error:'Não foi possível finalizar as viagens. Nenhum abastecimento foi alterado.'},{status:503})}
}
export const POST=withSystemLog(loggedPOST);
''')
f='app/api/trips/[id]/reopen/route.ts';p=root/f;p.parent.mkdir(parents=True,exist_ok=True)
p.write_text('''import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession} from '../../../admin-auth';
import {ensureTripCancellation} from '@/app/lib/trip-cancellation';

type Context={params:Promise<{id:string}>};
async function loggedPOST(req:Request,{params}:Context){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired||!(user.bootstrap||user.groupName==='adm'))return Response.json({error:'Somente ADM pode reabrir uma viagem.'},{status:403});
 try{
  await ensureTripCancellation();
  const id=Number((await params).id);
  if(!Number.isSafeInteger(id)||id<=0)return Response.json({error:'Viagem inválida.'},{status:400});
  const exists=await env.DB!.prepare("SELECT id FROM trips WHERE id=? AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')<>''").bind(id).first();
  if(!exists)return Response.json({error:'A viagem não está finalizada ou está cancelada.'},{status:409});
  await env.DB!.prepare("UPDATE trips SET finalized_at=NULL,finalized_by=NULL,finalized_by_name=NULL WHERE id=? AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')<>''").bind(id).run();
  return Response.json({reopened:true,logDetails:`Viagem ${id} reaberta pelo ADM ${user.name}.`});
 }catch(error){console.error('Falha ao reabrir viagem:',error);return Response.json({error:'Não foi possível reabrir a viagem.'},{status:503})}
}
export const POST=withSystemLog(loggedPOST);
''')

# API Trip GET: keep closed visible only to management on opt-in edit screen.
f='app/api/trips/route.ts';s=edit(f)
s=s.replace("import {activeTrip,canceledTrip,ensureTripCancellation}","import {activeTrip,canceledTrip,operationalTrip,ensureTripCancellation}")
s=s.replace("canceled=url.searchParams.get('canceled')==='1';","canceled=url.searchParams.get('canceled')==='1',includeFinalized=url.searchParams.get('includeFinalized')==='1';")
# API GET lookup for fueling and request
s=s.replace("${activeTrip('trips')} AND COALESCE(fuel_canceled_at,'')=''", "${operationalTrip('trips')} AND COALESCE(fuel_canceled_at,'')=''")
s=s.replace("${activeTrip('t')} AND COALESCE(t.fuel_canceled_at,'')=''", "${operationalTrip('t')} AND COALESCE(t.fuel_canceled_at,'')=''")
s=s.replace("${activeTrip('t')} AND COALESCE(t.no_fueling,0)=0", "${operationalTrip('t')} AND COALESCE(t.no_fueling,0)=0")
s=s.replace("${activeTrip('trips')} AND COALESCE(no_fueling,0)=0", "${operationalTrip('trips')} AND COALESCE(no_fueling,0)=0")
s=s.replace("${activeTrip('t')} AND COALESCE(t.arrival_date,t.travel_date)>=date('now')", "${operationalTrip('t')} AND COALESCE(t.arrival_date,t.travel_date)>=date('now')")
# isCompleted changed from days logic, plus explicit finalized metadata for UI
s=s.replace("CASE WHEN COALESCE(t.arrival_date,t.travel_date)<=date('now','-3 hours','-2 days') THEN 1 ELSE 0 END AS isCompleted", "CASE WHEN COALESCE(t.finalized_at,'')<>'' THEN 1 ELSE 0 END AS isCompleted,t.finalized_at AS finalizedAt,t.finalized_by_name AS finalizedBy")
s=s.replace("${requestedFilter||` WHERE ${activeTrip('t')}`}","${requestedFilter||` WHERE ${includeFinalized?activeTrip('t'):operationalTrip('t')}`}")
s=s.replace("` WHERE ${activeTrip('t')}`} GROUP BY t.id ORDER", "` WHERE ${operationalTrip('t')}`} GROUP BY t.id ORDER")
save(f,s)
# Canceling even fueled is allowed; keeps physical record and historical linking.
f='app/api/trips/[id]/route.ts';s=edit(f)
s=s.replace("import {activeTrip,ensureTripCancellation}","import {activeTrip,operationalTrip,ensureTripCancellation}")
# edit old PUT only open
s=s.replace("WHERE id=? AND ${activeTrip('trips')}`)","WHERE id=? AND ${operationalTrip('trips')}`)")
# cancel: strip blocked-fuel condition, preserve physical fuel;
s=s.replace("const fueled=await env.DB!.prepare(`SELECT id FROM fueling WHERE trip_id=? AND liters>0 LIMIT 1`).bind(id).first();const transferred=await env.DB!.prepare(`SELECT id FROM fueling_usage WHERE used_by_trip_id=? LIMIT 1`).bind(id).first();const confirmed=await env.DB!.prepare(`SELECT trip_id FROM fueling_status_confirmations WHERE trip_id=? LIMIT 1`).bind(id).first();if(fueled||transferred||confirmed)return Response.json({error:'Esta viagem possui abastecimento realmente registrado e não pode ser cancelada.'},{status:409});", "// O abastecimento físico pertence ao carro. Cancelamento não apaga nem reassocia o combustível.\n")
# Pending requests for canceled trips should be marked canceled only if not linked to fuel
s=s.replace(".bind(now,session.id,session.name,reason,id).run();return Response.json({canceled:true})", ".bind(now,session.id,session.name,reason,id).run();await env.DB!.prepare(\"UPDATE fuel_requests SET status='canceled' WHERE trip_id=? AND status IN ('pending','authorized') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fuel_requests.id)\").bind(id).run();return Response.json({canceled:true})")
save(f,s)
# Full edit: finalization does not permit changes; requires explicit reopening first
f='app/api/trips/[id]/full-edit/route.ts';s=edit(f)
s=s.replace("import {activeTrip,ensureTripCancellation}","import {activeTrip,operationalTrip,ensureTripCancellation}")
s=s.replace("WHERE t.id=? AND ${activeTrip('t')}", "WHERE t.id=? AND ${operationalTrip('t')}")
s=s.replace("WHERE id=? AND ${activeTrip('t')}", "WHERE id=? AND ${operationalTrip('t')}")
s=s.replace("WHERE id=? AND ${activeTrip('trips')}", "WHERE id=? AND ${operationalTrip('trips')}")
save(f,s)
print('part one complete')
