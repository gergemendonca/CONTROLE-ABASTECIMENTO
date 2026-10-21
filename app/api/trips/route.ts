import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession,isManagementUser,requireRole} from '../admin-auth';
import {controlNumber,controlSql,ensureTripControl} from '@/app/lib/trip-control';
import {ensureTripAudit,lateActivitySql,parseLateActivities,recordTripAudit} from '@/app/lib/trip-audit';
import {activeTrip,canceledTrip,ensureTripCancellation} from '@/app/lib/trip-cancellation';

export const dynamic='force-dynamic';
const dateOk=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
const today=()=>{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const field=(name:string)=>parts.find(part=>part.type===name)?.value||'';return `${field('year')}-${field('month')}-${field('day')}`};
import {ensureVehicleFuelAssignment,planVehicleFuelTransfer,VehicleTransferError} from '@/app/lib/vehicle-fueling-assignment';
import {tripFuelStateSql,tripFueledSql,tripNotFueledSql} from '@/app/lib/vehicle-fuel-status';
import {restoredLiters} from '@/app/lib/trip-fuel-options';
type TripInput={noFueling?:boolean;plannedLiters?:number|null;paymentStatus?:string;outstandingCents?:number;vehicleId:number;departureDate:string;arrivalDate:string;route:string;totalKm:number;totalValueCents:number;associatedUserIds?:number[];externalDriverNames?:string[];allowConflicts?:boolean;previousTripId?:number|null;previousTripOccurred?:boolean|null;newFuelingIntent?:'request'|'skip'|null;displacedTripId?:number|null;replacementVehicleId?:number|null;replacementPreviousTripId?:number|null;replacementPreviousTripOccurred?:boolean|null};
const rangeConflict=(vehicleId:number,departureDate:string,arrivalDate:string)=>env.DB!.prepare(`SELECT id FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND COALESCE(fuel_canceled_at,'')='' AND COALESCE(departure_date,travel_date)<=? AND COALESCE(arrival_date,travel_date)>=? LIMIT 1`).bind(vehicleId,arrivalDate,departureDate).first();
// Status sempre confere o veículo físico que recebeu o combustível.
const noFuelingForTrip=tripNotFueledSql;
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

