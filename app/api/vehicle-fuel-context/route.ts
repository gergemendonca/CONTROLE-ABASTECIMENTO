import {env} from 'cloudflare:workers';
import {isManagementUser,getSession} from '../admin-auth';
import {activeTrip,ensureTripCancellation} from '@/app/lib/trip-cancellation';
import {ensureVehicleFuelAssignment} from '@/app/lib/vehicle-fueling-assignment';

export async function GET(req:Request){
 const session=await getSession(req);
 if(!session||!isManagementUser(session)||session.passwordChangeRequired)return Response.json({error:'Acesso restrito.'},{status:403});
 const params=new URL(req.url).searchParams,vehicleId=Number(params.get('vehicleId')),excludeTripId=Number(params.get('excludeTripId')||0),referenceDate=params.get('referenceDate')||'9999-12-31';
 if(!Number.isSafeInteger(vehicleId)||vehicleId<=0)return Response.json({error:'Veículo inválido.'},{status:400});
 try{
  await ensureTripCancellation();await ensureVehicleFuelAssignment();
  const previous=await env.DB!.prepare(`SELECT t.id,v.label AS vehicleLabel,t.route,
   COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,
   EXISTS(SELECT 1 FROM fueling f WHERE f.vehicle_id=t.vehicle_id AND (f.trip_id=t.id OR f.original_trip_id=t.id OR (f.trip_id IS NULL AND f.original_trip_id IS NULL AND f.fuel_request_id IN (SELECT id FROM fuel_requests WHERE trip_id=t.id)))) AS hasFueling
   FROM trips t JOIN vehicles v ON v.id=t.vehicle_id
   WHERE t.vehicle_id=? AND t.id<>? AND ${activeTrip('t')}
   ORDER BY CASE WHEN COALESCE(t.departure_date,t.travel_date)<=? THEN 0 ELSE 1 END,
   CASE WHEN COALESCE(t.departure_date,t.travel_date)<=? THEN COALESCE(t.departure_date,t.travel_date) END DESC,
   CASE WHEN COALESCE(t.departure_date,t.travel_date)>? THEN COALESCE(t.departure_date,t.travel_date) END ASC,t.id DESC LIMIT 1`).bind(vehicleId,excludeTripId,referenceDate,referenceDate,referenceDate).first();
  return Response.json({previousTrip:previous||null});
 }catch{return Response.json({error:'Não foi possível verificar o histórico do veículo.'},{status:503});}
}
