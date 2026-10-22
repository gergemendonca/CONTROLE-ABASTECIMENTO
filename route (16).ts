import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {clearSessionCookie,getSession,hashPassword} from '../../admin-auth';

async function loggedPUT(req:Request){
 const user=await getSession(req);
 if(!user)return Response.json({error:'Faça login para alterar sua senha.'},{status:401});
 if(user.bootstrap)return Response.json({error:'A senha do administrador principal é configurada no Cloudflare.'},{status:403});
 try{
  const {password}=await req.json() as {password?:string};
  if(typeof password!=='string'||!/^\d{4}$/.test(password))return Response.json({error:'A nova senha deve conter exatamente 4 números.'},{status:400});
  await env.DB!.prepare('UPDATE app_users SET password_hash=?,password_change_required=0 WHERE id=?').bind(await hashPassword(password),user.id).run();
  return new Response(JSON.stringify({updated:true}),{headers:{'Content-Type':'application/json','Set-Cookie':clearSessionCookie()}});
 }catch{return Response.json({error:'Não foi possível alterar sua senha.'},{status:503});}
}

export const PUT=withSystemLog(loggedPUT);