async function loggedGET(req:Request){
 try{
  const url=new URL(req.url),vehicleId=Number(url.searchParams.get('vehicleId')),date=url.searchParams.get('date'),from=url.searchParams.get('from'),to=url.searchParams.get('to'),available=url.searchParams.get('available')==='1',extraordinary=url.searchParams.get('extraordinary')==='1',launch=url.searchParams.get('launch')==='1',canceled=url.searchParams.get('canceled')==='1';
  const headers={'Cache-Control':'no-store, max-age=0'};
  await ensureExternalDrivers();await ensureTripControl();await ensureMovementFlags();await ensureTripAudit();await ensureTripCancellation();await ensureVehicleFuelAssignment();
  const compactFields=`id,vehicle_id AS vehicleId,${controlSql('trips')},COALESCE(departure_date,travel_date) AS departureDate,COALESCE(arrival_date,travel_date) AS arrivalDate,route,total_km AS totalKm,COALESCE(total_value_cents,0) AS totalValueCents,COALESCE(no_fueling,0) AS noFueling,planned_liters AS plannedLiters,COALESCE((SELECT GROUP_CONCAT(au.name) FROM trip_users tu JOIN app_users au ON au.id=tu.user_id WHERE tu.trip_id=trips.id AND au.group_name='motorista'),'') AS associatedDriverNames,COALESCE((SELECT GROUP_CONCAT(name,'|') FROM trip_external_drivers WHERE trip_id=trips.id),'') AS externalDriverNames`;
  if(vehicleId&&launch){
   const access=await requireRole(req,'solicitante','autorizador','avisado');
   if(!access.user)return Response.json({error:access.error},{status:403,headers});
   const management=isManagementUser(access.user);
   const scope=management?'':` AND EXISTS (SELECT 1 FROM trip_users mine WHERE mine.trip_id=trips.id AND mine.user_id=?)`;
   const completionScope=management?'1=1':`(${noFuelingForTrip('trips')} OR (COALESCE(departure_date,travel_date)<=date('now','-3 hours') AND COALESCE(arrival_date,travel_date)>=date('now','-3 hours')))`;
   const sql=`SELECT ${compactFields} FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND COALESCE(fuel_canceled_at,'')='' AND COALESCE(no_fueling,0)=0 AND ${completionScope} AND (${management?'1=1':"COALESCE(arrival_date,travel_date)>=date('now','-3 hours') OR EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.trip_id=trips.id AND fr.status='authorized' AND COALESCE(fr.authorized_at,fr.created_at)>=datetime('now','-5 days') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fr.id))"})${scope} ORDER BY COALESCE(departure_date,travel_date) DESC,id DESC`;
   const rows=management?await env.DB!.prepare(sql).bind(vehicleId).all():await env.DB!.prepare(sql).bind(vehicleId,access.user.id).all();
   return Response.json({trips:(rows.results||[]).map((trip:any)=>({...trip,associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}))},{headers});
  }
  if(vehicleId&&from&&to&&dateOk(from)&&dateOk(to)&&to>=from){
   const rows=await env.DB!.prepare(`SELECT ${compactFields} FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND COALESCE(fuel_canceled_at,'')='' AND COALESCE(no_fueling,0)=0 AND COALESCE(arrival_date,travel_date)>=? AND COALESCE(departure_date,travel_date)<=? ORDER BY COALESCE(departure_date,travel_date),id`).bind(vehicleId,from,to).all();
   return Response.json({trips:(rows.results||[]).map((trip:any)=>({...trip,associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}))},{headers});
  }
  if(vehicleId&&date){
   const trip=await env.DB!.prepare(`SELECT ${compactFields} FROM trips WHERE vehicle_id=? AND ${activeTrip('trips')} AND COALESCE(fuel_canceled_at,'')='' AND COALESCE(no_fueling,0)=0 AND COALESCE(departure_date,travel_date)<=? AND COALESCE(arrival_date,travel_date)>=? ORDER BY COALESCE(departure_date,travel_date) DESC LIMIT 1`).bind(vehicleId,date,date).first();
   return Response.json({trip:trip?{...trip,associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}:null},{headers});
  }
  const access=await requireRole(req,'solicitante','autorizador','avisado');
  if(!access.user)return Response.json({error:access.error},{status:403,headers});
  const management=isManagementUser(access.user);
  if(extraordinary&&!management)return Response.json({error:'Somente Adm ou Gerência pode solicitar abastecimento extraordinário.'},{status:403,headers});
  if(canceled){
   if(!management)return Response.json({error:'Apenas Adm ou Gerência pode consultar viagens canceladas.'},{status:403,headers});
   const rows=await env.DB!.prepare(`SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel,${controlSql('t')},COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,t.route,t.total_km AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,COALESCE(t.cancel_reason,'Motivo não informado') AS cancelReason,COALESCE(t.canceled_by_name,'Não informado') AS canceledBy,COALESCE(t.canceled_at,'') AS canceledAt,COALESCE((SELECT GROUP_CONCAT(au.name) FROM trip_users tu JOIN app_users au ON au.id=tu.user_id WHERE tu.trip_id=t.id AND au.group_name='motorista'),'') AS associatedDriverNames,COALESCE((SELECT GROUP_CONCAT(name,'|') FROM trip_external_drivers WHERE trip_id=t.id),'') AS externalDriverNames FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE ${canceledTrip('t')} ORDER BY t.canceled_at DESC,t.id DESC LIMIT 200`).all();
   return Response.json({trips:(rows.results||[]).map((trip:any)=>({...trip,userIds:[],associatedDriverNames:trip.associatedDriverNames?String(trip.associatedDriverNames).split(','):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[]}))},{headers});
  }
  const inProgress=`COALESCE(t.departure_date,t.travel_date)<=date('now','-3 hours') AND COALESCE(t.arrival_date,t.travel_date)>=date('now','-3 hours')`;
  const unusedOpenRequest=`NOT EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.vehicle_id=t.vehicle_id AND fr.status IN ('pending','authorized') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fr.id))`;
  // Pedido extraordinário é um reforço durante a viagem: exige combustível
  // inicial já lançado, viagem em curso e nenhum pedido ainda utilizável.
  const requestedFilter=available?(extraordinary?` WHERE ${activeTrip('t')} AND COALESCE(t.fuel_canceled_at,'')='' AND COALESCE(t.no_fueling,0)=0 AND ${inProgress} AND ${tripFueledSql('t')} AND ${unusedOpenRequest}`:` WHERE ${activeTrip('t')} AND COALESCE(t.fuel_canceled_at,'')='' AND COALESCE(t.no_fueling,0)=0 AND ${management?'1=1':"COALESCE(t.arrival_date,t.travel_date)>=date('now')"} AND ${noFuelingForTrip('t')} AND NOT EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.vehicle_id=t.vehicle_id AND fr.status IN ('pending','authorized'))`):'';
  const fields=`t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel,${controlSql('t')},COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,t.route,t.total_km AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,COALESCE(t.no_fueling,0) AS noFueling,COALESCE(t.planned_liters,(SELECT fr.liters FROM fuel_requests fr WHERE fr.vehicle_id=t.vehicle_id AND fr.status IN ('pending','authorized') ORDER BY fr.id DESC LIMIT 1)) AS plannedLiters,COALESCE((SELECT fr.payment_status FROM fuel_requests fr WHERE fr.vehicle_id=t.vehicle_id AND fr.status IN ('pending','authorized') ORDER BY fr.id DESC LIMIT 1),t.payment_status,'nao_pago') AS paymentStatus,COALESCE((SELECT fr.outstanding_cents FROM fuel_requests fr WHERE fr.vehicle_id=t.vehicle_id AND fr.status IN ('pending','authorized') ORDER BY fr.id DESC LIMIT 1),t.outstanding_cents,t.total_value_cents,0) AS outstandingCents,t.fuel_canceled_at AS fuelCanceledAt,t.fuel_canceled_by_name AS fuelCanceledBy,t.fuel_cancel_reason AS fuelCancelReason,CASE WHEN COALESCE(t.no_fueling,0)=1 THEN 'not_required' WHEN COALESCE(t.fuel_canceled_at,'')<>'' THEN 'missing' WHEN ${tripFuelStateSql('t')}='fueled' THEN 'fueled' WHEN ${tripFuelStateSql('t')}='requested' THEN 'pending' WHEN ${tripFuelStateSql('t')}='authorized' THEN 'authorized' ELSE 'missing' END AS requestStatus,CASE WHEN EXISTS (SELECT 1 FROM trip_audit late_audit WHERE late_audit.trip_id=t.id AND late_audit.retroactive=1) THEN 1 ELSE 0 END AS hasLateActivity,${lateActivitySql('t')},COALESCE((SELECT GROUP_CONCAT(name,'|') FROM trip_external_drivers WHERE trip_id=t.id),'') AS externalDriverNames`;
  const sql=management?`SELECT ${fields},COALESCE(GROUP_CONCAT(tu.user_id), '') AS userIds FROM trips t JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN trip_users tu ON tu.trip_id=t.id${requestedFilter||` WHERE ${activeTrip('t')}`} GROUP BY t.id ORDER BY t.id DESC LIMIT 100`:`SELECT ${fields},COALESCE(GROUP_CONCAT(tu2.user_id), '') AS userIds FROM trips t JOIN vehicles v ON v.id=t.vehicle_id JOIN trip_users mine ON mine.trip_id=t.id AND mine.user_id=? LEFT JOIN trip_users tu2 ON tu2.trip_id=t.id${available?` WHERE ${activeTrip('t')} AND COALESCE(t.fuel_canceled_at,'')='' AND COALESCE(t.no_fueling,0)=0 AND COALESCE(t.arrival_date,t.travel_date)>=date('now') AND ${noFuelingForTrip('t')} AND NOT EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.vehicle_id=t.vehicle_id AND fr.status IN ('pending','authorized'))`:` WHERE ${activeTrip('t')}`} GROUP BY t.id ORDER BY t.id DESC LIMIT 100`;
  const trips=management?await env.DB!.prepare(sql).all():await env.DB!.prepare(sql).bind(access.user.id).all();
  return Response.json({trips:(trips.results||[]).map((trip:any)=>({...trip,userIds:trip.userIds?String(trip.userIds).split(',').map(Number):[],externalDriverNames:trip.externalDriverNames?String(trip.externalDriverNames).split('|'):[],lateActivities:parseLateActivities(trip.lateActivities)}))},{headers});
 }catch(error){
  // A lista de viagens é a base dos históricos e das telas de abastecimento.
  // Mantemos a mensagem segura para o usuário e registramos o detalhe técnico
  // no log do Adm, caso uma futura migração de banco volte a falhar.
  const detail=error instanceof Error?error.message:'Erro desconhecido ao consultar viagens.';
  console.error('Falha em /api/trips:',error);
  return Response.json({error:'Não foi possível consultar as viagens.',logDetails:detail},{status:503,headers:{'Cache-Control':'no-store, max-age=0'}})
 }
}

