import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession,type SessionUser} from '../admin-auth';
import {validate} from './common';
import {controlSql,ensureTripControl} from '@/app/lib/trip-control';
import {actionDate} from '@/app/lib/action-date';
import {ensureTripAudit,recordTripAudit} from '@/app/lib/trip-audit';

export const dynamic='force-dynamic';
const fields=`f.id,f.vehicle_id AS vehicleId,v.label AS vehicleLabel,f.driver_id AS driverId,f.driver,f.odometer,f.amount_cents AS amountCents,f.created_at AS createdAt,f.liters,f.trip_id AS tripId,f.fuel_request_id AS fuelRequestId,f.launched_by AS launchedById,COALESCE(f.launched_by_name,'Não informado') AS launchedBy,COALESCE(f.direct_launch,0) AS directLaunch,COALESCE(f.retroactive,0) AS retroactive,COALESCE(f.authorization_observation,'') AS authorizationObservation,${controlSql('t')},COALESCE(t.route,(SELECT oldTrip.route FROM trips oldTrip WHERE oldTrip.vehicle_id=f.vehicle_id AND date(f.created_at) BETWEEN COALESCE(oldTrip.departure_date,oldTrip.travel_date) AND COALESCE(oldTrip.arrival_date,oldTrip.travel_date) ORDER BY COALESCE(oldTrip.departure_date,oldTrip.travel_date) DESC LIMIT 1)) AS route`;

