import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession} from '../../admin-auth';
import {ensureTripCancellation} from '@/app/lib/trip-cancellation';

/** Finalização manual somente pelo ADM. Esta operação não altera pedidos, abastecimentos ou pagamentos. */
async function loggedPOST(req:Request){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired||!(user.bootstrap||user.groupName==='adm'))return Response.json({error:'Somente ADM pode finalizar viagens.'},{status:403});
 try{
  await ensureTripCancellation();
  const payload=await req.json() as {tripIds?:unknown};
  const ids=payload.tripIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)return Response.json({error:'Selecione de 1 a 100 viagens abertas, sem duplicidade.'},{status:400});
  const marks=ids.map(()=>'?').join(',');
  const matching=await env.DB!.prepare(`SELECT id FROM trips WHERE id IN (${marks}) AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')=''`).bind(...ids).all<{id:number}>();
  if(matching.results.length!==ids.length)return Response.json({error:'Uma ou mais viagens já foram finalizadas, canceladas ou não existem. Atualize a lista.'},{status:409});
  const now=new Date().toISOString();
  const statements=ids.map(id=>env.DB!.prepare("UPDATE trips SET finalized_at=?,finalized_by=?,finalized_by_name=? WHERE id=? AND COALESCE(canceled_at,'')='' AND COALESCE(finalized_at,'')=''").bind(now,user.bootstrap?null:user.id,user.name,id));
  await env.DB!.batch(statements);
  return Response.json({finalized:true,count:ids.length,logDetails:`Finalização manual pelo ADM de ${ids.length} viagem(ns): ${ids.join(', ')}`});
 }catch(error){console.error('Falha na finalização manual:',error);return Response.json({error:'Não foi possível finalizar as viagens. Nenhum abastecimento foi alterado.'},{status:503})}
}
export const POST=withSystemLog(loggedPOST);
