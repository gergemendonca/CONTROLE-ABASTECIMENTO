import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession,isManagementUser} from '../../../admin-auth';
import {ensureTripCancellation} from '@/app/lib/trip-cancellation';

type Context={params:Promise<{id:string}>};
async function loggedPOST(req:Request,{params}:Context){
 const user=await getSession(req);
 if(!isManagementUser(user)||user?.passwordChangeRequired)return Response.json({error:'Somente usuários ADM ou Gerência podem reabrir uma viagem.'},{status:403});
 try{
  await ensureTripCancellation();
  const id=Number((await params).id);
  if(!Number.isSafeInteger(id)||id<=0)return Response.json({error:'Viagem inválida.'},{status:400});
  const exists=await env.DB!.prepare("SELECT id FROM trips WHERE id=? AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')<>''").bind(id).first();
  if(!exists)return Response.json({error:'A viagem não está finalizada ou está cancelada.'},{status:409});
  await env.DB!.prepare("UPDATE trips SET finalized_at=NULL,finalized_by=NULL,finalized_by_name=NULL WHERE id=? AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')<>''").bind(id).run();
  return Response.json({reopened:true,logDetails:`Viagem ${id} reaberta por ADM/Gerência ${user!.name}.`});
 }catch(error){console.error('Falha ao reabrir viagem:',error);return Response.json({error:'Não foi possível reabrir a viagem.'},{status:503})}
}
export const POST=withSystemLog(loggedPOST);
