import {env} from 'cloudflare:workers';

/**
 * v125: o abastecimento físico pertence ao veículo. O vínculo com a viagem é
 * uma alocação operacional que pode mudar ANTES de a viagem começar.
 *
 * original_trip_id registra a primeira viagem sem alterar o veículo, hodômetro,
 * valores ou a autorização original. Os registros não são excluídos.
 */
export async function ensureVehicleFuelAssignment(){
 const columns=await env.DB!.prepare('PRAGMA table_info(fueling)').all<{name:string}>();
 if(!columns.results.some(column=>column.name==='original_trip_id')){
  try{await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN original_trip_id integer').run();}
  catch(error){const fresh=await env.DB!.prepare('PRAGMA table_info(fueling)').all<{name:string}>();if(!fresh.results.some(c=>c.name==='original_trip_id'))throw error;}
 }
 await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS fueling_reassignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fueling_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  from_trip_id INTEGER,
  to_trip_id INTEGER,
  actor_name TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  reason TEXT NOT NULL
 )`).run();
}

// A ligação por pedido só é usada para lançamentos LEGADOS que não tinham trip_id;
// um combustível destacado por troca de carro NÃO deve marcar a antiga viagem.
export const tripFueledSql=(alias='t')=>`EXISTS (
 SELECT 1 FROM fueling fuel_done WHERE fuel_done.vehicle_id=${alias}.vehicle_id AND (
  fuel_done.trip_id=${alias}.id OR
  (fuel_done.trip_id IS NULL AND fuel_done.original_trip_id IS NULL AND EXISTS (
   SELECT 1 FROM fuel_requests legacy_fr WHERE legacy_fr.id=fuel_done.fuel_request_id AND legacy_fr.trip_id=${alias}.id
  ))
 ))`;
export const tripNotFueledSql=(alias='t')=>`NOT (${tripFueledSql(alias)})`;

export class VehicleTransferError extends Error {}
export type TransferPlan={statements:any[];vehicleChanged:boolean;releasedFuelingId:number|null;receivedFuelingId:number|null};
type Change={tripId:number;previousVehicleId:number;vehicleId:number;previousDepartureDate:string;departureDate:string;actorName:string;noFueling?:boolean};
const bahiaToday=()=>{
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const get=(k:string)=>p.find(x=>x.type===k)?.value||'';
 return `${get('year')}-${get('month')}-${get('day')}`;
};

/** Monta a operação para executar junto com a edição da viagem em DB.batch. */
export async function planVehicleFuelTransfer(change:Change):Promise<TransferPlan>{
 const result:TransferPlan={statements:[],vehicleChanged:change.previousVehicleId!==change.vehicleId,releasedFuelingId:null,receivedFuelingId:null};
 if(!result.vehicleChanged)return result;
 await ensureVehicleFuelAssignment();
 const now=new Date().toISOString(),today=bahiaToday();
 const linked=await env.DB!.prepare(`SELECT f.id,f.created_at AS createdAt FROM fueling f
 WHERE f.vehicle_id=? AND (f.trip_id=? OR (f.trip_id IS NULL AND f.original_trip_id IS NULL AND EXISTS (
  SELECT 1 FROM fuel_requests fr WHERE fr.id=f.fuel_request_id AND fr.trip_id=?)))
 ORDER BY f.created_at ASC,f.id ASC`).bind(change.previousVehicleId,change.tripId,change.tripId).all<{id:number;createdAt:string}>();
 // Não se remaneja um abastecimento após a saída nem quando houve reabastecimentos.
 // Nessa situação a conciliação é manual, para não adulterar histórico de consumo.
 if(linked.results.length>0&&change.previousDepartureDate<today)
  throw new VehicleTransferError('Esta viagem já começou ou passou e tem combustível lançado. Não é seguro transferir o abastecimento automaticamente. Faça a conciliação com o administrador.');
 if(linked.results.length>1)
  throw new VehicleTransferError('A viagem possui mais de um abastecimento. É necessário conciliar os lançamentos antes de trocar o carro, para preservar os complementares.');
 if(linked.results.length===1){
  const fuel=linked.results[0];
  result.releasedFuelingId=fuel.id;
  // Permite tanto editar primeiro A quanto editar primeiro B.
  const receivers=await env.DB!.prepare(`SELECT t.id FROM trips t
   WHERE t.id<>? AND t.vehicle_id=? AND COALESCE(t.departure_date,t.travel_date)>=?
   AND abs(julianday(COALESCE(t.departure_date,t.travel_date))-julianday(?))<=3
   AND COALESCE(t.canceled_at,'')='' AND COALESCE(t.fuel_canceled_at,'')=''
   AND COALESCE(t.no_fueling,0)=0
   AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.trip_id=t.id AND used.vehicle_id=t.vehicle_id)
   ORDER BY COALESCE(t.departure_date,t.travel_date),t.id LIMIT 2`).bind(change.tripId,change.previousVehicleId,today,change.previousDepartureDate).all<{id:number}>();
  if(receivers.results.length>1)throw new VehicleTransferError('Mais de uma viagem poderia receber o abastecimento deste carro. Confira os destinos antes de salvar.');
  const receiver=receivers.results[0]?.id??null;
  result.statements.push(env.DB!.prepare(`UPDATE fueling SET original_trip_id=COALESCE(original_trip_id,trip_id,(SELECT fr.trip_id FROM fuel_requests fr WHERE fr.id=fuel_request_id)),trip_id=? WHERE id=? AND vehicle_id=? AND (trip_id=? OR (trip_id IS NULL AND original_trip_id IS NULL AND fuel_request_id IN (SELECT id FROM fuel_requests WHERE trip_id=?)))`).bind(receiver,fuel.id,change.previousVehicleId,change.tripId,change.tripId));
  result.statements.push(env.DB!.prepare('INSERT INTO fueling_reassignments (fueling_id,vehicle_id,from_trip_id,to_trip_id,actor_name,changed_at,reason) VALUES (?,?,?,?,?,?,?)').bind(fuel.id,change.previousVehicleId,change.tripId,receiver,change.actorName,now,receiver?'Abastecimento inicial acompanha o veículo':'Disponível para a próxima viagem do veículo'));
  if(receiver){
   result.statements.push(env.DB!.prepare(`UPDATE fuel_requests SET status=CASE WHEN EXISTS (SELECT 1 FROM fueling f WHERE f.fuel_request_id=fuel_requests.id) THEN 'reassigned' ELSE 'canceled' END WHERE trip_id=? AND status IN ('pending','authorized')`).bind(receiver));
   result.statements.push(env.DB!.prepare(`DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status IN ('reassigned','canceled'))`).bind(receiver));
  }
 }
 // Invalida somente pedidos abertos da viagem cujo carro foi alterado.
 // O pedido já utilizado permanece na auditoria com status 'reassigned'.
 result.statements.push(env.DB!.prepare(`UPDATE fuel_requests SET status=CASE WHEN EXISTS (SELECT 1 FROM fueling f WHERE f.fuel_request_id=fuel_requests.id) THEN 'reassigned' ELSE 'canceled' END WHERE trip_id=? AND status IN ('pending','authorized')`).bind(change.tripId));
 // Autorizações antigas não podem reaparecer nas notificações para o carro novo.
 result.statements.push(env.DB!.prepare(`DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status IN ('reassigned','canceled'))`).bind(change.tripId));
 if(change.noFueling||change.departureDate<today)return result;
 // Somente abastecimentos do NOVO veículo, antes associados a outra viagem que
 // perdeu aquele carro. Tolerância de três dias entre as datas das viagens.
 // Esse limite impede reutilizar abastecimentos antigos de outras operações.
 const candidates=await env.DB!.prepare(`SELECT f.id,f.vehicle_id AS vehicleId,f.trip_id AS tripId,COALESCE(f.original_trip_id,f.trip_id,(SELECT r.trip_id FROM fuel_requests r WHERE r.id=f.fuel_request_id)) AS sourceTripId
 FROM fueling f JOIN trips origin ON origin.id=COALESCE(f.original_trip_id,f.trip_id,(SELECT r.trip_id FROM fuel_requests r WHERE r.id=f.fuel_request_id))
 LEFT JOIN trips current_trip ON current_trip.id=f.trip_id
 WHERE f.vehicle_id=?
 AND ((f.trip_id IS NULL AND (f.original_trip_id IS NOT NULL OR origin.vehicle_id<>f.vehicle_id)) OR (current_trip.vehicle_id<>f.vehicle_id AND COALESCE(current_trip.departure_date,current_trip.travel_date)>=?))
 AND abs(julianday(COALESCE(origin.departure_date,origin.travel_date))-julianday(?))<=3
 AND date(f.created_at,'-3 hours')<=?
 AND COALESCE(origin.departure_date,origin.travel_date)>=?
 AND NOT EXISTS (SELECT 1 FROM fueling other WHERE other.id<>f.id AND other.trip_id=COALESCE(f.original_trip_id,f.trip_id,(SELECT r.trip_id FROM fuel_requests r WHERE r.id=f.fuel_request_id)) AND other.vehicle_id=f.vehicle_id)
 ORDER BY f.created_at DESC,f.id DESC LIMIT 2`).bind(change.vehicleId,today,change.departureDate,change.departureDate,today).all<{id:number;vehicleId:number;tripId:number|null;sourceTripId:number}>();
 if(candidates.results.length>1)throw new VehicleTransferError('Existem dois abastecimentos disponíveis para este carro. Verifique os lançamentos antes de continuar, para evitar vinculação duplicada.');
 if(candidates.results.length===1){
  const fuel=candidates.results[0];
  // Mesmo quando se trata de registro legado com trip_id da viagem antiga,
  // preservamos a identificação da viagem original para auditoria.
  result.receivedFuelingId=fuel.id;
  result.statements.push(env.DB!.prepare(`UPDATE fueling SET original_trip_id=COALESCE(original_trip_id,trip_id,(SELECT fr.trip_id FROM fuel_requests fr WHERE fr.id=fuel_request_id)),trip_id=? WHERE id=? AND vehicle_id=? AND (trip_id IS NULL OR trip_id=?)`).bind(change.tripId,fuel.id,change.vehicleId,fuel.tripId));
  result.statements.push(env.DB!.prepare('INSERT INTO fueling_reassignments (fueling_id,vehicle_id,from_trip_id,to_trip_id,actor_name,changed_at,reason) VALUES (?,?,?,?,?,?,?)').bind(fuel.id,change.vehicleId,fuel.tripId,change.tripId,change.actorName,now,'Abastecimento inicial acompanha o veículo'));
  // O pedido original, se existir, continua auditável mas não autoriza outro carro.
  result.statements.push(env.DB!.prepare("UPDATE fuel_requests SET status='reassigned' WHERE id=(SELECT fuel_request_id FROM fueling WHERE id=?) AND status='authorized'").bind(fuel.id));
 }
 return result;
}
