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
 // Cria um estado inicial somente para carros sem estado. O último lançamento
 // físico é do veículo e pode atender mais de uma viagem.
 await env.DB!.prepare(`INSERT INTO vehicle_fuel_status (vehicle_id,state,fueling_id,request_id,updated_at,note)
 SELECT v.id,
  CASE WHEN EXISTS (SELECT 1 FROM fueling f WHERE f.vehicle_id=v.id AND f.liters>0) THEN 'fueled' ELSE 'red' END,
  (SELECT f.id FROM fueling f WHERE f.vehicle_id=v.id AND f.liters>0 ORDER BY f.created_at DESC,f.id DESC LIMIT 1),
  NULL,datetime('now'),'Estado inicial por histórico do veículo'
 FROM vehicles v WHERE NOT EXISTS (SELECT 1 FROM vehicle_fuel_status s WHERE s.vehicle_id=v.id)`).run();
}

export async function setVehicleFuelState(vehicleId:number,state:VehicleFuelState,input:{fuelingId?:number|null;requestId?:number|null;note?:string}={}){
 await ensureVehicleFuelStatus();
 await env.DB!.prepare(`INSERT INTO vehicle_fuel_status (vehicle_id,state,fueling_id,request_id,updated_at,note)
 VALUES (?,?,?,?,?,?)
 ON CONFLICT(vehicle_id) DO UPDATE SET state=excluded.state,fueling_id=excluded.fueling_id,request_id=excluded.request_id,updated_at=excluded.updated_at,note=excluded.note`)
  .bind(vehicleId,state,input.fuelingId??null,input.requestId??null,new Date().toISOString(),input.note||'').run();
}

export const tripFuelStateSql=(alias='t')=>`COALESCE((SELECT state FROM vehicle_fuel_status fuel_state WHERE fuel_state.vehicle_id=${alias}.vehicle_id),'red')`;
export const tripFueledSql=(alias='t')=>`${tripFuelStateSql(alias)}='fueled'`;
export const tripNotFueledSql=(alias='t')=>`${tripFuelStateSql(alias)}<>'fueled'`;