async function linkedRequest(tripId:number){return env.DB!.prepare("SELECT fr.id FROM fuel_requests fr WHERE fr.trip_id=? AND fr.status='authorized' AND (fr.created_at>=datetime('now','-5 days') OR COALESCE(fr.retroactive,0)=1) AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fr.id) ORDER BY fr.authorized_at DESC,fr.id DESC LIMIT 1").bind(tripId).first<{id:number}>();}
async function ensureLaunchAudit(){const columns=await env.DB!.prepare('PRAGMA table_info(fueling)').all<{name:string}>();if(!columns.results.some(column=>column.name==='launched_by'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN launched_by integer').run();if(!columns.results.some(column=>column.name==='launched_by_name'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN launched_by_name text').run();if(!columns.results.some(column=>column.name==='direct_launch'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN direct_launch integer DEFAULT 0 NOT NULL').run();if(!columns.results.some(column=>column.name==='authorization_observation'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN authorization_observation text').run();if(!columns.results.some(column=>column.name==='retroactive'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN retroactive integer DEFAULT 0 NOT NULL').run();if(!columns.results.some(column=>column.name==='registered_at'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN registered_at text').run();}
function canChooseDriver(user:SessionUser){return !!user.bootstrap||user.groupName==='adm'||user.groupName==='gerencia';}
async function canLaunchFor(user:SessionUser,driverId:number){if(canChooseDriver(user))return true;if(user.groupName!=='motorista'||!user.roles.includes('solicitante'))return false;return !!await env.DB!.prepare('SELECT id FROM drivers WHERE id=? AND lower(name)=lower(?) LIMIT 1').bind(driverId,user.name).first();}
async function canUseTrip(user:SessionUser,tripId:number){
 if(canChooseDriver(user))return true;
 return !!await env.DB!.prepare('SELECT 1 FROM trip_users WHERE trip_id=? AND user_id=? LIMIT 1').bind(tripId,user.id).first();
}
const today=()=>{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=(name:string)=>parts.find(item=>item.type===name)?.value||'';return `${part('year')}-${part('month')}-${part('day')}`};

export async function GET(req:Request){try{const session=await getSession(req);if(!session)return Response.json({error:'Faça login para consultar abastecimentos.'},{status:401});await ensureLaunchAudit();const last30=new URL(req.url).searchParams.get('days')==='30',management=canChooseDriver(session);let where='',binds:unknown[]=[];if(!management){where=" WHERE f.created_at>=datetime('now','-30 days') AND f.driver_id=(SELECT id FROM drivers WHERE lower(name)=lower(?) LIMIT 1)";binds=[session.name];}const sql=`SELECT ${fields} FROM fueling f JOIN vehicles v ON v.id=f.vehicle_id LEFT JOIN trips t ON t.id=f.trip_id${where} ORDER BY f.created_at DESC,f.id DESC${!management&&!last30?' LIMIT 50':''}`;const records=(await env.DB!.prepare(sql).bind(...binds).all()).results;const ids=records.map(record=>Number(record.id));const items=ids.length?(await env.DB!.prepare(`SELECT fueling_id AS fuelingId,kind,quantity,amount_cents AS amountCents FROM fueling_items WHERE fueling_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).bind(...ids).all()).results:[];return Response.json({records:records.map(record=>({...record,items:items.filter(item=>item.fuelingId===record.id)})),allRecords:management});}catch{return Response.json({error:'Não foi possível carregar os registros.'},{status:503})}}

async function loggedPOST(req:Request){
 try{
  const session=await getSession(req);
  if(!session)return Response.json({error:'Faça login para lançar abastecimento.'},{status:401});
  const input=await req.json() as any,selectedDate=actionDate(input?.effectiveAt);
  if(selectedDate===undefined)return Response.json({error:'A data retroativa é inválida ou está no futuro.'},{status:400});
  if(selectedDate&&!canChooseDriver(session))return Response.json({error:'Somente Adm ou Gerência pode informar uma data retroativa.'},{status:403});
  const data=await validate(input,canChooseDriver(session));
  if(!data)return Response.json({error:'Escolha uma viagem em período válido ou com autorização disponível nos últimos 5 dias e confira veículo, motorista, KM, itens, quantidades e valores.'},{status:400});
  const tripIsPast=data.arrivalDate<today();
  if(tripIsPast&&!canChooseDriver(session))return Response.json({error:'Somente Adm ou Gerência pode lançar abastecimento de viagem fora do prazo.'},{status:403});
  if(tripIsPast&&!selectedDate)return Response.json({error:'Informe a data e hora reais do abastecimento retroativo no formato DDMMAAAA HHMM.'},{status:400});
  const retroactive=canChooseDriver(session)&&(tripIsPast||!!selectedDate);
  const alreadyFueled=await env.DB!.prepare('SELECT id FROM fueling WHERE trip_id=? LIMIT 1').bind(data.tripId).first();
  if(alreadyFueled)return Response.json({error:'Esta viagem já possui um abastecimento realizado e não pode receber um novo lançamento.'},{status:409});
  if(!await canLaunchFor(session,data.driverId))return Response.json({error:'Você só pode lançar abastecimento em seu próprio nome.'},{status:403});
  if(!await canUseTrip(session,data.tripId))return Response.json({error:'Esta viagem não está associada ao seu usuário.'},{status:403});
  const last=await env.DB!.prepare('SELECT MAX(odometer) AS odometer FROM fueling WHERE vehicle_id=?').bind(data.vehicleId).first<{odometer:number|null}>();
  if(last?.odometer!==null&&last?.odometer!==undefined&&data.odometer<last.odometer)return Response.json({error:`A quilometragem informada é inferior à última registrada para este carro (${last.odometer.toLocaleString('pt-BR')} km). Revise o painel do veículo.`},{status:409});
  await ensureLaunchAudit();await ensureTripAudit();
  const duplicate=await env.DB!.prepare('SELECT id FROM fueling WHERE vehicle_id=? AND odometer=? LIMIT 1').bind(data.vehicleId,data.odometer).first();
  if(duplicate)return Response.json({error:'Já existe um abastecimento deste veículo com esta quilometragem. Confira o KM informado.'},{status:409});
  const request=await linkedRequest(data.tripId),directLaunch=!request,id=Date.now()*1000+Math.floor(Math.random()*1000),registeredAt=new Date().toISOString(),date=selectedDate||registeredAt,observation=retroactive?`Lançamento fora do prazo feito por ${session.name} em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(registeredAt))}.`:directLaunch?`Lançamento direto pela área de usuário, sem autorização prévia formal. Registrado por ${session.name} em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(registeredAt))}.`:null;
  await env.DB!.batch([env.DB!.prepare('INSERT INTO fueling (id,vehicle_id,driver_id,driver,liters,odometer,amount_cents,trip_id,fuel_request_id,launched_by,launched_by_name,direct_launch,authorization_observation,retroactive,created_at,registered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,data.vehicleId,data.driverId,data.driverName,data.liters,data.odometer,data.total,data.tripId,request?.id||null,session.bootstrap?null:session.id,session.name,directLaunch?1:0,observation,retroactive?1:0,date,registeredAt),...data.items.map(item=>env.DB!.prepare('INSERT INTO fueling_items (fueling_id,kind,quantity,amount_cents) VALUES (?,?,?,?)').bind(id,item.kind,item.quantity,item.amountCents))]);
  if(retroactive)await recordTripAudit({tripId:data.tripId,action:'abastecimento_lancado',actorName:session.name,effectiveAt:date,registeredAt,retroactive:true});
  return Response.json({id,createdAt:date,registeredAt,launchedBy:session.name,driver:data.driverName,directLaunch,retroactive,authorizationObservation:observation},{status:201});
 }catch{return Response.json({error:'Falha ao salvar. Tente novamente.'},{status:503})}
}

export const POST=withSystemLog(loggedPOST);
