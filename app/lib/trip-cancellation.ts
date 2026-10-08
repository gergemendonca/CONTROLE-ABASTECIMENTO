import {env} from 'cloudflare:workers';

/** Campos adicionados sem recriar a tabela, preservando todo o histórico existente. */
export async function ensureTripCancellation(){
 const columns=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
 const names=new Set((columns.results||[]).map(column=>column.name));
 if(!names.has('canceled_at'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN canceled_at text').run();
 if(!names.has('canceled_by'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN canceled_by integer').run();
 if(!names.has('canceled_by_name'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN canceled_by_name text').run();
 if(!names.has('cancel_reason'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN cancel_reason text').run();
}

export const activeTrip=(alias='t')=>`COALESCE(${alias}.canceled_at,'')=''`;
export const canceledTrip=(alias='t')=>`COALESCE(${alias}.canceled_at,'')<>''`;
