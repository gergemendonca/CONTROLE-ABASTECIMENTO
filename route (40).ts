import {env} from 'cloudflare:workers';
import {getSession,isManagementUser} from '../../admin-auth';
import {controlSql,ensureTripControl} from '@/app/lib/trip-control';

async function ensureRequestColumns(){
 const columns=await env.DB!.prepare('PRAGMA table_info(fuel_requests)').all<{name:string}>(),names=new Set((columns.results||[]).map(column=>column.name));
 if(!names.has('requested_by_name'))await env.DB!.prepare('ALTER TABLE fuel_requests ADD COLUMN requested_by_name text').run();
 if(!names.has('client_paid'))await env.DB!.prepare('ALTER TABLE fuel_requests ADD COLUMN client_paid integer DEFAULT 0 NOT NULL').run();
}

export async function GET(req:Request){
 const session=await getSession(req);
 if(!session||!isManagementUser(session)||session.passwordChangeRequired)return Response.json({error:'Acesso restrito.'},{status:403});
 try{
  await ensureTripControl();await ensureRequestColumns();
  const rows=await env.DB!.prepare(`SELECT f.id,f.trip_id AS tripId,f.liters,f.route_km AS routeKm,f.payment_status AS paymentStatus,f.outstanding_cents AS outstandingCents,COALESCE(f.client_paid,0) AS clientPaid,f.status,f.created_at AS createdAt,
   ${controlSql('t')},v.label AS vehicleLabel,t.route,COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,COALESCE(t.total_value_cents,0) AS totalValueCents,COALESCE(f.requested_by_name,u.name,'Não informado') AS requestedBy
   FROM fuel_requests f JOIN trips t ON t.id=f.trip_id JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN app_users u ON u.id=f.requested_by
   WHERE f.created_at>=datetime('now','-5 days') AND f.status IN ('pending','authorized') AND COALESCE(t.canceled_at,'')='' AND COALESCE(t.fuel_canceled_at,'')='' AND COALESCE(t.no_fueling,0)=0
   ORDER BY f.created_at DESC,f.id DESC`).all();
  return Response.json({requests:rows.results||[]});
 }catch{return Response.json({error:'Não foi possível carregar os pedidos recentes.'},{status:503});}
}
