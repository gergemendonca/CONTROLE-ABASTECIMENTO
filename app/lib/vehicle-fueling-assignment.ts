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

async function findLegacyTrip(number:number){
 const columns=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
 const hasControl=columns.results.some(column=>column.name==='control_number');
 const sql=hasControl
  ?"SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=? OR CAST(REPLACE(REPLACE(UPPER(COALESCE(t.control_number,'')),'V',''),'-','') AS INTEGER)=? ORDER BY CASE WHEN CAST(REPLACE(REPLACE(UPPER(COALESCE(t.control_number,'')),'V',''),'-','') AS INTEGER)=? THEN 0 ELSE 1 END,t.id LIMIT 1"
  :'SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=? LIMIT 1';
 return hasControl
  ?env.DB!.prepare(sql).bind(number,number,number).first<LegacyTrip>()
  :env.DB!.prepare(sql).bind(number).first<LegacyTrip>();
}

const isVehicle21000=(label:string)=>/(^|\D)21000(\D|$)/.test(String(label));
const vehicleCode=(label:string)=>String(label).replace(/\D/g,'');

async function confirmLegacyFuelingV109(source:LegacyTrip,target:LegacyTrip,now:string){
 await env.DB!.batch([
  // Esta não é uma solicitação nova nem um abastecimento criado pelo sistema.
  // É a confirmação persistente do abastecimento real já informado para o
  // carro 21000, para que todos os pontos do app usem o mesmo estado.
  env.DB!.prepare("INSERT INTO fueling_status_confirmations (trip_id,vehicle_id,source_trip_id,confirmed_at,reason) VALUES (?,?,?,?,?) ON CONFLICT(trip_id) DO UPDATE SET vehicle_id=excluded.vehicle_id,source_trip_id=excluded.source_trip_id,confirmed_at=excluded.confirmed_at,reason=excluded.reason").bind(target.id,target.vehicleId,source.id,now,'Correção histórica confirmada: carro 21000 abastecido na V101 e realocado para a V109'),
  env.DB!.prepare("UPDATE fuel_requests SET status='canceled' WHERE trip_id=? AND status IN ('pending','authorized') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fuel_requests.id)").bind(target.id),
  env.DB!.prepare("DELETE FROM app_notifications WHERE href IN (SELECT '/autorizacoes?pedido=' || id FROM fuel_requests WHERE trip_id=? AND status='canceled')").bind(target.id)
 ]);
}

/** Executa somente a conciliação legada V101 -> V109 descrita pelo operador. */
export async function repairLegacyFuelingV101ToV109(){
 const [source,target]=await Promise.all([findLegacyTrip(101),findLegacyTrip(109)]);
 if(!source||!target||source.id===target.id||source.vehicleId===target.vehicleId)return {applied:false,reason:'trips_not_ready' as const};
 // Proteção estrita: esta conciliação excepcional só se aplica à V109 quando
 // ela está com o carro 21000, exatamente o caso relatado pelo operador.
 if(!isVehicle21000(target.vehicleLabel))return {applied:false,reason:'target_vehicle_unexpected' as const};
 // A correção precisa ser idempotente. Se o lançamento já estiver na V109,
 // não fazemos nada; se não estiver, procuramos o lançamento físico do 21000
 // em TODAS as formas pelas quais as versões anteriores puderam deixar o
 // histórico da V101. A existência de outro pedido na V109 nunca bloqueia
 // esta conciliação: pedido não é abastecimento físico.
 const targetFuel=await env.DB!.prepare('SELECT id FROM fueling WHERE vehicle_id=? AND trip_id=? ORDER BY created_at ASC,id ASC LIMIT 1').bind(target.vehicleId,target.id).first<{id:number}>();
 if(targetFuel){
  await confirmLegacyFuelingV109(source,target,new Date().toISOString());
  return {applied:false,reason:'target_already_fueled' as const};
 }
 // V133: além do vínculo e da origem, cobre um lançamento legado que guardou
 // somente o pedido da V101. Não escolhemos qualquer abastecimento do 21000:
 // a origem V101 continua obrigatória, portanto o abastecimento do 31000 na
 // V101 permanece completamente fora desta operação.
 // V133 ainda exigia o mesmo ID interno do veículo. Se o cadastro do carro
 // 21000 foi recriado, o rótulo continua 21000, mas o ID muda. Neste caso
 // escolhemos apenas o lançamento originado na V101 e pertencente ao mesmo
 // carro identificado pelo rótulo; jamais o abastecimento do 31000.
 const candidates=await env.DB!.prepare(`SELECT f.id,f.vehicle_id AS vehicleId,v.label AS vehicleLabel FROM fueling f JOIN vehicles v ON v.id=f.vehicle_id WHERE (
  f.trip_id=? OR f.original_trip_id=? OR EXISTS (
   SELECT 1 FROM fuel_requests fr WHERE fr.id=f.fuel_request_id AND fr.trip_id=?
  )
 ) ORDER BY CASE WHEN f.trip_id=? THEN 0 WHEN f.original_trip_id=? THEN 1 ELSE 2 END,f.created_at ASC,f.id ASC LIMIT 20`).bind(source.id,source.id,source.id,source.id,source.id).all<{id:number;vehicleId:number;vehicleLabel:string}>();
 const targetCode=vehicleCode(target.vehicleLabel);
 const fuel=(candidates.results||[]).find(item=>item.vehicleId===target.vehicleId||vehicleCode(item.vehicleLabel)===targetCode);
 const now=new Date().toISOString();
 if(fuel){
  await env.DB!.batch([
   env.DB!.prepare(`UPDATE fueling SET
    vehicle_id=?,original_trip_id=COALESCE(original_trip_id,trip_id,(SELECT fr.trip_id FROM fuel_requests fr WHERE fr.id=fuel_request_id)),
    trip_id=?
    WHERE id=?`).bind(target.vehicleId,target.id,fuel.id),
   env.DB!.prepare('INSERT INTO fueling_reassignments (fueling_id,vehicle_id,from_trip_id,to_trip_id,actor_name,changed_at,reason) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM fueling_reassignments WHERE fueling_id=? AND to_trip_id=? AND reason LIKE \'Correção legada V101 para V109%\')').bind(fuel.id,target.vehicleId,source.id,target.id,'Atualização do sistema',now,'Correção legada V101 para V109: o abastecimento acompanha o veículo 21000',fuel.id,target.id)
  ]);
 }
 // Mesmo se o vínculo técnico antigo não for localizável, a confirmação abaixo
 // registra o fato operacional informado e é lida por todas as regras de
 // status, solicitação, autorização e edição da viagem.
 await confirmLegacyFuelingV109(source,target,now);
 return {applied:true,fuelingId:fuel?.id??null,confirmedWithoutLegacyLink:!fuel};
}

// A ligação por pedido só é usada para lançamentos LEGADOS que não tinham trip_id;
// um combustível destacado por troca de carro NÃO deve marcar a antiga viagem.
export const tripFueledSql=(alias='t')=>`(EXISTS (
 SELECT 1 FROM fueling_status_confirmations confirmed
 WHERE confirmed.trip_id=${alias}.id AND confirmed.vehicle_id=${alias}.vehicle_id
) OR EXISTS (
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
