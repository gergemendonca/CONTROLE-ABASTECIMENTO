import {ensureTripFuelOptions} from './trip-fuel-options';
import {env} from 'cloudflare:workers';

/** Campos adicionados sem recriar a tabela, preservando todo o histórico existente. */
export async function ensureTripCancellation(){
 await ensureTripFuelOptions();
 const columns=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
 const names=new Set((columns.results||[]).map(column=>column.name));
 if(!names.has('canceled_at'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN canceled_at text').run();
 if(!names.has('canceled_by'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN canceled_by integer').run();
 if(!names.has('canceled_by_name'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN canceled_by_name text').run();
 if(!names.has('cancel_reason'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN cancel_reason text').run();
 if(!names.has('fuel_canceled_at'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN fuel_canceled_at text').run();
 if(!names.has('fuel_canceled_by_name'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN fuel_canceled_by_name text').run();
 if(!names.has('fuel_cancel_reason'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN fuel_cancel_reason text').run();
 // Em acessos simultâneos, outro pedido pode já ter criado as colunas.
 for(const [name,kind] of [['finalized_at','text'],['finalized_by','integer'],['finalized_by_name','text']] as const){
  if(names.has(name))continue;
  try{await env.DB!.prepare(`ALTER TABLE trips ADD COLUMN ${name} ${kind}`).run();}
  catch(error){
   const refreshed=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
   if(!(refreshed.results||[]).some(column=>column.name===name))throw error;
  }
 }

}

export const activeTrip=(alias='t')=>`COALESCE(${alias}.canceled_at,'')=''`;
export const canceledTrip=(alias='t')=>`COALESCE(${alias}.canceled_at,'')<>''`;

/** Uma viagem finalizada continua no histórico, mas sai da operação. */
export const operationalTrip=(alias='t')=>`(${activeTrip(alias)} AND COALESCE(${alias}.finalized_at,'')='')`;
