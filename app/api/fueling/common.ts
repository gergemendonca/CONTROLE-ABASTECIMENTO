import { env } from 'cloudflare:workers';
import {ensureTripControl} from '@/app/lib/trip-control';
export const kinds=['Gasolina','Diesel','ARLA 32','Diversos'];
export type Item={kind:string;quantity:number;amountCents:number};
export async function validate(input:unknown){
 await ensureTripControl();
 const x=input as {vehicleId?:number;driverId?:number;tripId?:number;odometer?:number;items?:Item[]};
 if(!x||!Number.isInteger(x.vehicleId)||!Number.isInteger(x.driverId)||!Number.isInteger(x.tripId)||!Number.isSafeInteger(x.odometer)||x.odometer!<0||!Array.isArray(x.items)||x.items.length<1||x.items.length>20)return null;
 if(x.items.some(i=>!kinds.includes(i.kind)||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>100000||!Number.isSafeInteger(i.amountCents)||i.amountCents<0||i.amountCents>100000000))return null;
 // A associação do motorista é uma regra de permissão e é validada depois,
 // com base no usuário logado. Aqui validamos somente se a viagem existe,
 // pertence ao veículo e ainda pode receber lançamento. Isso permite que Adm
 // e Gerência escolham qualquer motorista válido — inclusive freelancer.
 const [vehicle,driver,trip]=await Promise.all([env.DB!.prepare('SELECT id FROM vehicles WHERE id=?').bind(x.vehicleId).first(),env.DB!.prepare('SELECT id,name FROM drivers WHERE id=?').bind(x.driverId).first(),env.DB!.prepare("SELECT id FROM trips WHERE id=? AND vehicle_id=? AND (COALESCE(arrival_date,travel_date)>=date('now') OR EXISTS (SELECT 1 FROM fuel_requests fr WHERE fr.trip_id=trips.id AND fr.status='authorized' AND fr.created_at>=datetime('now','-5 days') AND NOT EXISTS (SELECT 1 FROM fueling used WHERE used.fuel_request_id=fr.id)))").bind(x.tripId,x.vehicleId).first()]);
 if(!vehicle||!driver||!trip)return null;
 return {vehicleId:x.vehicleId!,driverId:x.driverId!,driverName:String(driver.name),tripId:x.tripId!,odometer:x.odometer!,items:x.items,total:x.items.reduce((sum,i)=>sum+i.amountCents,0),liters:x.items.filter(i=>i.kind==='Gasolina'||i.kind==='Diesel').reduce((sum,i)=>sum+i.quantity,0)};
}
