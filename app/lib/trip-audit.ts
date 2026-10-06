import {env} from 'cloudflare:workers';

export type TripAuditAction='viagem_cadastrada'|'viagem_editada'|'pedido_criado'|'autorizacao_registrada'|'abastecimento_lancado';

export type TripLateActivity={
 action:TripAuditAction;
 actorName:string;
 effectiveAt:string;
 registeredAt:string;
};

export async function ensureTripAudit(){
 await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS trip_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  retroactive INTEGER DEFAULT 0 NOT NULL
 )`).run();
}

export async function recordTripAudit(input:{tripId:number;action:TripAuditAction;actorName:string;effectiveAt:string;registeredAt?:string;retroactive:boolean}){
 const registeredAt=input.registeredAt||new Date().toISOString();
 await env.DB!.prepare('INSERT INTO trip_audit (trip_id,action,actor_name,effective_at,registered_at,retroactive) VALUES (?,?,?,?,?,?)')
  .bind(input.tripId,input.action,input.actorName,input.effectiveAt,registeredAt,input.retroactive?1:0).run();
}

export const lateActivitySql=(tripAlias:string)=>`COALESCE((SELECT GROUP_CONCAT(action || '|' || actor_name || '|' || effective_at || '|' || registered_at, '§') FROM trip_audit audit WHERE audit.trip_id=${tripAlias}.id AND audit.retroactive=1),'') AS lateActivities`;

export function parseLateActivities(value:unknown):TripLateActivity[]{
 if(!value)return [];
 return String(value).split('§').map(row=>{
  const [action,actorName,effectiveAt,registeredAt]=row.split('|');
  return {action:action as TripAuditAction,actorName,effectiveAt,registeredAt};
 }).filter(item=>item.action&&item.actorName&&item.effectiveAt&&item.registeredAt);
}
