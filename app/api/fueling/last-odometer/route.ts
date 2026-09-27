import {env} from 'cloudflare:workers';
import {getSession} from '../../admin-auth';

export async function GET(req:Request){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired)return Response.json({error:'Faça login para consultar a quilometragem.'},{status:401});
 const vehicleId=Number(new URL(req.url).searchParams.get('vehicleId'));
 if(!Number.isSafeInteger(vehicleId)||vehicleId<1)return Response.json({error:'Veículo inválido.'},{status:400});
 try{
  const record=await env.DB!.prepare('SELECT MAX(odometer) AS odometer FROM fueling WHERE vehicle_id=?').bind(vehicleId).first<{odometer:number|null}>();
  return Response.json({odometer:record?.odometer??null});
 }catch{return Response.json({error:'Não foi possível consultar a última quilometragem.'},{status:503});}
}
