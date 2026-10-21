import {env} from 'cloudflare:workers';
import {ensureVehicleFuelStatus,setVehicleFuelState} from './vehicle-fuel-status';

/**
 * v125: o abastecimento físico pertence ao veículo. O vínculo com a viagem é
 * uma alocação operacional que pode mudar ANTES de a viagem começar.
 *
 * original_trip_id registra a primeira viagem sem alterar o veículo, hodômetro,
 * valores ou a autorização original. Os registros não são excluídos.
 */
export async function ensureVehicleFuelAssignment(){
 await ensureVehicleFuelStatus();
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
 // Confirmações históricas são usadas somente quando um abastecimento físico
 // antigo é conhecido, mas não pode mais ser recuperado pelo ID técnico do
 // veículo (por exemplo, após recriação do cadastro do mesmo carro).
 await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS fueling_status_confirmations (
  trip_id INTEGER PRIMARY KEY NOT NULL,
  vehicle_id INTEGER NOT NULL,
  source_trip_id INTEGER,
  confirmed_at TEXT NOT NULL,
  reason TEXT NOT NULL
 )`).run();
 // Correção pontual de histórico: antes do vínculo por veículo, o 21000 foi
 // abastecido na V101 e depois realocado para a V109. O abastecimento físico
 // precisa aparecer na V109, sem tocar no abastecimento posterior do carro da
 // V101 (31000).
 await repairLegacyFuelingV101ToV109();
}

type LegacyTrip={id:number;vehicleId:number;vehicleLabel:string};

/**
 * Localiza uma viagem de legado pelo número operacional. Aceita V109,
 * V-000109, V 109 e registros antigos sem a coluna control_number.
 */
async function findLegacyTrip(number:number){
 const columns=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
 const hasControl=columns.results.some(column=>column.name==='control_number');
 const normalized="CAST(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(t.control_number,''))),'V',''),'-',''),' ',''),'.','') AS INTEGER)";
 const sql=hasControl
  ?`SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=? OR ${normalized}=? ORDER BY CASE WHEN ${normalized}=? THEN 0 ELSE 1 END,t.id LIMIT 1`
  :'SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=? LIMIT 1';
 return hasControl
  ?env.DB!.prepare(sql).bind(number,number,number).first<LegacyTrip>()
  :env.DB!.prepare(sql).bind(number).first<LegacyTrip>();
}

const vehicleCode=(label:string)=>String(label).replace(/\D/g,'');

async function confirmLegacyFuelingV109(source:LegacyTrip|null,target:LegacyTrip,now:string){
 await env.DB!.batch([
  // Esta não é uma solicitação nova nem um abastecimento criado pelo sistema.
  // É a confirmação persistente do abastecimento real já informado para o
  // carro 21000, para que todos os pontos do app usem o mesmo estado.
  env.DB!.prepare("INSERT INTO fueling_status_confirmations (trip_id,vehicle_id,source_trip_id,confirmed_at,reason) VALUES (?,?,?,?,?) ON CONFLICT(trip_id) DO UPDATE SET vehicle_id=excluded.vehicle_id,source_trip_id=excluded.source_trip_id,confirmed_at=excluded.confirmed_at,reason=excluded.reason").bind(target.id,target.vehicleId,source?.id??null,now,'Correção histórica confirmada: carro 21000 abastecido na V101 e realocado para a V109'),
  env.DB!.prepare("UPDATE fuel_requests SET status='canceled' WHERE trip_id=? AND status IN ('pending','authorized') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fuel_requests.id)").bind(target.id),
  env.DB!.prepare("DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status='canceled')").bind(target.id)
 ]);
}

/**
 * Repara exclusivamente o status operacional informado para a V109.
 *
 * Não tentamos mais movimentar o lançamento antigo da V101. Aquela tentativa
 * dependia de colunas e vínculos que podem não existir em bases antigas e,
 * quando falhava, derrubava a consulta de TODAS as viagens. O fato que precisa
 * ser preservado é simples e auditável: o carro 21000 que está na V109 já saiu
 * abastecido. A confirmação é suficiente para todos os status do sistema e
 * não altera a V101 nem qualquer lançamento do 31000.
 */
export async function repairLegacyFuelingV101ToV109(){
 const target=await findLegacyTrip(109);
 if(!target)return {applied:false,reason:'target_not_found' as const};
 // A exceção é exclusivamente para o 21000. Se futuramente a V109 receber
 // outro carro, removemos a confirmação para ela não ser carregada adiante.
 if(vehicleCode(target.vehicleLabel)!=='21000'){
  await env.DB!.prepare('DELETE FROM fueling_status_confirmations WHERE trip_id=?').bind(target.id).run();
  return {applied:false,reason:'target_vehicle_changed' as const};
 }
 await confirmLegacyFuelingV109(null,target,new Date().toISOString());
 await setVehicleFuelState(target.vehicleId,'fueled',{note:'Confirmação histórica: carro 21000 já abastecido ao atender a V109'});
 return {applied:true,confirmedWithoutLegacyLink:true};
}

// A ligação por pedido só é usada para lançamentos LEGADOS que não tinham trip_id;
// um combustível destacado por troca de carro NÃO deve marcar a antiga viagem.
export class VehicleTransferError extends Error {}
export type TransferPlan={statements:any[];vehicleChanged:boolean;releasedFuelingId:number|null;receivedFuelingId:number|null};
export type PreviousTripDecision={previousTripId?:number|null;previousTripOccurred?:boolean|null;newFuelingIntent?:'request'|'skip'|null};
type Change={tripId:number;previousVehicleId:number;vehicleId:number;previousDepartureDate:string;departureDate:string;actorName:string;noFueling?:boolean}&PreviousTripDecision;

/** Monta a operação para executar junto com a edição da viagem em DB.batch. */
export async function planVehicleFuelTransfer(change:Change):Promise<TransferPlan>{
 const result:TransferPlan={statements:[],vehicleChanged:change.previousVehicleId!==change.vehicleId,releasedFuelingId:null,receivedFuelingId:null};
 if(!result.vehicleChanged)return result;
 // O combustível e o pedido pertencem ao carro. Trocar o carro da viagem
 // jamais move, cancela ou reescreve lançamentos físicos/pedidos.
 await ensureVehicleFuelStatus();
 return result;
}
