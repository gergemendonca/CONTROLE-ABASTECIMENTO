import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession,isManagementUser} from '../../../admin-auth';
import {ensureTripCancellation,activeTrip} from '@/app/lib/trip-cancellation';

async function loggedPOST(req:Request,{params}:{params:Promise<{id:string}>}){
 const session=await getSession(req);
 if(!session||session.passwordChangeRequired||!isManagementUser(session))return Response.json({error:'Somente Adm ou Gerência pode cancelar abastecimento.'},{status:403});
 try{
  const id=Number((await params).id),body=await req.json(),reason=String(body.reason||'').trim();
  if(!Number.isSafeInteger(id)||id<=0||reason.length<3||reason.length>500)return Response.json({error:'Informe o motivo do cancelamento (3 a 500 caracteres).'},{status:400});
  await ensureTripCancellation();
  const trip=await env.DB!.prepare(`SELECT id,fuel_canceled_at FROM trips WHERE id=? AND ${activeTrip('trips')}`).bind(id).first<{id:number;fuel_canceled_at:string|null}>();
  if(!trip)return Response.json({error:'Viagem não encontrada.'},{status:404});
  if(trip.fuel_canceled_at)return Response.json({error:'O abastecimento desta viagem já foi cancelado.'},{status:409});
  const now=new Date().toISOString();
  await env.DB!.batch([
   env.DB!.prepare('UPDATE trips SET fuel_canceled_at=?,fuel_canceled_by_name=?,fuel_cancel_reason=? WHERE id=? AND fuel_canceled_at IS NULL').bind(now,session.name,reason,id),
   env.DB!.prepare("UPDATE fuel_requests SET status='canceled' WHERE trip_id=?").bind(id),
  ]);
  return Response.json({canceled:true,message:'Abastecimento cancelado. A viagem foi preservada; litros, produtos e despesas deixam de compor os relatórios.'});
 }catch{return Response.json({error:'Não foi possível cancelar o abastecimento. Tente novamente.'},{status:503});}
}

export const POST=withSystemLog(loggedPOST);
