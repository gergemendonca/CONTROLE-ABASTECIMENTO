import { env } from 'cloudflare:workers';
export const kinds=['Gasolina','Diesel','ARLA 32','Diversos'];
export type Item={kind:string;quantity:number;amountCents:number};
export async function validate(input:unknown){
 const x=input as {vehicleId?:number;driverId?:number;odometer?:number;items?:Item[]};
 if(!x||!Number.isInteger(x.vehicleId)||!Number.isInteger(x.driverId)||!Number.isSafeInteger(x.odometer)||x.odometer!<0||!Array.isArray(x.items)||x.items.length<1||x.items.length>20)return null;
 if(x.items.some(i=>!kinds.includes(i.kind)||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>100000||!Number.isSafeInteger(i.amountCents)||i.amountCents<0||i.amountCents>100000000))return null;
 const [vehicle,driver]=await Promise.all([env.DB!.prepare('SELECT id FROM vehicles WHERE id=?').bind(x.vehicleId).first(),env.DB!.prepare('SELECT id,name FROM drivers WHERE id=?').bind(x.driverId).first()]);
 if(!vehicle||!driver)return null;
 return {vehicleId:x.vehicleId!,driverId:x.driverId!,driverName:String(driver.name),odometer:x.odometer!,items:x.items,total:x.items.reduce((sum,i)=>sum+i.amountCents,0),liters:x.items.filter(i=>i.kind==='Gasolina'||i.kind==='Diesel').reduce((sum,i)=>sum+i.quantity,0)};
}
