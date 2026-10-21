import {ensureEarlyFuelingNote} from '@/app/lib/fueling-range';
import {env} from 'cloudflare:workers';
import {isAdmin} from '../../admin-auth';
import {controlSql,ensureTripControl} from '@/app/lib/trip-control';

import {ensureFuelingFunding} from '@/app/lib/trip-fuel-options';
import {ensureVehicleFuelAssignment} from '@/app/lib/vehicle-fueling-assignment';
export const dynamic='force-dynamic';
async function ensureRetroactiveFlag(){const columns=await env.DB!.prepare('PRAGMA table_info(fueling)').all<{name:string}>();if(!columns.results.some(column=>column.name==='retroactive'))await env.DB!.prepare('ALTER TABLE fueling ADD COLUMN retroactive integer DEFAULT 0 NOT NULL').run();}

export async function GET(req:Request){
 if(!await isAdmin(req))return Response.json({error:'Apenas o administrador pode consultar os abastecimentos feitos.'},{status:403});
 try{
  await ensureTripControl();await ensureRetroactiveFlag();await ensureEarlyFuelingNote();await ensureFuelingFunding();await ensureVehicleFuelAssignment();
  const rows=await env.DB!.prepare(`SELECT f.id,COALESCE(f.paid_by_third_party,fr.client_paid,0) AS clientPaid,f.early_note AS earlyNote,v.label AS vehicleLabel,COALESCE(t.route,'AGUARDANDO REALOCAÇÃO PARA VIAGEM') AS route,${controlSql('t')},f.driver,f.created_at AS createdAt,f.amount_cents AS amountCents,f.liters,f.odometer AS odometer,COALESCE(t.total_km,0) AS totalKm,COALESCE(f.retroactive,0) AS retroactive,COALESCE(fr.requested_by_name,requester.name,f.launched_by_name,'Não informado') AS requestedBy,COALESCE(f.launched_by_name,'Não informado') AS launchedBy,COALESCE(fr.authorized_by_name,a.name,'Não informado') AS authorizedBy,fr.authorized_at AS authorizedAt,COALESCE((SELECT GROUP_CONCAT(COALESCE(used_trip.control_number,'V-' || printf('%06d',used_trip.id)),' · ') FROM fueling_usage usage JOIN trips used_trip ON used_trip.id=usage.used_by_trip_id WHERE usage.fueling_id=f.id),'') AS usedByTrips FROM fueling f JOIN vehicles v ON v.id=f.vehicle_id LEFT JOIN trips t ON t.id=f.trip_id LEFT JOIN fuel_requests fr ON fr.id=f.fuel_request_id LEFT JOIN app_users requester ON requester.id=fr.requested_by LEFT JOIN app_users a ON a.id=fr.authorized_by ORDER BY f.created_at DESC,f.id DESC`).all();
  return Response.json({fueling:rows.results||[]});
 }catch{return Response.json({error:'Não foi possível carregar os abastecimentos feitos.'},{status:503})}
}
