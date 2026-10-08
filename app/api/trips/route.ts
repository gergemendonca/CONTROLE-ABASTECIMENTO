import {env} from 'cloudflare:workers';
import {getSession,isManagementUser,requireRole} from '../admin-auth';
import {controlNumber,controlSql,ensureTripControl} from '@/app/lib/trip-control';
import {ensureTripAudit,lateActivitySql,parseLateActivities,recordTripAudit} from '@/app/lib/trip-audit';
import {activeTrip,canceledTrip,ensureTripCancellation} from '@/app/lib/trip-cancellation';

export const dynamic='force-dynamic';
const dateOk=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
const today=()=>{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const field=(name:string)=>parts.find(part=>part.type===name)?.value||'';return `${field('year')}-${field('month')}-${field('day')}`};
type TripInput={vehicleId:number;departureDate:string;arrivalDate:string;route:string;totalKm:number;totalValueCents:number;associatedUserIds?:number[];externalDriverNames?:string[];allowConflicts?:boolean};
const rangeConflict=(vehicleId:number,departureDate:string,arrivalDate:string)=>env.DB!.prepare(`SELECT id FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND COALESCE(departure_date,travel_date)<=? AND COALESCE(arrival_date,travel_date)>=? LIMIT 1`).bind(vehicleId,arrivalDate,departureDate).first();
// Alguns lançamentos antigos podem estar associados somente à solicitação.
// Por isso, a viagem é considerada abastecida tanto pelo trip_id quanto pelo
// fuel_request_id ligado a ela. Nunca escondemos esse caso apenas por faltar
// um dos vínculos históricos.
const noFuelingForTrip=(alias:string)=>`NOT EXISTS (SELECT 1 FROM fueling done WHERE done.trip_id=${alias}.id OR EXISTS (SELECT 1 FROM fuel_requests linked WHERE linked.id=done.fuel_request_id AND linked.trip_id=${alias}.id))`;
async function driverConflict(driverIds:number[],departureDate:string,arrivalDate:string){for(const driverId of driverIds){const row=await env.DB!.prepare(`SELECT t.id FROM trips t JOIN trip_users tu ON tu.trip_id=t.id WHERE tu.user_id=? AND ${activeTrip('t')} AND COALESCE(t.departure_date,t.travel_date)<=? AND COALESCE(t.arrival_date,t.travel_date)>=? LIMIT 1`).bind(driverId,arrivalDate,departureDate).first();if(row)return true}return false}
const externalNames=(input:TripInput)=>[...new Set((input.externalDriverNames||[]).map(name=>String(name).trim()).filter(name=>name.length>0&&name.length<=100))];
async function ensureExternalDrivers(){await env.DB!.prepare('CREATE TABLE IF NOT EXISTS trip_external_drivers (trip_id INTEGER NOT NULL, name TEXT NOT NULL, UNIQUE(trip_id,name))').run();}
async function ensureMovementFlags(){
 const requestColumns=await env.DB!.prepare('PRAGMA table_info(fuel_requests)').all<{name:string}>();
 if(!requestColumns.results.some(column=>column.name==='retroactive'))await env.DB!.prepare('ALTER TABLE fuel_requests ADD COLUMN retroactive integer DEFAULT 0 NOT NULL').run();
 const fuelingColumns=await env.DB!.prepare('PRAGMA table_info(fueling)').all<{name:string}>();
 if(!fuelingColumns.results.some(column=>column.name==='retroactive'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN retroactive integer DEFAULT 0 NOT NULL').run();
}
function valid(input:TripInput){const guests=externalNames(input);return Number.isInteger(input.vehicleId)&&dateOk(input.departureDate)&&dateOk(input.arrivalDate)&&input.arrivalDate>=input.departureDate&&typeof input.route==='string'&&!!input.route.trim()&&input.route.trim().length<=300&&Number.isSafeInteger(input.totalKm)&&input.totalKm>0&&Number.isSafeInteger(input.totalValueCents)&&input.totalValueCents>0&&Array.isArray(input.associatedUserIds)&&input.associatedUserIds.every(Number.isSafeInteger)&&Array.isArray(input.externalDriverNames)&&guests.length===(input.externalDriverNames||[]).filter(name=>String(name).trim()).length&&(input.associatedUserIds.length+guests.length)<=3}

export async function GET(req:Request){
 try{
  const url=new URL(req.url),vehicleId=Number(url.searchParams.get('vehicleId')),date=url.searchParams.get('date'),from=url.searchParams.get('from'),to=url.searchParams.get('to'),available=url.searchParams.get('available')==='1',launch=url.searchParams.get('launch')==='1',canceled=url.searchParams.get('canceled')==='1';
  const headers={'Cache-Control':'no-store, max-age=0'};
  await ensureExternalDrivers();await ensureTripControl();await ensureMovementFlags();await ensureTripAudit();await ensureTripCancellation();
  const compactFields=`id,vehicle_id AS vehicleId,${controlSql('trips')},COALESCE(departure_date,travel_date) AS departureDate,COALESCE(arrival_date,travel_date) AS arrivalDate,route,total_km AS totalKm,COALESCE(total_value_cents,0) AS totalValueCents,COALESCE((SELECT GROUP_CONCAT(au.name) FROM trip_users tu JOIN app_users au ON au.id=tu.user_id WHERE tu.trip_id=trips.id AND au.group_name='motorista'),'') AS associatedDriverNames,COALESCE((SELECT GROUP_CONCAT(name,'|') FROM trip_external_drivers WHERE trip_id=trips.id),'') AS externalDriverNames`;
  if(vehicleId&&launch){
   const access=await requireRole(req,'solicitante','autorizador','avisado');
   if(!access.user)return Response.json({error:access.error},{status:403,headers});
   const management=isManagementUser(access.user);
   const scope=management?'':` AND EXISTS (SELECT 1 FROM trip_users mine WHERE mine.trip_id=trips.id AND mine.user_id=?)`;
   const sql=`SELECT ${compactFields} FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND ${noFuelingForTrip('trips')} AND (${management?'1=1':"COALESCE(arrival_date,travel_date)>=date('now') OR EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.trip_id=trips.id AND fr.status='authorized' AND fr.created_at>=datetime('now','-5 days') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fr.id))"})${scope} ORDER BY COALESCE(departure_date,travel_date) DESC,id DESC`;
   const rows=management?await env.DB!.prepare(sql).bind(vehicleId).all():await env.DB!.prepare(sql).bind(vehicleId,access.user.id).all();
   return Response.json({trips:(rows.results||[]).map((trip:any)=>({...trip,associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}))},{headers});
  }
  if(vehicleId&&from&&to&&dateOk(from)&&dateOk(to)&&to>=from){
   const rows=await env.DB!.prepare(`SELECT ${compactFields} FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND COALESCE(arrival_date,travel_date)>=? AND COALESCE(departure_date,travel_date)<=? ORDER BY COALESCE(departure_date,travel_date),id`).bind(vehicleId,from,to).all();
   return Response.json({trips:(rows.results||[]).map((trip:any)=>({...trip,associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}))},{headers});
  }
  if(vehicleId&&date){
   const trip=await env.DB!.prepare(`SELECT ${compactFields} FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND COALESCE(departure_date,travel_date)<=? AND COALESCE(arrival_date,travel_date)>=? ORDER BY COALESCE(departure_date,travel_date) DESC LIMIT 1`).bind(vehicleId,date,date).first();
   return Response.json({trip:trip?{...trip,associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}:null},{headers});
  }
  const access=await requireRole(req,'solicitante','autorizador','avisado');
  if(!access.user)return Response.json({error:access.error},{status:403,headers});
  const management=isManagementUser(access.user);
  if(canceled){
   if(!management)return Response.json({error:'Apenas Adm ou Gerência pode consultar viagens canceladas.'},{status:403,headers});
   const rows=await env.DB!.prepare(`SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel,${controlSql('t')},COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,t.route,t.total_km AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,COALESCE(t.cancel_reason,'Motivo não informado') AS cancelReason,COALESCE(t.canceled_by_name,'Não informado') AS canceledBy,COALESCE(t.canceled_at,'') AS canceledAt,COALESCE((SELECT GROUP_CONCAT(au.name) FROM trip_users tu JOIN app_users au ON au.id=tu.user_id WHERE tu.trip_id=t.id AND au.group_name='motorista'),'') AS associatedDriverNames,COALESCE((SELECT GROUP_CONCAT(name,'|') FROM trip_external_drivers WHERE trip_id=t.id),'') AS externalDriverNames FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE ${canceledTrip('t')} ORDER BY t.canceled_at DESC,t.id DESC LIMIT 200`).all();
   return Response.json({trips:(rows.results||[]).map((trip:any)=>({...trip,userIds:[],associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}))},{headers});
  }
  const requestedFilter=available?` WHERE ${activeTrip('t')} AND ${management?'1=1':"COALESCE(t.arrival_date,t.travel_date)>=date('now')"} AND ${noFuelingForTrip('t')} AND NOT EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.trip_id=t.id)`:'';
  const fields=`t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel,${controlSql('t')},COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,t.route,t.total_km AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,CASE WHEN EXISTS (SELECT 1 FROM fueling completed WHERE completed.trip_id=t.id OR EXISTS (SELECT 1 FROM fuel_requests linked WHERE linked.id=completed.fuel_request_id AND linked.trip_id=t.id)) THEN 'fueled' WHEN (SELECT fr.status FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1)='pending' THEN 'pending' WHEN (SELECT fr.status FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1)='authorized' THEN 'authorized' ELSE 'missing' END AS requestStatus,CASE WHEN EXISTS (SELECT 1 FROM trip_audit late_audit WHERE late_audit.trip_id=t.id AND late_audit.retroactive=1) THEN 1 ELSE 0 END AS hasLateActivity,${lateActivitySql('t')},COALESCE((SELECT GROUP_CONCAT(name,'|') FROM trip_external_drivers WHERE trip_id=t.id),'') AS externalDriverNames`;
  const sql=management?`SELECT ${fields},COALESCE(GROUP_CONCAT(tu.user_id), '') AS userIds FROM trips t JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN trip_users tu ON tu.trip_id=t.id${requestedFilter||` WHERE ${activeTrip('t')}`} GROUP BY t.id ORDER BY t.id DESC LIMIT 100`:`SELECT ${fields},COALESCE(GROUP_CONCAT(tu2.user_id), '') AS userIds FROM trips t JOIN vehicles v ON v.id=t.vehicle_id JOIN trip_users mine ON mine.trip_id=t.id AND mine.user_id=? LEFT JOIN trip_users tu2 ON tu2.trip_id=t.id${available?` WHERE ${activeTrip('t')} AND COALESCE(t.arrival_date,t.travel_date)>=date('now') AND ${noFuelingForTrip('t')} AND NOT EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.trip_id=t.id)`:` WHERE ${activeTrip('t')}`} GROUP BY t.id ORDER BY t.id DESC LIMIT 100`;
  const trips=management?await env.DB!.prepare(sql).all():await env.DB!.prepare(sql).bind(access.user.id).all();
  return Response.json({trips:(trips.results||[]).map((trip:any)=>({...trip,userIds:trip.userIds?String(trip.userIds).split(',').map(Number):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[],lateActivities:parseLateActivities(trip.lateActivities)}))},{headers});
 }catch{return Response.json({error:'Não foi possível consultar as viagens.'},{status:503,headers:{'Cache-Control':'no-store, max-age=0'}})}
}

export async function POST(req:Request){
 const session=await getSession(req);
 if(!isManagementUser(session)||session?.passwordChangeRequired)return Response.json({error:'Apenas usuários dos grupos Adm ou Gerência podem lançar viagens.'},{status:403});
 try{
  await ensureExternalDrivers();await ensureTripControl();await ensureTripCancellation();
  const input=await req.json() as TripInput;
  if(!valid(input))return Response.json({error:'Confira veículo, datas, quilometragem, valor total, roteiro e até três motoristas.'},{status:400});
  const selected=[...new Set(input.associatedUserIds||[])],guests=externalNames(input);
  const [vehicleBusy,driverBusy]=await Promise.all([rangeConflict(input.vehicleId,input.departureDate,input.arrivalDate),driverConflict(selected,input.departureDate,input.arrivalDate)]);
  if((vehicleBusy||driverBusy)&&!input.allowConflicts)return Response.json({error:'Já existe viagem para este carro ou motorista no período. Confirme a compatibilidade de horário antes de salvar.',conflicts:{vehicle:!!vehicleBusy,driver:driverBusy}},{status:409});
  const trip=await env.DB!.prepare('INSERT INTO trips (vehicle_id,travel_date,departure_date,arrival_date,route,total_km,total_value_cents) VALUES (?,?,?,?,?,?,?) RETURNING id,vehicle_id AS vehicleId,departure_date AS departureDate,arrival_date AS arrivalDate,route,total_km AS totalKm,total_value_cents AS totalValueCents').bind(input.vehicleId,input.departureDate,input.departureDate,input.arrivalDate,input.route.trim(),input.totalKm,input.totalValueCents).first<{id:number}>();
  if(trip){const number=controlNumber(trip.id);await env.DB!.prepare('UPDATE trips SET control_number=? WHERE id=?').bind(number,trip.id).run();(trip as any).controlNumber=number}
  const automatic=await env.DB!.prepare("SELECT id FROM app_users WHERE active=1 AND group_name IN ('adm','gerencia')").all<{id:number}>();
  const userIds=[...new Set([...selected,...automatic.results.map(user=>user.id)])];
  if(trip)await env.DB!.batch([...userIds.map(userId=>env.DB!.prepare('INSERT OR IGNORE INTO trip_users (trip_id,user_id) VALUES (?,?)').bind(trip.id,userId)),...guests.map(name=>env.DB!.prepare('INSERT OR IGNORE INTO trip_external_drivers (trip_id,name) VALUES (?,?)').bind(trip.id,name))]);
  if(trip&&input.departureDate<today()){
   // A auditoria é complementar: a viagem já foi salva e não pode receber
   // uma mensagem de erro por causa dela.
   try{await ensureTripAudit();await recordTripAudit({tripId:trip.id,action:'viagem_cadastrada',actorName:session.name,effectiveAt:input.departureDate+'T12:00:00.000Z',registeredAt:new Date().toISOString(),retroactive:true})}catch{}
  }
  return Response.json({trip});
 }catch{return Response.json({error:'Não foi possível salvar a viagem.'},{status:503})}
}
