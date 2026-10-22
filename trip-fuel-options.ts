import {env} from 'cloudflare:workers';
async function addColumns(table:string,definitions:Record<string,string>){
 const columns=await env.DB!.prepare('PRAGMA table_info('+table+')').all<{name:string}>(),names=new Set(columns.results.map(c=>c.name));
 for(const [name,definition] of Object.entries(definitions)){
 if(names.has(name))continue;
 try{await env.DB!.prepare('ALTER TABLE '+table+' ADD COLUMN '+name+' '+definition).run();}
 catch(error){const current=await env.DB!.prepare('PRAGMA table_info('+table+')').all<{name:string}>();if(!current.results.some(c=>c.name===name))throw error;}
 }
}
export async function ensureTripFuelOptions(){
 await addColumns('trips',{no_fueling:'integer NOT NULL DEFAULT 0',planned_liters:'real',payment_status:'text',outstanding_cents:'integer'});
}
export async function ensureFuelingFunding(){await addColumns('fueling',{paid_by_third_party:'integer'});}
export const needsFueling=(alias='t')=>'COALESCE('+alias+'.no_fueling,0)=0';
export function restoredLiters(value:unknown,previous:number|null):number|null|undefined{
 if(value===undefined||value===null||value==='')return previous;
 const n=typeof value==='number'?value:typeof value==='string'?Number(value.trim().replace(',','.')):NaN;
 return Number.isFinite(n)&&n>0&&n<=100000?n:undefined;
}
