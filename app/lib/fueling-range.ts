import {env} from 'cloudflare:workers';
export const minimumKmPerLiter=2.3;
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
 return `Novo abastecimento bloqueado: o anterior registrou ${n(range.previousLiters)} litros em ${n(range.previousOdometer)} km. Pela regra de 2,3 km/L, é preciso percorrer ${n(range.minimumDistance)} km e atingir pelo menos ${n(range.minimumOdometer)} km no painel. Foram informados ${n(odometer)} km; faltam ${n(Math.max(0,range.minimumOdometer-odometer))} km.`;
}
