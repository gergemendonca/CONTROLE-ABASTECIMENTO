import {env} from 'cloudflare:workers';
import {isAdmin} from '../../../admin-auth';

type Context={params:Promise<{id:string}>};
type Input={vehicleId:number;departureDate:string;arrivalDate:string;route:string;totalKm:number;totalValueCents:number;associatedUserIds:number[];paymentStatus:'total'|'parcial'|'nao_pago';outstandingCents:number;allowConflicts?:boolean};
const dateOk=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value);
const paymentOk=(value:string)=>value==='total'||value==='parcial'||value==='nao_pago';
function valid(input:Input){return Number.isSafeInteger(input.vehicleId)&&dateOk(input.departureDate)&&dateOk(input.arrivalDate)&&input.arrivalDate>=input.departureDate&&typeof input.route==='string'&&!!input.route.trim()&&input.route.trim().length<=300&&Number.isSafeInteger(input.totalKm)&&input.totalKm>0&&Number.isSafeInteger(input.totalValueCents)&&input.totalValueCents>0&&Array.isArray(input.associatedUserIds)&&input.associatedUserIds.length<=3&&input.associatedUserIds.every(Number.isSafeInteger)&&paymentOk(input.paymentStatus)&&Number.isSafeInteger(input.outstandingCents)&&input.outstandingCents>=0}

export async function GET(req:Request,{params}:Context){
 if(!await isAdmin(req))return Response.json({error:'Apenas Administrador pode editar a viagem.'},{status:403});
 try{const id=Number((await params).id);if(!Number.isSafeInteger(id))return Response.json({error:'Viagem inválida.'},{status:400});const trip=await env.DB!.prepare("SELECT t.id,t.vehicle_id AS vehicleId,v.label AS vehicleLabel,COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,t.route,t.total_km AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,COALESCE((SELECT payment_status FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1),'nao_pago') AS paymentStatus,COALESCE((SELECT outstanding_cents FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1),COALESCE(t.total_value_cents,0)) AS outstandingCents,COALESCE((SELECT GROUP_CONCAT(user_id) FROM trip_users WHERE trip_id=t.id),'') AS userIds FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=?").bind(id).first<any>();if(!trip)return Response.json({error:'Viagem não encontrada.'},{status:404});return Response.json({trip:{...trip,userIds:trip.userIds?String(trip.userIds).split(',').map(Number):[]}})}catch{return Response.json({error:'Não foi possível carregar a viagem.'},{status:503})}
}

export async function PUT(req:Request,{params}:Context){
 if(!await isAdmin(req))return Response.json({error:'Apenas Administrador pode editar a viagem.'},{status:403});
 try{
  const id=Number((await params).id),input=await req.json() as Input;
  if(!Number.isSafeInteger(id)||!valid(input))return Response.json({error:'Confira veículo, datas, roteiro, KM, valor, pagamento e até três motoristas.'},{status:400});
  const total=input.totalValueCents;
  if(input.paymentStatus==='total'&&input.outstandingCents!==0)return Response.json({error:'Viagem totalmente paga não pode ter valor em aberto.'},{status:400});
  if(input.paymentStatus==='parcial'&&(input.outstandingCents<=0||input.outstandingCents>=total))return Response.json({error:'No pagamento parcial, o valor em aberto deve ser maior que zero e menor que o valor total.'},{status:400});
  if(input.paymentStatus==='nao_pago'&&input.outstandingCents!==total)return Response.json({error:'Em viagem não paga, o valor em aberto deve ser igual ao valor total.'},{status:400});
  const duplicate=await env.DB!.prepare('SELECT id FROM trips WHERE vehicle_id=? AND id<>? AND COALESCE(departure_date,travel_date)=? AND COALESCE(arrival_date,travel_date)=? LIMIT 1').bind(input.vehicleId,id,input.departureDate,input.arrivalDate).first();
  if(duplicate)return Response.json({error:'Já existe outra viagem para este carro exatamente neste período.'},{status:409});
  const vehicleBusy=await env.DB!.prepare('SELECT id FROM trips WHERE vehicle_id=? AND id<>? AND COALESCE(departure_date,travel_date)<=? AND COALESCE(arrival_date,travel_date)>=? LIMIT 1').bind(input.vehicleId,id,input.arrivalDate,input.departureDate).first();
  if(vehicleBusy&&!input.allowConflicts)return Response.json({error:'Há conflito de horário para este carro. Confirme a compatibilidade antes de salvar.'},{status:409});
  const automatic=await env.DB!.prepare("SELECT id FROM app_users WHERE active=1 AND group_name IN ('adm','gerencia')").all<{id:number}>();
  const userIds=[...new Set([...input.associatedUserIds,...automatic.results.map(user=>user.id)])];
  const latestRequest=await env.DB!.prepare('SELECT id FROM fuel_requests WHERE trip_id=? AND status=\'pending\' ORDER BY id DESC LIMIT 1').bind(id).first<{id:number}>();
  const statements=[env.DB!.prepare('UPDATE trips SET vehicle_id=?,travel_date=?,departure_date=?,arrival_date=?,route=?,total_km=?,total_value_cents=? WHERE id=?').bind(input.vehicleId,input.departureDate,input.departureDate,input.arrivalDate,input.route.trim(),input.totalKm,total,id),env.DB!.prepare('DELETE FROM trip_users WHERE trip_id=?').bind(id),...userIds.map(userId=>env.DB!.prepare('INSERT OR IGNORE INTO trip_users (trip_id,user_id) VALUES (?,?)').bind(id,userId))];
  if(latestRequest)statements.push(env.DB!.prepare('UPDATE fuel_requests SET payment_status=?,outstanding_cents=? WHERE id=?').bind(input.paymentStatus,input.outstandingCents,latestRequest.id));
  await env.DB!.batch(statements);
  return Response.json({updated:true,requestUpdated:!!latestRequest});
 }catch{return Response.json({error:'Não foi possível gravar a edição da viagem.'},{status:503})}
}
