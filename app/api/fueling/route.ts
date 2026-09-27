import {env} from 'cloudflare:workers';
import {getSession, type SessionUser} from '../admin-auth';
import {validate} from './common';

export const dynamic='force-dynamic';
const fields="f.id,f.vehicle_id AS vehicleId,v.label AS vehicleLabel,f.driver_id AS driverId,f.driver,f.odometer,f.amount_cents AS amountCents,f.created_at AS createdAt,f.liters,f.trip_id AS tripId,f.fuel_request_id AS fuelRequestId,f.launched_by AS launchedById,COALESCE(f.launched_by_name,'Não informado') AS launchedBy,COALESCE(t.route,(SELECT oldTrip.route FROM trips oldTrip WHERE oldTrip.vehicle_id=f.vehicle_id AND date(f.created_at) BETWEEN COALESCE(oldTrip.departure_date,oldTrip.travel_date) AND COALESCE(oldTrip.arrival_date,oldTrip.travel_date) ORDER BY COALESCE(oldTrip.departure_date,oldTrip.travel_date) DESC LIMIT 1)) AS route";

async function linkedRequest(tripId:number){return env.DB!.prepare("SELECT id FROM fuel_requests WHERE trip_id=? AND status='authorized' ORDER BY authorized_at DESC,id DESC LIMIT 1").bind(tripId).first<{id:number}>();}

async function ensureLaunchAudit(){
  const columns=await env.DB!.prepare('PRAGMA table_info(fueling)').all<{name:string}>();
  if(!columns.results.some(column=>column.name==='launched_by'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN launched_by integer').run();
  if(!columns.results.some(column=>column.name==='launched_by_name'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN launched_by_name text').run();
}

function canChooseDriver(user:SessionUser){return !!user.bootstrap||user.groupName==='adm'||user.groupName==='gerencia'||user.roles.includes('admin');}

async function canLaunchFor(user:SessionUser,driverId:number){
  if(canChooseDriver(user))return true;
  if(user.groupName!=='motorista'||!user.roles.includes('solicitante'))return false;
  return !!await env.DB!.prepare('SELECT id FROM drivers WHERE id=? AND lower(name)=lower(?) LIMIT 1').bind(driverId,user.name).first();
}

export async function GET(req:Request){
  try{
    const session=await getSession(req);
    if(!session)return Response.json({error:'Faça login para consultar abastecimentos.'},{status:401});
    await ensureLaunchAudit();
    const last30=new URL(req.url).searchParams.get('days')==='30',management=canChooseDriver(session);
    let where='',binds:unknown[]=[];
    if(last30||!management){where=" WHERE f.created_at>=datetime('now','-30 days') AND f.driver_id=(SELECT id FROM drivers WHERE lower(name)=lower(?) LIMIT 1)";binds=[session.name];}
    const sql=`SELECT ${fields} FROM fueling f JOIN vehicles v ON v.id=f.vehicle_id LEFT JOIN trips t ON t.id=f.trip_id${where} ORDER BY f.created_at DESC,f.id DESC${last30?'':' LIMIT 50'}`;
    const records=(await env.DB!.prepare(sql).bind(...binds).all()).results;
    const ids=records.map(record=>Number(record.id));
    const items=ids.length?(await env.DB!.prepare(`SELECT fueling_id AS fuelingId,kind,quantity,amount_cents AS amountCents FROM fueling_items WHERE fueling_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`).bind(...ids).all()).results:[];
    return Response.json({records:records.map(record=>({...record,items:items.filter(item=>item.fuelingId===record.id)}))});
  }catch{return Response.json({error:'Não foi possível carregar os registros.'},{status:503})}
}

export async function POST(req:Request){
  try{
    const session=await getSession(req);
    if(!session)return Response.json({error:'Faça login para lançar abastecimento.'},{status:401});
    const data=await validate(await req.json());
    if(!data)return Response.json({error:'Escolha uma viagem cadastrada e confira veículo, motorista, KM, itens, quantidades e valores.'},{status:400});
    if(!await canLaunchFor(session,data.driverId))return Response.json({error:'Você só pode lançar abastecimento em seu próprio nome.'},{status:403});
    await ensureLaunchAudit();
    const duplicate=await env.DB!.prepare('SELECT id FROM fueling WHERE vehicle_id=? AND odometer=? LIMIT 1').bind(data.vehicleId,data.odometer).first();
    if(duplicate)return Response.json({error:'Já existe um abastecimento deste veículo com esta quilometragem. Confira o KM informado.'},{status:409});
    const request=await linkedRequest(data.tripId),id=Date.now()*1000+Math.floor(Math.random()*1000),date=new Date().toISOString();
    await env.DB!.batch([
      env.DB!.prepare('INSERT INTO fueling (id,vehicle_id,driver_id,driver,liters,odometer,amount_cents,trip_id,fuel_request_id,launched_by,launched_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,data.vehicleId,data.driverId,data.driverName,data.liters,data.odometer,data.total,data.tripId,request?.id||null,session.bootstrap?null:session.id,session.name,date),
      ...data.items.map(item=>env.DB!.prepare('INSERT INTO fueling_items (fueling_id,kind,quantity,amount_cents) VALUES (?,?,?,?)').bind(id,item.kind,item.quantity,item.amountCents))
    ]);
    return Response.json({id,createdAt:date,launchedBy:session.name,driver:data.driverName},{status:201});
  }catch{return Response.json({error:'Falha ao salvar. Tente novamente.'},{status:503})}
}
