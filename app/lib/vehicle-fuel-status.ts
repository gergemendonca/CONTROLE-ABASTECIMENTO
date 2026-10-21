import {env} from 'cloudflare:workers';

/**
 * O estado operacional do combustível pertence ao CARRO, nunca à viagem.
 * A viagem apenas consulta o carro que está designado a ela naquele momento.
 */
export type VehicleFuelState='red'|'requested'|'authorized'|'fueled';

export async function ensureVehicleFuelStatus(){
 const requestColumns=await env.DB!.prepare('PRAGMA table_info(fuel_requests)').all<{name:string}>();
 if(!requestColumns.results.some(column=>column.name==='vehicle_id')){
  await env.DB!.prepare('ALTER TABLE fuel_requests ADD COLUMN vehicle_id integer').run();
  // Preserva pedidos antigos, registrando o carro que estava na viagem quando
  // eles foram criados. A partir daqui o pedido acompanha esse carro.
  await env.DB!.prepare('UPDATE fuel_requests SET vehicle_id=(SELECT vehicle_id FROM trips WHERE trips.id=fuel_requests.trip_id) WHERE vehicle_id IS NULL').run();
 }
 await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS vehicle_fuel_status (
  vehicle_id INTEGER PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('red','requested','authorized','fueled')),
  fueling_id INTEGER,
  request_id INTEGER,
  updated_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
 )`).run();
 // Camada de auditoria complementar: um AB-ID físico pode ser utilizado por
 // uma ou mais viagens, sem duplicar o lançamento nem mudar o histórico.
 await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS fueling_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fueling_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  origin_trip_id INTEGER,
  used_by_trip_id INTEGER NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN ('origin','transferred')),
  recorded_at TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(fueling_id,used_by_trip_id)
 )`).run();
 // Registra os lançamentos antigos somente como origem/uso da própria viagem.
 // Nada é alterado na tabela de abastecimentos existente.
 await env.DB!.prepare(`INSERT OR IGNORE INTO fueling_usage (fueling_id,vehicle_id,origin_trip_id,used_by_trip_id,relationship,recorded_at,actor_name,note)
  SELECT f.id,f.vehicle_id,f.trip_id,f.trip_id,'origin',COALESCE(f.created_at,datetime('now')),'Migração','Vínculo histórico preservado'
  FROM fueling f WHERE f.trip_id IS NOT NULL AND f.liters>0`).run();
 // Histórico de abastecimento não significa combustível disponível para uma
 // NOVA viagem: a viagem anterior pode ter consumido tudo ou parte do tanque.
 // Por segurança, todo carro sem decisão operacional começa em vermelho.
 await env.DB!.prepare(`INSERT INTO vehicle_fuel_status (vehicle_id,state,fueling_id,request_id,updated_at,note)
 SELECT v.id,
  'red',
  NULL,
  NULL,datetime('now'),'Estado inicial por histórico do veículo'
 FROM vehicles v WHERE NOT EXISTS (SELECT 1 FROM vehicle_fuel_status s WHERE s.vehicle_id=v.id)`).run();
 // Corrige estados criados pelas versões anteriores: elas marcavam como verde
 // qualquer carro que tivesse um abastecimento antigo, mesmo após a viagem
 // correspondente ter terminado. O lançamento físico continua no histórico.
 await env.DB!.prepare(`UPDATE vehicle_fuel_status
  SET state='red',fueling_id=NULL,request_id=NULL,updated_at=datetime('now'),note='Histórico anterior não confirma abastecimento de nova viagem'
  WHERE note='Estado inicial por histórico do veículo'
     OR note LIKE 'Confirmação histórica: carro 21000%'`).run();
}

export async function setVehicleFuelState(vehicleId:number,state:VehicleFuelState,input:{fuelingId?:number|null;requestId?:number|null;note?:string}={}){
 await ensureVehicleFuelStatus();
 await env.DB!.prepare(`INSERT INTO vehicle_fuel_status (vehicle_id,state,fueling_id,request_id,updated_at,note)
 VALUES (?,?,?,?,?,?)
 ON CONFLICT(vehicle_id) DO UPDATE SET state=excluded.state,fueling_id=excluded.fueling_id,request_id=excluded.request_id,updated_at=excluded.updated_at,note=excluded.note`)
  .bind(vehicleId,state,input.fuelingId??null,input.requestId??null,new Date().toISOString(),input.note||'').run();
}

// O cartão e as rotinas de cada viagem olham o V-ID. O estado do carro pode
// existir para auditoria, mas não torna outra viagem abastecida por engano.
export const tripFueledSql=(alias='t')=>`(
 EXISTS (SELECT 1 FROM fueling direct_fuel WHERE direct_fuel.trip_id=${alias}.id AND direct_fuel.liters>0)
 OR EXISTS (SELECT 1 FROM fueling_usage usage WHERE usage.used_by_trip_id=${alias}.id)
 OR EXISTS (SELECT 1 FROM fueling_status_confirmations confirmed WHERE confirmed.trip_id=${alias}.id AND confirmed.vehicle_id=${alias}.vehicle_id)
)`;
export const tripFuelStateSql=(alias='t')=>`CASE
 WHEN ${tripFueledSql(alias)} THEN 'fueled'
 WHEN EXISTS (SELECT 1 FROM fuel_requests request_for_trip WHERE request_for_trip.trip_id=${alias}.id AND request_for_trip.status='authorized') THEN 'authorized'
 WHEN EXISTS (SELECT 1 FROM fuel_requests request_for_trip WHERE request_for_trip.trip_id=${alias}.id AND request_for_trip.status='pending') THEN 'requested'
 ELSE 'red' END`;
export const tripNotFueledSql=(alias='t')=>`NOT ${tripFueledSql(alias)}`;
