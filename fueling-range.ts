import {env} from 'cloudflare:workers';
export const minimumKmPerLiter=2.3;
export async function ensureEarlyFuelingNote(){
 const columns=await env.DB!.prepare('PRAGMA table_info(fueling)').all<{name:string}>();
 if(!columns.results.some(column=>column.name==='early_note'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN early_note text').run();
}
export function fuelingRange(previous:{odometer:number;liters:number}){
 const distance=Number(previous.liters)*minimumKmPerLiter;
 return {previousOdometer:Number(previous.odometer),previousLiters:Number(previous.liters),minimumDistance:distance,minimumOdometer:Number(previous.odometer)+Math.ceil(distance-1e-9)};
}
export async function additionalFuelingRange(tripId:number,vehicleId:number,excludeId=0){
 const previous=await env.DB!.prepare('SELECT odometer,liters FROM fueling WHERE trip_id=? AND vehicle_id=? AND liters>0 AND id<>? ORDER BY odometer DESC,id DESC LIMIT 1').bind(tripId,vehicleId,excludeId).first<{odometer:number;liters:number}>();
 return previous?fuelingRange(previous):null;
}
export function fuelingRangeMessage(range:ReturnType<typeof fuelingRange>,odometer:number){
 const n=(value:number)=>value.toLocaleString('pt-BR',{maximumFractionDigits:2});
 return `Abastecimento antecipado: o anterior registrou ${n(range.previousLiters)} litros em ${n(range.previousOdometer)} km. Desde então foram percorridos ${n(odometer-range.previousOdometer)} km. A referência de 2,3 km/L seria ${n(range.minimumDistance)} km. Isso não mede o consumo real nem exige esvaziar o tanque. Para continuar, informe o motivo.`;
}
export function earlyFuelingReason(input:unknown){const reason=typeof input==='string'?input.trim():'';return reason.length>=5&&reason.length<=500?reason:null;}
