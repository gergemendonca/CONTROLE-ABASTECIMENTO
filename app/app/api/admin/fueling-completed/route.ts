import {env} from 'cloudflare:workers';
import {isAdmin} from '../../admin-auth';

export const dynamic='force-dynamic';

export async function GET(req:Request){
 if(!await isAdmin(req))return Response.json({error:'Apenas o administrador pode consultar os abastecimentos feitos.'},{status:403});
 try{
  const rows=await env.DB!.prepare(`SELECT f.id,v.label AS vehicleLabel,t.route,f.driver,f.created_at AS createdAt,f.amount_cents AS amountCents,f.liters,COALESCE(fr.authorized_by_name,a.name,CASE WHEN fr.status='authorized' THEN 'George Mendonça' END,'Não informado') AS authorizedBy,fr.authorized_at AS authorizedAt FROM fueling f JOIN vehicles v ON v.id=f.vehicle_id JOIN trips t ON t.id=f.trip_id LEFT JOIN fuel_requests fr ON fr.id=f.fuel_request_id LEFT JOIN app_users a ON a.id=fr.authorized_by ORDER BY f.created_at DESC,f.id DESC`).all();
  return Response.json({fueling:rows.results||[]});
 }catch{return Response.json({error:'Não foi possível carregar os abastecimentos feitos.'},{status:503})}
}
