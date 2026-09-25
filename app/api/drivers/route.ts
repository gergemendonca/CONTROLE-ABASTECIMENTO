import {env} from 'cloudflare:workers';

export const dynamic='force-dynamic';

async function prepareDrivers(){
 const columns=await env.DB!.prepare('PRAGMA table_info(drivers)').all<{name:string}>();
 if(!columns.results.some(column=>column.name==='app_user_id'))await env.DB!.prepare('ALTER TABLE drivers ADD COLUMN app_user_id integer').run();
 await env.DB!.batch([
  env.DB!.prepare("UPDATE drivers SET app_user_id=NULL WHERE app_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_users u WHERE u.id=drivers.app_user_id AND u.group_name='motorista')"),
  env.DB!.prepare("UPDATE drivers SET app_user_id=(SELECT u.id FROM app_users u WHERE u.group_name='motorista' AND lower(u.name)=lower(drivers.name) LIMIT 1) WHERE app_user_id IS NULL AND EXISTS (SELECT 1 FROM app_users u WHERE u.group_name='motorista' AND lower(u.name)=lower(drivers.name))"),
  env.DB!.prepare("INSERT OR IGNORE INTO drivers (name,app_user_id) SELECT name,id FROM app_users WHERE group_name='motorista'"),
  env.DB!.prepare('UPDATE drivers SET name=(SELECT name FROM app_users u WHERE u.id=drivers.app_user_id) WHERE app_user_id IS NOT NULL')
 ]);
}

export async function GET(){try{await prepareDrivers();const r=await env.DB!.prepare("SELECT d.id,d.name,CASE WHEN d.app_user_id IS NULL THEN 'freelancer' ELSE 'usuario' END AS source FROM drivers d LEFT JOIN app_users u ON u.id=d.app_user_id WHERE d.app_user_id IS NULL OR u.group_name='motorista' ORDER BY CASE WHEN d.app_user_id IS NULL THEN 1 ELSE 0 END,d.name COLLATE NOCASE").all();return Response.json({drivers:r.results})}catch{return Response.json({error:'Motoristas indisponíveis.'},{status:503})}}

export async function POST(req:Request){try{const {name,freelancer}=await req.json() as {name?:string;freelancer?:boolean};const clean=name?.trim();if(!freelancer)return Response.json({error:'Motoristas permanentes devem ser cadastrados em Configurações, no grupo Motorista.'},{status:400});if(!clean||clean.length>100)return Response.json({error:'Informe o nome do motorista freelancer.'},{status:400});const exists=await env.DB!.prepare('SELECT id,name,app_user_id AS appUserId FROM drivers WHERE lower(name)=lower(?) LIMIT 1').bind(clean).first<{id:number;name:string;appUserId:number|null}>();if(exists){if(exists.appUserId)return Response.json({error:'Este motorista já está cadastrado em Configurações.'},{status:409});return Response.json({driver:{id:exists.id,name:exists.name,source:'freelancer'}})}const driver=await env.DB!.prepare('INSERT INTO drivers (name,app_user_id) VALUES (?,NULL) RETURNING id,name').bind(clean).first();return Response.json({driver:{...driver,source:'freelancer'}},{status:201})}catch{return Response.json({error:'Não foi possível cadastrar o freelancer. Verifique se o nome já existe.'},{status:409})}}
