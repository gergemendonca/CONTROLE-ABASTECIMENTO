import {env} from 'cloudflare:workers';
export async function ensureVehicleConsumption(){
 const columns=await env.DB!.prepare('PRAGMA table_info(vehicles)').all<{name:string}>();
 if(!columns.results.some(c=>c.name==='consumption_km_l')){
  try{await env.DB!.prepare('ALTER TABLE vehicles ADD COLUMN consumption_km_l real').run();}
  catch(error){const current=await env.DB!.prepare('PRAGMA table_info(vehicles)').all<{name:string}>();if(!current.results.some(c=>c.name==='consumption_km_l'))throw error;}
 }
}
export async function ensureTripEnergy(){
 await ensureVehicleConsumption();
 await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS trip_energy (
 trip_id integer PRIMARY KEY NOT NULL REFERENCES trips(id),start_km integer NOT NULL,end_km integer NOT NULL,
 start_liters real NOT NULL,consumption_km_l real NOT NULL,updated_by_name text NOT NULL,updated_at text NOT NULL)`).run();
}
