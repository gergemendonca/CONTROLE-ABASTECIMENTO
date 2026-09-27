import {env} from 'cloudflare:workers';
import {isAdmin} from '../../admin-auth';

export const dynamic='force-dynamic';

function isoDate(value:string|null,fallback:string){
 const parsed=value&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:fallback;
 return parsed;
}

export async function GET(req:Request){
 if(!await isAdmin(req))return Response.json({error:'Apenas o administrador pode gerar relatórios.'},{status:403});
 try{
  const url=new URL(req.url);
  const today=new Date().toISOString().slice(0,10);
  const firstOfMonth=`${today.slice(0,7)}-01`;
  const from=isoDate(url.searchParams.get('from'),firstOfMonth);
  const to=isoDate(url.searchParams.get('to'),today);
  if(from>to)return Response.json({error:'A data inicial não pode ser posterior à data final.'},{status:400});
  const rows=await env.DB!.prepare(`
   SELECT
    f.id,f.vehicle_id AS vehicleId,v.label AS vehicleLabel,f.driver,f.driver_id AS driverId,
    f.trip_id AS tripId,f.created_at AS createdAt,f.liters,f.amount_cents AS amountCents,
    COALESCE(t.route,'Roteiro não informado') AS route,
    COALESCE(t.total_km,0) AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,
    COALESCE(fr.payment_status,'') AS paymentStatus,COALESCE(fr.outstanding_cents,0) AS outstandingCents
   FROM fueling f
   JOIN vehicles v ON v.id=f.vehicle_id
   LEFT JOIN trips t ON t.id=f.trip_id
   LEFT JOIN fuel_requests fr ON fr.id=(SELECT id FROM fuel_requests q WHERE q.trip_id=f.trip_id ORDER BY q.id DESC LIMIT 1)
   WHERE date(f.created_at,'localtime') BETWEEN ? AND ?
   ORDER BY f.created_at DESC,f.id DESC
  `).bind(from,to).all();
  return Response.json({from,to,generatedAt:new Date().toISOString(),records:rows.results||[]});
 }catch{return Response.json({error:'Não foi possível gerar o relatório.'},{status:503});}
}
