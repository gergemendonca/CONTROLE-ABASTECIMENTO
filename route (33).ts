import {withSystemLog} from '@/app/lib/system-log';
import {env} from 'cloudflare:workers';
import {getSession,hashPassword} from '../../admin-auth';

const developerPassword=()=>env.DEVELOPER_PASSWORD||'0815';

async function loggedPUT(req:Request){
 const user=await getSession(req);
 if(!user?.bootstrap)return Response.json({error:'Esta área é exclusiva do administrador principal.'},{status:403});
 try{
  const {developerCode,userId,password,forceChange}=await req.json() as {developerCode?:string;userId?:number;password?:string;forceChange?:boolean};
  if(developerCode!==developerPassword())return Response.json({error:'Senha de desenvolvedor incorreta.'},{status:403});
  if(!Number.isSafeInteger(userId)||typeof password!=='string'||!/^\d{4}$/.test(password))return Response.json({error:'Informe usuário e senha numérica de 4 dígitos.'},{status:400});
  const target=await env.DB!.prepare('SELECT id FROM app_users WHERE id=?').bind(userId).first();
  if(!target)return Response.json({error:'Usuário não encontrado.'},{status:404});
  await env.DB!.prepare('UPDATE app_users SET password_hash=?,password_change_required=? WHERE id=?').bind(await hashPassword(password),forceChange?1:0,userId).run();
  return Response.json({updated:true});
 }catch{return Response.json({error:'Não foi possível redefinir a senha.'},{status:503});}
}

export const PUT=withSystemLog(loggedPUT);
