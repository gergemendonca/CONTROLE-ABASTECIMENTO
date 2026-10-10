import {env} from 'cloudflare:workers';
import {getSession,isManagementUser} from '../../admin-auth';
import {ensureSystemLog,recordSystemLog} from '@/app/lib/system-log';

export async function GET(req:Request){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired||!isManagementUser(user))return Response.json({error:'Acesso restrito ao Adm e Gerência.'},{status:403});
 try{
  await ensureSystemLog();
  const url=new URL(req.url),before=Number(url.searchParams.get('before')||0),search=(url.searchParams.get('search')||'').trim().slice(0,100);
  const clauses:string[]=[],values:(string|number)[]=[];
  if(before>0&&Number.isSafeInteger(before)){clauses.push('id<?');values.push(before);}
  if(search){clauses.push('(instr(lower(actor_name),lower(?))>0 OR instr(lower(username),lower(?))>0 OR instr(lower(action),lower(?))>0 OR entity_id=?)');values.push(search,search,search,search);}
  const result=await env.DB!.prepare(`SELECT id,actor_name AS actorName,username,action,path,method,status,entity_id AS entityId,created_at AS createdAt FROM system_log ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY id DESC LIMIT 101`).bind(...values).all();
  const records=result.results.slice(0,100);
  return Response.json({records,nextBefore:result.results.length>100?records[records.length-1].id:null},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Não foi possível consultar o log.'},{status:503});}
}
export async function POST(req:Request){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired)return Response.json({error:'Faça login.'},{status:401});
 try{
  const body=await req.json(),path=String(body.path||'').split('?')[0].slice(0,200);
  if(!path.startsWith('/')||path.startsWith('//')||path.startsWith('/api/'))return Response.json({error:'Página inválida.'},{status:400});
  const allowed=!path.startsWith('/admin')||isManagementUser(user);
  await recordSystemLog({user,path,action:allowed?'Acessar página':'Acesso ao Adm negado',method:'GET',status:allowed?200:403});
  return Response.json({ok:allowed},{status:allowed?200:403});
 }catch{return Response.json({error:'Não foi possível registrar o acesso.'},{status:503});}
}
