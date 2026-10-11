export function numericReading(value:unknown):number|null {
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!value.trim())return null;
 const n=typeof value==='number'?value:Number(value.trim().replace(',','.'));
 return Number.isFinite(n)?n:null;
}
export function tankEstimate(startKm:number|null,endKm:number|null,startLiters:number|null,kmPerLiter:number|null,addedLiters:number){
 if(startKm===null||endKm===null||startLiters===null||kmPerLiter===null||kmPerLiter<=0||endKm<startKm)return null;
 const traveledKm=endKm-startKm,usedLiters=traveledKm/kmPerLiter,balance=startLiters+addedLiters-usedLiters;
 return {traveledKm,usedLiters,remainingLiters:Math.max(0,balance),autonomyKm:Math.max(0,balance)*kmPerLiter,inconsistent:balance<-.01,deficitLiters:Math.max(0,-balance)};
}
