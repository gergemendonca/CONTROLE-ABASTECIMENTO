import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {isManagementUser,requireRole} from '../../../admin-auth';
import {controlSql,ensureTripControl} from '@/app/lib/trip-control';
import {ensureTripAudit,recordTripAudit} from '@/app/lib/trip-audit';
import {activeTrip,ensureTripCancellation} from '@/app/lib/trip-cancellation';

const today=()=>{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=(name:string)=>parts.find(x=>x.type===name)?.value||'';return `${part('year')}-${part('month')}-${part('day')}`};
async function ensureAuditName(){const columns=await env.DB!.prepare('PRAGMA table_info(fuel_requests)').all<{name:string}>();if(!columns.results.some(column=>column.name==='authorized_by_name'))await env.DB!.prepare('ALTER TABLE fuel_requests ADD COLUMN authorized_by_name text').run();if(!columns.results.some(column=>column.name==='authorized_registered_at'))await env.DB!.prepare('ALTER TABLE fuel_requests ADD COLUMN authorized_registered_at text').run();}

async function loggedPOST(req:Request,{params}:{params:Promise<{id:string}>}){
  const access=await requireRole(req,'autorizador');
  if(!access.user)return Response.json({error:access.error},{status:403});
  try{
  await ensureAuditName();await ensureTripControl();await ensureTripAudit();await ensureTripCancellation();
    const id=Number((await params).id),management=isManagementUser(access.user);
    if(!Number.isSafeInteger(id))return Response.json({error:'Pedido inválido.'},{status:400});
    const item=await env.DB!.prepare(`SELECT f.trip_id AS tripId,${controlSql('t')},t.route,v.label AS vehicleLabel,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,COALESCE(f.retroactive,0) AS retroactive FROM fuel_requests f JOIN trips t ON t.id=f.trip_id JOIN vehicles v ON v.id=t.vehicle_id WHERE f.id=? AND f.status='pending' AND ${activeTrip('t')} AND (COALESCE(t.arrival_date,t.travel_date)>=? OR COALESCE(f.retroactive,0)=1)`).bind(id,today()).first<{tripId:number;controlNumber:string;route:string;vehicleLabel:string;arrivalDate:string;retroactive:number}>();
    if(!item)return Response.json({error:'Este pedido já venceu, foi tratado ou não existe.'},{status:409});
    const now=new Date().toISOString(),when=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(now)),retroactive=Number(item.retroactive)===1;
    if(retroactive&&!management)return Response.json({error:'Somente Adm ou Gerência pode autorizar uma viagem fora do prazo.'},{status:403});
    await env.DB!.prepare("UPDATE fuel_requests SET status='authorized',authorized_by=?,authorized_by_name=?,authorized_at=?,authorized_registered_at=? WHERE id=? AND status='pending'").bind(access.user.bootstrap?null:access.user.id,access.user.name,now,now,id).run();
    if(retroactive)await recordTripAudit({tripId:item.tripId,action:'autorizacao_registrada',actorName:access.user.name,effectiveAt:now,registeredAt:now,retroactive:true});
    const viewers=await env.DB!.prepare('SELECT user_id AS id FROM trip_users WHERE trip_id=?').bind(item.tripId).all<{id:number}>();
    const managers=await env.DB!.prepare("SELECT id FROM app_users WHERE active=1 AND group_name='gerencia'").all<{id:number}>();
    const ids=[...new Set([...viewers.results.map(x=>x.id),...managers.results.map(x=>x.id)])];
    const message=`${item.controlNumber} — ${item.vehicleLabel} — ${item.route}. Autorizado por ${access.user.name} em ${when}.`;
    if(ids.length)await env.DB!.batch(ids.map(userId=>env.DB!.prepare('INSERT INTO app_notifications (user_id,title,message,href,created_at) VALUES (?,?,?,?,?)').bind(userId,'Abastecimento autorizado',message,`/autorizacoes?pedido=${id}`,now)));
    return Response.json({authorized:true,authorizedBy:access.user.name,authorizedAt:now});
  }catch{return Response.json({error:'Não foi possível autorizar o pedido.'},{status:503})}
}

export const POST=withSystemLog(loggedPOST);
