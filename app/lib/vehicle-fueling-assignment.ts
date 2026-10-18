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
export type PreviousTripDecision={previousTripId?:number|null;previousTripOccurred?:boolean|null;newFuelingIntent?:'request'|'skip'|null};
type Change={tripId:number;previousVehicleId:number;vehicleId:number;previousDepartureDate:string;departureDate:string;actorName:string;noFueling?:boolean}&PreviousTripDecision;

/** Monta a operação para executar junto com a edição da viagem em DB.batch. */
export async function planVehicleFuelTransfer(change:Change):Promise<TransferPlan>{
 const result:TransferPlan={statements:[],vehicleChanged:change.previousVehicleId!==change.vehicleId,releasedFuelingId:null,receivedFuelingId:null};
 if(!result.vehicleChanged)return result;
 await ensureVehicleFuelAssignment();
 const now=new Date().toISOString();
 const linked=await env.DB!.prepare(`SELECT f.id,f.created_at AS createdAt FROM fueling f
 WHERE f.vehicle_id=? AND (f.trip_id=? OR (f.trip_id IS NULL AND f.original_trip_id IS NULL AND EXISTS (
  SELECT 1 FROM fuel_requests fr WHERE fr.id=f.fuel_request_id AND fr.trip_id=?)))
 ORDER BY f.created_at ASC,f.id ASC`).bind(change.previousVehicleId,change.tripId,change.tripId).all<{id:number;createdAt:string}>();
 if(linked.results.length>1)
  throw new VehicleTransferError('A viagem possui mais de um abastecimento. É necessário conciliar os lançamentos antes de trocar o carro, para preservar os complementares.');
 if(linked.results.length===1)result.releasedFuelingId=linked.results[0].id;
 // Invalida somente pedidos abertos da viagem cujo carro foi alterado.
 // O pedido já utilizado permanece na auditoria com status 'reassigned'.
 result.statements.push(env.DB!.prepare(`UPDATE fuel_requests SET status=CASE WHEN EXISTS (SELECT 1 FROM fueling f WHERE f.fuel_request_id=fuel_requests.id) THEN 'reassigned' ELSE 'canceled' END WHERE trip_id=? AND status IN ('pending','authorized')`).bind(change.tripId));
 // Autorizações antigas não podem reaparecer nas notificações para o carro novo.
 result.statements.push(env.DB!.prepare(`DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status IN ('reassigned','canceled'))`).bind(change.tripId));
 // Não há prazo automático. O abastecimento só acompanha o carro quando o
 // operador confirma que a viagem anterior não aconteceu.
 if(change.noFueling||change.previousTripOccurred!==false||!Number.isSafeInteger(change.previousTripId))return result;
 const candidates=await env.DB!.prepare(`SELECT f.id,f.trip_id AS tripId FROM fueling f
 WHERE f.vehicle_id=? AND (f.trip_id=? OR
  (f.trip_id IS NULL AND f.original_trip_id IS NULL AND f.fuel_request_id IN (SELECT id FROM fuel_requests WHERE trip_id=?)))
 ORDER BY f.created_at ASC,f.id ASC LIMIT 2`).bind(change.vehicleId,change.previousTripId,change.previousTripId).all<{id:number;tripId:number|null}>();
 if(candidates.results.length>1)throw new VehicleTransferError('A viagem anterior possui mais de um abastecimento. Confira os lançamentos antes de informar que ela não aconteceu.');
 if(candidates.results.length===1){
  const fuel=candidates.results[0];
  result.receivedFuelingId=fuel.id;
  result.statements.push(env.DB!.prepare(`UPDATE fueling SET original_trip_id=COALESCE(original_trip_id,trip_id,(SELECT r.trip_id FROM fuel_requests r WHERE r.id=fuel_request_id)),trip_id=? WHERE id=? AND vehicle_id=?`).bind(change.tripId,fuel.id,change.vehicleId));
  result.statements.push(env.DB!.prepare('INSERT INTO fueling_reassignments (fueling_id,vehicle_id,from_trip_id,to_trip_id,actor_name,changed_at,reason) VALUES (?,?,?,?,?,?,?)').bind(fuel.id,change.vehicleId,change.previousTripId,change.tripId,change.actorName,now,'Viagem anterior não aconteceu; abastecimento acompanha o veículo'));
  result.statements.push(env.DB!.prepare("UPDATE fuel_requests SET status='reassigned' WHERE id=(SELECT fuel_request_id FROM fueling WHERE id=?) AND status='authorized'").bind(fuel.id));
 }
 return result;
}
