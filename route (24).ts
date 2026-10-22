import {env} from 'cloudflare:workers';
import {isAdmin} from '../../admin-auth';
import {ensureVehicleConsumption} from '@/app/lib/vehicle-consumption';
import {projectedTankEstimate} from '@/app/lib/tank-estimate';
import {ensureTripCancellation,activeTrip} from '@/app/lib/trip-cancellation';
import {ensureTripControl,controlSql} from '@/app/lib/trip-control';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 if(!await isAdmin(req))return Response.json({error:'Acesso restrito à Adm e Gerência.'},{status:403});
 try{
 await ensureVehicleConsumption();await ensureTripCancellation();await ensureTripControl();
 const url=new URL(req.url),raw=url.searchParams.get('before'),before=raw?Number(raw):null;
 if(before!==null&&(!Number.isSafeInteger(before)||before<=0))return Response.json({error:'Página inválida.'},{status:400});
 const rows=await env.DB!.prepare(`SELECT t.id,${controlSql('t')},t.route,v.label AS vehicleLabel,
 COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,
 COALESCE(t.no_fueling,0) AS noFueling,t.total_km AS plannedKm,v.consumption_km_l AS consumptionKmL,
 COALESCE(f.fueledLiters,0) AS fueledLiters,COALESCE(f.fuelingCount,0) AS fuelingCount,
 f.firstOdometer,f.lastOdometer
 FROM trips t JOIN vehicles v ON v.id=t.vehicle_id
 LEFT JOIN (SELECT trip_id,vehicle_id,SUM(liters) AS fueledLiters,COUNT(*) AS fuelingCount,
 MIN(odometer) AS firstOdometer,MAX(odometer) AS lastOdometer FROM fueling WHERE liters>0 GROUP BY trip_id,vehicle_id) f
 ON f.trip_id=t.id AND f.vehicle_id=t.vehicle_id
 WHERE ${activeTrip('t')} AND COALESCE(t.fuel_canceled_at,'')=''${before?' AND t.id<?':''}
 ORDER BY t.id DESC LIMIT 101`).bind(...(before?[before]:[])).all<any>();
 const list=rows.results.slice(0,100).map(row=>({...row,estimate:projectedTankEstimate(row.plannedKm,row.consumptionKmL,Number(row.fueledLiters),Number(row.fuelingCount))}));
 return Response.json({trips:list,nextBefore:rows.results.length>100?list[list.length-1].id:null},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Não foi possível carregar a tabela de autonomia.'},{status:503})}
}
