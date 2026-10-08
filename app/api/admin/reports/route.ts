import {env} from 'cloudflare:workers';
import {isAdmin} from '../../admin-auth';
import {controlSql,ensureTripControl} from '@/app/lib/trip-control';

export const dynamic='force-dynamic';

function isoDate(value:string|null,fallback:string){
 const parsed=value&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:fallback;
 return parsed;
}

async function ensureClientPaidColumn(){
 const columns=await env.DB!.prepare('PRAGMA table_info(fuel_requests)').all<{name:string}>();
 if(!columns.results.some(column=>column.name==='client_paid'))await env.DB!.prepare('ALTER TABLE fuel_requests ADD COLUMN client_paid integer DEFAULT 0 NOT NULL').run();
}

export async function GET(req:Request){
 if(!await isAdmin(req))return Response.json({error:'Apenas o administrador pode gerar relatórios.'},{status:403});
 try{
  await ensureClientPaidColumn();await ensureTripControl();
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
    COALESCE(t.route,'Roteiro não informado') AS route,${controlSql('t')},
    COALESCE(t.total_km,0) AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,
    COALESCE(fr.payment_status,'') AS paymentStatus,COALESCE(fr.outstanding_cents,0) AS outstandingCents,COALESCE(fr.client_paid,0) AS clientPaid
   FROM fueling f
   JOIN vehicles v ON v.id=f.vehicle_id
   LEFT JOIN trips t ON t.id=f.trip_id
   LEFT JOIN fuel_requests fr ON fr.id=(SELECT id FROM fuel_requests q WHERE q.trip_id=f.trip_id ORDER BY q.id DESC LIMIT 1)
   WHERE date(f.created_at,'-3 hours') BETWEEN ? AND ?
   ORDER BY f.created_at DESC,f.id DESC
  `).bind(from,to).all();
  // O relatório é financeiro/operacional: uma viagem só participa dele depois
  // que existir abastecimento efetivamente lançado no período escolhido.
  const trips=await env.DB!.prepare(`
   SELECT t.id,${controlSql('t')},v.label AS vehicleLabel,t.route,
    COALESCE(t.departure_date,t.travel_date) AS departureDate,
    COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,
    COALESCE(t.total_km,0) AS totalKm,COALESCE(t.total_value_cents,0) AS totalValueCents,
    CASE WHEN (SELECT fr.status FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1)='pending' THEN 'pending'
         WHEN (SELECT fr.status FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1)='authorized' THEN CASE WHEN EXISTS (SELECT 1 FROM fueling completed WHERE completed.fuel_request_id=(SELECT fr.id FROM fuel_requests fr WHERE fr.trip_id=t.id ORDER BY fr.id DESC LIMIT 1)) THEN 'fueled' ELSE 'authorized' END
         WHEN EXISTS (SELECT 1 FROM fueling completed WHERE completed.trip_id=t.id) THEN 'fueled'
         ELSE 'missing' END AS status
   FROM trips t JOIN vehicles v ON v.id=t.vehicle_id
   WHERE EXISTS (
    SELECT 1 FROM fueling completed
    WHERE (completed.trip_id=t.id OR EXISTS (
      SELECT 1 FROM fuel_requests linked
      WHERE linked.id=completed.fuel_request_id AND linked.trip_id=t.id
    ))
    AND date(completed.created_at,'-3 hours') BETWEEN ? AND ?
   )
   ORDER BY COALESCE(t.departure_date,t.travel_date) DESC,t.id DESC
  `).bind(from,to).all();
  return Response.json({from,to,generatedAt:new Date().toISOString(),records:rows.results||[],trips:trips.results||[]});
 }catch{return Response.json({error:'Não foi possível gerar o relatório.'},{status:503});}
}
