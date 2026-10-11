export function numericReading(value:unknown):number|null {
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!value.trim())return null;
 const n=typeof value==='number'?value:Number(value.trim().replace(',','.'));
 return Number.isFinite(n)?n:null;
}
export function projectedTankEstimate(plannedKm:number|null,kmPerLiter:number|null,fueledLiters:number,fuelingCount:number){
 if(plannedKm===null||!Number.isFinite(plannedKm)||plannedKm<=0||kmPerLiter===null||!Number.isFinite(kmPerLiter)||kmPerLiter<=0||!Number.isFinite(fueledLiters)||fueledLiters<0||fuelingCount<1)return null;
 const usedLiters=plannedKm/kmPerLiter,balance=fueledLiters-usedLiters;
 return {usedLiters,remainingLiters:Math.max(0,balance),autonomyKm:Math.max(0,balance)*kmPerLiter,deficitLiters:Math.max(0,-balance)};
}
