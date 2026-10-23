import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession} from '../admin-auth';
import {ensureTripFuelOptions} from '@/app/lib/trip-fuel-options';
export async function GET(req:Request){
 const user=await getSession(req);if(!user||user.bootstrap)return Response.json({notifications:[]});
 try{await ensureTripFuelOptions();
 const items=await env.DB!.prepare(`SELECT id,title,message,href,read_at AS readAt,created_at AS createdAt FROM app_notifications
 WHERE user_id=? AND (href NOT LIKE '%pedido=%' OR NOT EXISTS (
 SELECT 1 FROM fuel_requests fr JOIN trips t ON t.id=fr.trip_id
 WHERE fr.id=CAST(substr(app_notifications.href,instr(app_notifications.href,'pedido=')+7) AS INTEGER) AND COALESCE(t.no_fueling,0)=1))
 ORDER BY created_at DESC LIMIT 50`).bind(user.id).all();
 return Response.json({notifications:items.results},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Não foi possível consultar os avisos.'},{status:503});}
}
async function loggedPUT(req:Request){const user=await getSession(req);if(!user||user.bootstrap)return Response.json({error:'Faça login.'},{status:403});const {id}=await req.json() as {id:number};await env.DB!.prepare('UPDATE app_notifications SET read_at=? WHERE id=? AND user_id=?').bind(new Date().toISOString(),id,user.id).run();return Response.json({ok:true});}
export const PUT=withSystemLog(loggedPUT);
