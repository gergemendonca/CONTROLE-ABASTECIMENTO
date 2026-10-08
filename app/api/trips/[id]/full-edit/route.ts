import {env} from 'cloudflare:workers';
import {getSession,isManagementUser} from '../../../admin-auth';
import {ensureTripAudit,recordTripAudit} from '@/app/lib/trip-audit';
import {activeTrip,ensureTripCancellation} from '@/app/lib/trip-cancellation';

type Context={params:Promise<{id:string}>};
type Input={vehicleId:number;departureDate:string;arrivalDate:string;route:string;totalKm:number;totalValueCents:number;associatedUserIds:number[];externalDriverNames?:string[];paymentStatus:'total'|'parcial'|'nao_pago';outstandingCents:number;allowConflicts?:boolean};
const dateOk=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
const today=()=>{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const field=(name:string)=>parts.find(part=>part.type===name)?.value||'';return `${field('year')}-${field('month')}-${field('day')}`};
const paymentOk=(value:string)=>value==='total'||value==='parcial'||value==='nao_pago';
const externalNames=(input:Input)=>[...new Set((input.externalDriverNames||[]).map(name=>String(name).trim()).filter(name=>name.length>0&&name.length<=100))];
async function ensureExternalDrivers(){await env.DB!.prepare('CREATE TABLE IF NOT EXISTS trip_external_drivers (trip_id INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(trip_id,name))').run();}
function valid(input:Input){const guests=externalNames(input);return Number.isSafeInteger(input.vehicleId)&&dateOk(input.departureDate)&&dateOk(input.arrivalDate)&&input.arrivalDate>=input.departureDate&&typeof input.route==='string'&&!!input.route.trim()&&input.route.trim().length<=300&&Number.isSafeInteger(input.totalKm)&&input.totalKm>0&&Number.isSafeInteger(input.totalValueCents)&&input.totalValueCents>0&&Array.isArray(input.associatedUserIds)&&input.associatedUserIds.every(Number.isSafeInteger)&&Array.isArray(input.externalDriverNames)&&guests.length===(input.externalDriverNames||[]).filter(name=>String(name).trim()).length&&(input.associatedUserIds.length+guests.length)<=3&&paymentOk(input.paymentStatus)&&Number.isSafeInteger(input.outstandingCents)&&input.outstandingCents>=0}

export async function GET(req:Request,{params}:Context){
 const session=await getSession(req);if(!isManagementUser(session)||session?.passwordChangeRequired)return Response.json({error:'Apenas Adm ou Gerência pode editar a viagem.'},{status:403});
 try{await ensureExternalDrivers();await ensureTripCancellation();const id=Number((await params).id);if(!Number.isSafeInteger(id))return Response.json({error:'Viagem inválida.'},{status:400});const trip=await env.DB!.prepare(`SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel,COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,t.route,t.total_km AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,COALESCE((SELECT payment_status FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1),'nao_pago') AS paymentStatus,COALESCE((SELECT outstanding_cents FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1),COALESCE(t.total_value_cents,0)) AS outstandingCents,COALESCE((SELECT GROUP_CONCAT(user_id) FROM trip_users WHERE trip_id=t.id),'') AS userIds,COALESCE((SELECT GROUP_CONCAT(name,'|') FROM trip_external_drivers WHERE trip_id=t.id),'') AS externalDriverNames FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=? AND ${activeTrip('t')}`).bind(id).first<any>();if(!trip)return Response.json({error:'Viagem não encontrada ou cancelada.'},{status:404});return Response.json({trip:{...trip,userIds:trip.userIds?String(trip.userIds).split(',').map(Number):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}})}catch{return Response.json({error:'Não foi possível carregar a viagem.'},{status:503})}
}

export async function PUT(req:Request,{params}:Context){
 const session=await getSession(req);if(!isManagementUser(session)||session?.passwordChangeRequired)return Response.json({error:'Apenas Adm ou Gerência pode editar a viagem.'},{status:403});
 try{
  await ensureExternalDrivers();await ensureTripAudit();await ensureTripCancellation();const id=Number((await params).id),input=await req.json() as Input;
  if(!Number.isSafeInteger(id)||!valid(input))return Response.json({error:'Confira veículo, datas, roteiro, KM, valor, pagamento e até três motoristas.'},{status:400});
  const total=input.totalValueCents;
  if(input.paymentStatus==='total'&&input.outstandingCents!==0)return Response.json({error:'Viagem totalmente paga não pode ter valor em aberto.'},{status:400});
  if(input.paymentStatus==='parcial'&&(input.outstandingCents<=0||input.outstandingCents>=total))return Response.json({error:'No pagamento parcial, o valor em aberto deve ser maior que zero e menor que o valor total.'},{status:400});
  if(input.paymentStatus==='nao_pago'&&input.outstandingCents!==total)return Response.json({error:'Em viagem não paga, o valor em aberto deve ser igual ao valor total.'},{status:400});
  const vehicleBusy=await env.DB!.prepare(`SELECT id FROM trips WHERE vehicle_id=? AND id<>? AND ${activeTrip('trips')} AND COALESCE(departure_date,travel_date)<=? AND COALESCE(arrival_date,travel_date)>=? LIMIT 1`).bind(input.vehicleId,id,input.arrivalDate,input.departureDate).first();
  if(vehicleBusy&&!input.allowConflicts)return Response.json({error:'Há conflito de horário para este carro. Confirme a compatibilidade antes de salvar.'},{status:409});
  const automatic=await env.DB!.prepare("SELECT id FROM app_users WHERE active=1 AND group_name IN ('adm','gerencia')").all<{id:number}>();
  const userIds=[...new Set([...input.associatedUserIds,...automatic.results.map(user=>user.id)])],guests=externalNames(input);
  const latestRequest=await env.DB!.prepare('SELECT id FROM fuel_requests WHERE trip_id=? AND status=\'pending\' ORDER BY id DESC LIMIT 1').bind(id).first<{id:number}>();
  const statements=[env.DB!.prepare(`UPDATE trips SET vehicle_id=?,travel_date=?,departure_date=?,arrival_date=?,route=?,total_km=?,total_value_cents=? WHERE id=? AND ${activeTrip('trips')}`).bind(input.vehicleId,input.departureDate,input.departureDate,input.arrivalDate,input.route.trim(),input.totalKm,total,id),env.DB!.prepare('DELETE FROM trip_users WHERE trip_id=?').bind(id),env.DB!.prepare('DELETE FROM trip_external_drivers WHERE trip_id=?').bind(id),...userIds.map(userId=>env.DB!.prepare('INSERT OR IGNORE INTO trip_users (trip_id,user_id) VALUES (?,?)').bind(id,userId)),...guests.map(name=>env.DB!.prepare('INSERT OR IGNORE INTO trip_external_drivers (trip_id,name) VALUES (?,?)').bind(id,name))];
  if(latestRequest)statements.push(env.DB!.prepare('UPDATE fuel_requests SET payment_status=?,outstanding_cents=? WHERE id=?').bind(input.paymentStatus,input.outstandingCents,latestRequest.id));
  await env.DB!.batch(statements);
  const now=new Date().toISOString(),retroactive=input.departureDate<today();
  if(retroactive)await recordTripAudit({tripId:id,action:'viagem_editada',actorName:session.name,effectiveAt:input.departureDate+'T12:00:00.000Z',registeredAt:now,retroactive:true});
  return Response.json({updated:true,requestUpdated:!!latestRequest});
 }catch{return Response.json({error:'Não foi possível gravar a edição da viagem.'},{status:503})}
}
