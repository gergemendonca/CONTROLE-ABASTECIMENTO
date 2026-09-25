import {env} from 'cloudflare:workers';

export const dynamic='force-dynamic';

async function syncRegisteredDrivers(){
 await env.DB!.prepare("INSERT OR IGNORE INTO drivers (name) SELECT name FROM app_users WHERE active=1 AND group_name='motorista' AND NOT EXISTS (SELECT 1 FROM drivers d WHERE lower(d.name)=lower(app_users.name))").run();
}

export async function GET(){
 try{
  await syncRegisteredDrivers();
  const r=await env.DB!.prepare("SELECT d.id,d.name,CASE WHEN EXISTS (SELECT 1 FROM app_users u WHERE u.active=1 AND u.group_name='motorista' AND lower(u.name)=lower(d.name)) THEN 'usuario' ELSE 'freelancer' END AS source FROM drivers d WHERE EXISTS (SELECT 1 FROM app_users u WHERE u.active=1 AND u.group_name='motorista' AND lower(u.name)=lower(d.name)) OR NOT EXISTS (SELECT 1 FROM app_users u WHERE lower(u.name)=lower(d.name)) ORDER BY CASE WHEN EXISTS (SELECT 1 FROM app_users u WHERE u.active=1 AND u.group_name='motorista' AND lower(u.name)=lower(d.name)) THEN 0 ELSE 1 END,d.name COLLATE NOCASE").all();
  return Response.json({drivers:r.results});
 }catch{return Response.json({error:'Não foi possível carregar os motoristas cadastrados.'},{status:503})}
}

export async function POST(req:Request){
 try{
  const {name,freelancer}=await req.json() as {name?:string;freelancer?:boolean};
  const clean=name?.trim();
  if(!freelancer)return Response.json({error:'Motoristas permanentes devem ser cadastrados em Configurações, no grupo Motorista.'},{status:400});
  if(!clean||clean.length>100)return Response.json({error:'Informe o nome do motorista freelancer.'},{status:400});
  const existing=await env.DB!.prepare('SELECT id,name FROM drivers WHERE lower(name)=lower(?) LIMIT 1').bind(clean).first<{id:number;name:string}>();
  if(existing)return Response.json({driver:{id:existing.id,name:existing.name,source:'freelancer'}});
  const driver=await env.DB!.prepare('INSERT INTO drivers (name) VALUES (?) RETURNING id,name').bind(clean).first();
  return Response.json({driver:{...driver,source:'freelancer'}},{status:201});
 }catch{return Response.json({error:'Não foi possível cadastrar o freelancer. Verifique se o nome já existe.'},{status:409})}
}
