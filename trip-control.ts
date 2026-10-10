import {env} from 'cloudflare:workers';

export const controlNumber=(id:number)=>`V-${String(id).padStart(6,'0')}`;

export async function ensureTripControl(){
 const columns=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
 if(!columns.results.some(column=>column.name==='control_number'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN control_number text').run();
}

export const controlSql=(alias='t')=>`COALESCE(NULLIF(${alias}.control_number,''),'V-' || printf('%06d',${alias}.id)) AS controlNumber`;
