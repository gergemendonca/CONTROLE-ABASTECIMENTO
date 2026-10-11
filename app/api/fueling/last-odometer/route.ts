import {env} from 'cloudflare:workers';
import {getSession,isManagementUser} from '../../admin-auth';
import {additionalFuelingRange} from '@/app/lib/fueling-range';

export async function GET(req:Request){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired)return Response.json({error:'Faça login para consultar a quilometragem.'},{status:401});
 const vehicleId=Number(new URL(req.url).searchParams.get('vehicleId'));
 if(!Number.isSafeInteger(vehicleId)||vehicleId<1)return Response.json({error:'Veículo inválido.'},{status:400});
 try{
  const tripId=Number(new URL(req.url).searchParams.get('tripId')||0);
  if(tripId&&(!Number.isSafeInteger(tripId)||tripId<1))return Response.json({error:'Viagem inválida.'},{status:400});
  if(tripId&&!isManagementUser(user)&&!await env.DB!.prepare('SELECT 1 FROM trip_users WHERE trip_id=? AND user_id=?').bind(tripId,user.id).first())return Response.json({error:'Esta viagem não está associada ao seu usuário.'},{status:403});
  const record=await env.DB!.prepare('SELECT MAX(odometer) AS odometer FROM fueling WHERE vehicle_id=?').bind(vehicleId).first<{odometer:number|null}>();
  return Response.json({odometer:record?.odometer??null,additionalRange:tripId?await additionalFuelingRange(tripId,vehicleId):null},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Não foi possível consultar a última quilometragem.'},{status:503});}
}
