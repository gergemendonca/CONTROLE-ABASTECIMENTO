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
 // Correção pontual de histórico: antes do vínculo por veículo, o 21000 foi
 // abastecido na V101 e depois realocado para a V109. O abastecimento físico
 // precisa aparecer na V109, sem tocar no abastecimento posterior do carro da
 // V101 (31000).
 await repairLegacyFuelingV101ToV109();
}

type LegacyTrip={id:number;vehicleId:number};

async function findLegacyTrip(number:number){
 const columns=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
 const hasControl=columns.results.some(column=>column.name==='control_number');
 const sql=hasControl
  ?"SELECT id,vehicle_id AS vehicleId FROM trips WHERE id=? OR CAST(REPLACE(REPLACE(UPPER(COALESCE(control_number,'')),'V',''),'-','') AS INTEGER)=? ORDER BY CASE WHEN CAST(REPLACE(REPLACE(UPPER(COALESCE(control_number,'')),'V',''),'-','') AS INTEGER)=? THEN 0 ELSE 1 END,id LIMIT 1"
  :'SELECT id,vehicle_id AS vehicleId FROM trips WHERE id=? LIMIT 1';
 return hasControl
  ?env.DB!.prepare(sql).bind(number,number,number).first<LegacyTrip>()
  :env.DB!.prepare(sql).bind(number).first<LegacyTrip>();
}

/** Executa somente a conciliação legada V101 -> V109 descrita pelo operador. */
export async function repairLegacyFuelingV101ToV109(){
 const [source,target]=await Promise.all([findLegacyTrip(101),findLegacyTrip(109)]);
 if(!source||!target||source.id===target.id||source.vehicleId===target.vehicleId)return {applied:false,reason:'trips_not_ready' as const};
 // O status da viagem considera o carro atual. Se já houver um lançamento
 // fisicamente vinculado à V109, ela já aparece como abastecida e não há nada
 // histórico a conciliar.
 const targetAlreadyFueled=await env.DB!.prepare('SELECT id FROM fueling WHERE vehicle_id=? AND trip_id=? LIMIT 1').bind(target.vehicleId,target.id).first();
 if(targetAlreadyFueled)return {applied:false,reason:'target_already_fueled' as const};
 // A correção anterior aceitava somente original_trip_id vazio. Isso falhava
 // justamente quando uma tentativa anterior já havia registrado a origem da
 // V101, mas ainda não tinha atualizado o vínculo operacional para a V109.
 // Aceitamos explicitamente as três formas históricas do mesmo abastecimento:
 // vínculo direto à V101, origem registrada como V101 ou pedido da V101.
 const fuel=await env.DB!.prepare(`SELECT f.id FROM fueling f WHERE f.vehicle_id=? AND (
  f.trip_id=? OR f.original_trip_id=? OR EXISTS (
   SELECT 1 FROM fuel_requests fr WHERE fr.id=f.fuel_request_id AND fr.trip_id=?
  )
 ) ORDER BY CASE WHEN f.trip_id=? THEN 0 WHEN f.original_trip_id=? THEN 1 ELSE 2 END,f.created_at ASC,f.id ASC LIMIT 1`).bind(target.vehicleId,source.id,source.id,source.id,source.id,source.id).first<{id:number}>();
 if(!fuel)return {applied:false,reason:'legacy_fueling_not_found' as const};
 const now=new Date().toISOString();
 await env.DB!.batch([
  env.DB!.prepare(`UPDATE fueling SET
   original_trip_id=COALESCE(original_trip_id,trip_id,(SELECT fr.trip_id FROM fuel_requests fr WHERE fr.id=fuel_request_id)),
   trip_id=?
   WHERE id=? AND vehicle_id=?`).bind(target.id,fuel.id,target.vehicleId),
  // Pedido sem abastecimento físico é da viagem; porém um pedido antigo ainda
  // aberto na V109 deixa de ser necessário quando o carro 21000 chega já
  // abastecido. Cancelamos somente esse pedido não utilizado, sem tocar em
  // pedidos/abastecimentos efetivamente realizados.
  env.DB!.prepare("UPDATE fuel_requests SET status='canceled' WHERE trip_id=? AND status IN ('pending','authorized') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fuel_requests.id)").bind(target.id),
  env.DB!.prepare("DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status='canceled')").bind(target.id),
  env.DB!.prepare('INSERT INTO fueling_reassignments (fueling_id,vehicle_id,from_trip_id,to_trip_id,actor_name,changed_at,reason) VALUES (?,?,?,?,?,?,?)').bind(fuel.id,target.vehicleId,source.id,target.id,'Atualização do sistema',now,'Correção legada V101 para V109: o abastecimento acompanha o veículo 21000')
 ]);
 return {applied:true,fuelingId:fuel.id};
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
 // Pedido não é combustível: se ainda não houve abastecimento físico, ele
 // permanece na viagem e passa a servir ao carro substituto. Somente o pedido
 // já consumido pelo carro que saiu é destacado para o histórico.
 result.statements.push(env.DB!.prepare(`UPDATE fuel_requests SET status='reassigned'
  WHERE trip_id=? AND status='authorized' AND EXISTS (
   SELECT 1 FROM fueling f WHERE f.fuel_request_id=fuel_requests.id AND f.vehicle_id=? AND (
    f.trip_id=? OR (f.trip_id IS NULL AND f.original_trip_id IS NULL)
   )
  )`).bind(change.tripId,change.previousVehicleId,change.tripId));
 result.statements.push(env.DB!.prepare(`DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status='reassigned')`).bind(change.tripId));
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
  // Se o carro substituto já trouxe combustível válido, um pedido ainda aberto
  // nesta viagem não deve gerar segundo abastecimento.
  result.statements.push(env.DB!.prepare("UPDATE fuel_requests SET status='canceled' WHERE trip_id=? AND status IN ('pending','authorized') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fuel_requests.id)").bind(change.tripId));
  result.statements.push(env.DB!.prepare("DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status='canceled')").bind(change.tripId));
 }
 return result;
}