async function loggedPOST(req:Request){
 const session=await getSession(req);
 if(!isManagementUser(session)||session?.passwordChangeRequired)return Response.json({error:'Apenas usuários dos grupos Adm ou Gerência podem lançar viagens.'},{status:403});
 let createdTripId:number|null=null;
 try{
  await ensureExternalDrivers();await ensureTripControl();await ensureTripCancellation();await ensureVehicleFuelAssignment();
  const input=await req.json() as TripInput;
  if(!valid(input))return Response.json({error:'Confira veículo, datas, quilometragem, valor total, roteiro e até três motoristas.'},{status:400});
  if(input.noFueling!==undefined&&typeof input.noFueling!=='boolean')return Response.json({error:'Informe se a viagem terá abastecimento.'},{status:400});
  if(input.previousTripOccurred===true&&input.newFuelingIntent!=='request'&&input.newFuelingIntent!=='skip')return Response.json({error:'Informe se haverá novo abastecimento após a viagem anterior realizada.'},{status:400});
  const hasDisplacement=Number.isSafeInteger(input.displacedTripId)&&Number.isSafeInteger(input.replacementVehicleId);
  if((input.displacedTripId!==undefined||input.replacementVehicleId!==undefined)&&!hasDisplacement)return Response.json({error:'Para usar o carro somente nesta viagem, informe também o carro substituto da viagem anterior.'},{status:400});
  const planned=restoredLiters(input.plannedLiters,null);
  if(planned===undefined)return Response.json({error:'Informe litros válidos.'},{status:400});
  const payment=input.paymentStatus||'nao_pago',outstanding=payment==='total'?0:payment==='nao_pago'?input.totalValueCents:input.outstandingCents;
  if(!['total','parcial','nao_pago'].includes(payment)||!Number.isSafeInteger(outstanding)||(payment==='parcial'&&(outstanding!<=0||outstanding!>=input.totalValueCents)))return Response.json({error:'Confira o pagamento e o valor em aberto.'},{status:400});
  const selected=[...new Set(input.associatedUserIds||[])],guests=externalNames(input);
  const [vehicleBusy,driverBusy]=await Promise.all([rangeConflict(input.vehicleId,input.departureDate,input.arrivalDate),driverConflict(selected,input.departureDate,input.arrivalDate)]);
  let displaced:{id:number;vehicleId:number;departureDate:string;arrivalDate:string;noFueling:number}|null=null;
  if(hasDisplacement){
   if(Number(input.replacementVehicleId)===input.vehicleId)return Response.json({error:'Escolha outro carro para substituir a viagem anterior.'},{status:400});
   displaced=await env.DB!.prepare(`SELECT id,vehicle_id AS vehicleId,COALESCE(departure_date,travel_date) AS departureDate,COALESCE(arrival_date,travel_date) AS arrivalDate,COALESCE(no_fueling,0) AS noFueling FROM trips WHERE id=? AND vehicle_id=? AND ${activeTrip('trips')}`).bind(input.displacedTripId,input.vehicleId).first<{id:number;vehicleId:number;departureDate:string;arrivalDate:string;noFueling:number}>();
   if(!displaced)return Response.json({error:'A viagem que cederá o carro não foi encontrada ou já foi alterada. Atualize a tela e tente novamente.'},{status:409});
   if(displaced.departureDate>input.arrivalDate||displaced.arrivalDate<input.departureDate)return Response.json({error:'A viagem que cederá o carro não ocorre no mesmo período desta nova viagem.'},{status:409});
   const replacementBusy=await env.DB!.prepare(`SELECT id FROM trips WHERE vehicle_id=? AND id<>? AND ${activeTrip('trips')} AND COALESCE(departure_date,travel_date)<=? AND COALESCE(arrival_date,travel_date)>=? LIMIT 1`).bind(input.replacementVehicleId,displaced.id,displaced.arrivalDate,displaced.departureDate).first();
   if(replacementBusy)return Response.json({error:'O carro substituto já possui viagem no período da viagem anterior. Escolha outro carro.'},{status:409});
  }
  // A troca declarada resolve somente o conflito do veículo. Conflito de motorista
  // continua exigindo confirmação explícita no cadastro.
  if(((!hasDisplacement&&vehicleBusy)||driverBusy)&&!input.allowConflicts)return Response.json({error:'Já existe viagem para este carro ou motorista no período. Confirme a compatibilidade de horário antes de salvar.',conflicts:{vehicle:!!vehicleBusy,driver:driverBusy}},{status:409});
  const noFueling=input.previousTripOccurred===true&&input.newFuelingIntent==='skip'?1:input.noFueling?1:0;
  const trip=await env.DB!.prepare('INSERT INTO trips (vehicle_id,travel_date,departure_date,arrival_date,route,total_km,total_value_cents,no_fueling,planned_liters,payment_status,outstanding_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id,vehicle_id AS vehicleId,departure_date AS departureDate,arrival_date AS arrivalDate,route,total_km AS totalKm,total_value_cents AS totalValueCents').bind(input.vehicleId,input.departureDate,input.departureDate,input.arrivalDate,input.route.trim(),input.totalKm,input.totalValueCents,noFueling,planned,payment,outstanding).first<{id:number}>();
  createdTripId=trip?.id??null;
  if(trip){const number=controlNumber(trip.id);await env.DB!.prepare('UPDATE trips SET control_number=? WHERE id=?').bind(number,trip.id).run();(trip as any).controlNumber=number}
  const automatic=await env.DB!.prepare("SELECT id FROM app_users WHERE active=1 AND group_name IN ('adm','gerencia')").all<{id:number}>();
  const userIds=[...new Set([...selected,...automatic.results.map(user=>user.id)])];
  let receivedFuelingId:number|null=null,replacementReceivedFuelingId:number|null=null;
  if(trip){
   const transfer=await planVehicleFuelTransfer({tripId:trip.id,previousVehicleId:-1,vehicleId:input.vehicleId,previousDepartureDate:input.departureDate,departureDate:input.departureDate,actorName:session.name,noFueling:!!noFueling,previousTripId:input.previousTripId,previousTripOccurred:input.previousTripOccurred,newFuelingIntent:input.newFuelingIntent});
   receivedFuelingId=transfer.receivedFuelingId;
   const replacementTransfer=displaced?await planVehicleFuelTransfer({tripId:displaced.id,previousVehicleId:input.vehicleId,vehicleId:Number(input.replacementVehicleId),previousDepartureDate:displaced.departureDate,departureDate:displaced.departureDate,actorName:session.name,noFueling:!!displaced.noFueling,previousTripId:input.replacementPreviousTripId,previousTripOccurred:input.replacementPreviousTripOccurred,newFuelingIntent:'request'}):null;
   replacementReceivedFuelingId=replacementTransfer?.receivedFuelingId||null;
   await env.DB!.batch([...(displaced?[env.DB!.prepare('UPDATE trips SET vehicle_id=? WHERE id=?').bind(input.replacementVehicleId,displaced.id)]:[]),...userIds.map(userId=>env.DB!.prepare('INSERT OR IGNORE INTO trip_users (trip_id,user_id) VALUES (?,?)').bind(trip.id,userId)),...guests.map(name=>env.DB!.prepare('INSERT OR IGNORE INTO trip_external_drivers (trip_id,name) VALUES (?,?)').bind(trip.id,name)),...transfer.statements,...(replacementTransfer?.statements||[])]);
  }
  if(trip&&input.departureDate<today()){
   // A auditoria é complementar: a viagem já foi salva e não pode receber
   // uma mensagem de erro por causa dela.
   try{await ensureTripAudit();await recordTripAudit({tripId:trip.id,action:'viagem_cadastrada',actorName:session.name,effectiveAt:input.departureDate+'T12:00:00.000Z',registeredAt:new Date().toISOString(),retroactive:true})}catch{}
  }
  return Response.json({trip,receivedFuelingId,displacedTripUpdated:!!displaced,replacementReceivedFuelingId});
 }catch(error){
  // O plano de abastecimento é validado depois de gerar o ID da nova viagem.
  // Se alguma validação impedir a troca, não deixamos um cadastro incompleto.
  if(createdTripId!==null)try{await env.DB!.prepare('DELETE FROM trips WHERE id=?').bind(createdTripId).run()}catch{}
  if(error instanceof VehicleTransferError)return Response.json({error:error.message},{status:409});
  return Response.json({error:'Não foi possível salvar a viagem.'},{status:503});
 }
}

export const GET=withSystemLog(loggedGET);
export const POST=withSystemLog(loggedPOST);
