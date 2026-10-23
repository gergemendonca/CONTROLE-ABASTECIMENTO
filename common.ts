import { env } from 'cloudflare:workers';
import {ensureTripControl} from '@/app/lib/trip-control';
import {activeTrip,operationalTrip,ensureTripCancellation} from '@/app/lib/trip-cancellation';
export const kinds=['Gasolina','Diesel','ARLA 32','Diversos'];
export type Item={kind:string;quantity:number;amountCents:number};
export async function validate(input:unknown,allowExpired=false){
 await ensureTripControl();await ensureTripCancellation();
 const x=input as {clientPaid?:boolean;vehicleId?:number;driverId?:number;tripId?:number;odometer?:number;items?:Item[]};
 if(!x||!Number.isInteger(x.vehicleId)||!Number.isInteger(x.driverId)||!Number.isInteger(x.tripId)||!Number.isSafeInteger(x.odometer)||x.odometer!<0||!Array.isArray(x.items)||x.items.length<1||x.items.length>20)return null;
 if(x.clientPaid!==undefined&&typeof x.clientPaid!=='boolean')return null;
 if(x.items.some(i=>!kinds.includes(i.kind)||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>100000||!Number.isSafeInteger(i.amountCents)||i.amountCents<0||i.amountCents>100000000))return null;
 // A associação do motorista é uma regra de permissão e é validada depois,
 // com base no usuário logado. Aqui validamos somente se a viagem existe,
 // pertence ao veículo e ainda pode receber lançamento. Isso permite que Adm
 // e Gerência escolham qualquer motorista válido — inclusive freelancer.
 const [vehicle,driver,trip]=await Promise.all([env.DB!.prepare('SELECT id FROM vehicles WHERE id=?').bind(x.vehicleId).first(),env.DB!.prepare('SELECT id,name FROM drivers WHERE id=?').bind(x.driverId).first(),env.DB!.prepare(`SELECT id,COALESCE(departure_date,travel_date) AS departureDate,COALESCE(arrival_date,travel_date) AS arrivalDate FROM trips WHERE id=? AND vehicle_id=? AND ${operationalTrip('trips')} AND COALESCE(fuel_canceled_at,'')='' AND (COALESCE(no_fueling,0)=0 OR EXISTS (SELECT 1 FROM fuel_requests extraordinary WHERE extraordinary.trip_id=trips.id AND COALESCE(extraordinary.extraordinary,0)=1 AND extraordinary.status='authorized' AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=extraordinary.id))) AND (${allowExpired?'1=1':"COALESCE(arrival_date,travel_date)>=date('now','-3 hours') OR EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.trip_id=trips.id AND fr.status='authorized' AND COALESCE(fr.authorized_at,fr.created_at)>=datetime('now','-5 days') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fr.id))"})`).bind(x.tripId,x.vehicleId).first<{id:number;departureDate:string;arrivalDate:string}>()]);
 if(!vehicle||!driver||!trip)return null;
 return {clientPaid:x.clientPaid===undefined?null:x.clientPaid?1:0,vehicleId:x.vehicleId!,driverId:x.driverId!,driverName:String(driver.name),tripId:x.tripId!,departureDate:trip.departureDate,arrivalDate:trip.arrivalDate,odometer:x.odometer!,items:x.items,total:x.items.reduce((sum,i)=>sum+i.amountCents,0),liters:x.items.filter(i=>i.kind==='Gasolina'||i.kind==='Diesel').reduce((sum,i)=>sum+i.quantity,0)};
}
