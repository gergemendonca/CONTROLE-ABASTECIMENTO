import {env} from 'cloudflare:workers';
import {getSession,type SessionUser} from '@/app/api/admin-auth';

export async function ensureSystemLog(){
 await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS system_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,actor_name TEXT NOT NULL,username TEXT NOT NULL,
  action TEXT NOT NULL,path TEXT NOT NULL,method TEXT NOT NULL,
  status INTEGER NOT NULL,entity_id TEXT,created_at TEXT NOT NULL
 )`).run();
 await env.DB!.prepare('CREATE INDEX IF NOT EXISTS system_log_created ON system_log(created_at,id)').run();
}
export async function recordSystemLog(input:{user:SessionUser|null;action:string;path:string;method:string;status:number;entityId?:string;username?:string}){
 await ensureSystemLog();
 await env.DB!.prepare('INSERT INTO system_log(actor_id,actor_name,username,action,path,method,status,entity_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
 .bind(input.user?.id??null,input.user?.name||'Não autenticado',input.user?.username||input.username||'',input.action,input.path,input.method,input.status,input.entityId||null,new Date().toISOString()).run();
}
function actionFor(path:string,method:string){
 if(path==='/api/admin-session')return method==='POST'?'Login no app':'Desligar / encerrar sessão';
 if(path.endsWith('/authorize'))return 'Autorizar abastecimento';
 if(path.endsWith('/cancel-fueling'))return 'Cancelar abastecimento';
 if(path==='/api/account/password'||path==='/api/admin/developer-password')return 'Alterar senha';
 const section=path.split('/')[2];
 const names:Record<string,string>={trips:'viagem',fueling:'abastecimento',users:'usuário',vehicles:'carro',drivers:'motorista',contacts:'contato',notifications:'aviso','fuel-requests':'pedido de abastecimento',system:'configuração do sistema'};
 return `${method==='POST'?'Cadastrar / registrar':method==='PUT'||method==='PATCH'?'Editar':section==='trips'?'Cancelar':'Apagar'} ${names[section]||section}`;
}
/** Registra resultado e identificador sem armazenar corpos, senhas ou cookies. */
export function withSystemLog<T extends (...args:any[])=>Promise<Response>>(handler:T):T{
 return (async (...args:Parameters<T>)=>{
  const req=args[0] as Request,path=new URL(req.url).pathname;
  let user=await getSession(req),username='',entityId=path.match(/\/(\d+)(?:\/|$)/)?.[1];
  if(path==='/api/admin-session'&&req.method==='POST')try{const body=await req.clone().json();username=String(body.username||'').slice(0,100);}catch{}
  let response:Response;
  try{response=await handler(...args);}catch(error){
   try{await recordSystemLog({user,username,action:actionFor(path,req.method),path,method:req.method,status:500,entityId});}catch{console.error('Falha ao gravar log do sistema.');}
   throw error;
  }
  try{
   if(response.ok&&response.headers.get('content-type')?.includes('application/json')){
    const data=await response.clone().json();
    if(path==='/api/admin-session'&&req.method==='POST'&&data.user)user=data.user;
    entityId=entityId||String(data.id||data.trip?.id||data.user?.id||data.vehicle?.id||'')||undefined;
   }
   await recordSystemLog({user,username,action:actionFor(path,req.method),path,method:req.method,status:response.status,entityId});
  }catch{console.error('Falha ao gravar log do sistema.');}
  return response;
 }) as T;
}
