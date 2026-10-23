import {env} from 'cloudflare:workers';

// Códigos curtos para leitura humana. Os IDs técnicos continuam intactos no
// banco; estes códigos não participam de nenhuma regra operacional.
export const publicCode=(prefix:'V'|'CAR'|'AB'|'PD'|'AU',number:number)=>`${prefix}-${String(number).padStart(3,'0')}`;

export async function ensurePublicIds(){
 await env.DB!.batch([
  env.DB!.prepare('CREATE TABLE IF NOT EXISTS vehicle_public_ids (public_number INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL UNIQUE)'),
  env.DB!.prepare('CREATE TABLE IF NOT EXISTS fueling_public_ids (public_number INTEGER PRIMARY KEY AUTOINCREMENT, fueling_id INTEGER NOT NULL UNIQUE)'),
  // Pedido e autorização são eventos distintos. Cada um recebe código próprio,
  // mas continua ligado ao ID técnico do mesmo pedido.
  env.DB!.prepare('CREATE TABLE IF NOT EXISTS fuel_request_public_ids (public_number INTEGER PRIMARY KEY AUTOINCREMENT, fuel_request_id INTEGER NOT NULL UNIQUE)'),
  env.DB!.prepare('CREATE TABLE IF NOT EXISTS fuel_authorization_public_ids (public_number INTEGER PRIMARY KEY AUTOINCREMENT, fuel_request_id INTEGER NOT NULL UNIQUE)'),
  env.DB!.prepare('INSERT OR IGNORE INTO vehicle_public_ids (vehicle_id) SELECT id FROM vehicles ORDER BY id'),
  env.DB!.prepare('INSERT OR IGNORE INTO fueling_public_ids (fueling_id) SELECT id FROM fueling ORDER BY datetime(created_at),id'),
  env.DB!.prepare('INSERT OR IGNORE INTO fuel_request_public_ids (fuel_request_id) SELECT id FROM fuel_requests ORDER BY datetime(created_at),id'),
  env.DB!.prepare("INSERT OR IGNORE INTO fuel_authorization_public_ids (fuel_request_id) SELECT id FROM fuel_requests WHERE status='authorized' ORDER BY datetime(COALESCE(authorized_at,created_at)),id"),
 ]);
}

export const vehicleCodeSql=(vehicleAlias='v')=>`'CAR-' || printf('%03d',COALESCE((SELECT public_number FROM vehicle_public_ids vehicle_code WHERE vehicle_code.vehicle_id=${vehicleAlias}.id),${vehicleAlias}.id))`;
export const vehicleIdCodeSql=(vehicleIdExpression:string)=>`'CAR-' || printf('%03d',COALESCE((SELECT public_number FROM vehicle_public_ids vehicle_code WHERE vehicle_code.vehicle_id=${vehicleIdExpression}),${vehicleIdExpression}))`;
export const fuelingCodeSql=(fuelingAlias='f')=>`'AB-' || printf('%03d',COALESCE((SELECT public_number FROM fueling_public_ids fueling_code WHERE fueling_code.fueling_id=${fuelingAlias}.id),${fuelingAlias}.id))`;
export const requestCodeSql=(requestAlias='fr')=>`'PD-' || printf('%03d',COALESCE((SELECT public_number FROM fuel_request_public_ids request_code WHERE request_code.fuel_request_id=${requestAlias}.id),${requestAlias}.id))`;
export const authorizationCodeSql=(requestAlias='fr')=>`CASE WHEN ${requestAlias}.status='authorized' THEN 'AU-' || printf('%03d',COALESCE((SELECT public_number FROM fuel_authorization_public_ids authorization_code WHERE authorization_code.fuel_request_id=${requestAlias}.id),${requestAlias}.id)) ELSE NULL END`;
