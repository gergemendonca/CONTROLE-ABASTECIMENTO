import {withSystemLog} from '@/app/lib/system-log';
import {clearSessionCookie,createSession,getSession,login,sessionCookie} from '../admin-auth';
export async function GET(req:Request){return Response.json({user:await getSession(req)});}
async function loggedPOST(req:Request){const {username,password}=await req.json() as {username?:string;password?:string};if(typeof username!=='string'||typeof password!=='string')return Response.json({error:'Informe usuário e senha.'},{status:400});const user=await login(username,password);if(!user)return Response.json({error:'Usuário ou senha incorretos.'},{status:401});return new Response(JSON.stringify({ok:true,user}),{headers:{'Content-Type':'application/json','Set-Cookie':sessionCookie(await createSession(user))}})}
async function loggedDELETE(){return new Response(null,{status:204,headers:{'Set-Cookie':clearSessionCookie()}})}

export const POST=withSystemLog(loggedPOST);
export const DELETE=withSystemLog(loggedDELETE);
