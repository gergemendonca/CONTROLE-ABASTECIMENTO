import {env} from 'cloudflare:workers';

// V-ID curto, crescente e sem zeros desnecessários. O id técnico permanece
// no banco e jamais é mostrado ao usuário como código de conferência.
export const controlNumber=(id:number)=>`V-${String(id).padStart(3,'0')}`;

export async function ensureTripControl(){
 const columns=await env.DB!.prepare('PRAGMA table_info(trips)').all<{name:string}>();
 if(!columns.results.some(column=>column.name==='control_number'))await env.DB!.prepare('ALTER TABLE trips ADD COLUMN control_number text').run();
}

export const controlSql=(alias='t')=>`'V-' || printf('%03d',${alias}.id) AS controlNumber`;
