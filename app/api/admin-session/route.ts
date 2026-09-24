import {adminCookie,createAdminSession,verifyAdminPassword} from '../admin-auth';
export async function POST(req:Request){const {password}=await req.json() as {password?:string};if(!await verifyAdminPassword(password))return Response.json({error:'Senha incorreta.'},{status:401});return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':adminCookie(await createAdminSession())}})}
export async function DELETE(){return new Response(null,{status:204,headers:{'Set-Cookie':'admin_access=; Path=/; HttpOnly; Max-Age=0'}})}
