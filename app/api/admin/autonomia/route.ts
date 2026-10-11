import {env} from 'cloudflare:workers';
import {getSession,isManagementUser,isAdmin} from '../../admin-auth';
import {withSystemLog} from '@/app/lib/system-log';
import {ensureTripEnergy} from '@/app/lib/vehicle-consumption';
import {numericReading,tankEstimate} from '@/app/lib/tank-estimate';
import {ensureTripCancellation,activeTrip} from '@/app/lib/trip-cancellation';
import {ensureTripControl,controlSql} from '@/app/lib/trip-control';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 if(!await isAdmin(req))return Response.json({error:'Acesso restrito à Adm e Gerência.'},{status:403});
 try{
 await ensureTripEnergy();await ensureTripCancellation();await ensureTripControl();
 const url=new URL(req.url),raw=url.searchParams.get('before'),before=raw?Number(raw):null;
 if(before!==null&&(!Number.isSafeInteger(before)||before<=0))return Response.json({error:'Página inválida.'},{status:400});
 const rows=await env.DB!.prepare(`SELECT t.id,${controlSql('t')},t.route,v.label AS vehicleLabel,
 COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate,
 t.total_km AS plannedKm,e.start_km AS startKm,e.end_km AS endKm,e.start_liters AS startLiters,
 COALESCE(e.consumption_km_l,v.consumption_km_l) AS consumptionKmL,
 e.updated_by_name AS updatedByName,e.updated_at AS updatedAt,
 COALESCE((SELECT SUM(f.liters) FROM fueling f WHERE f.trip_id=t.id AND f.vehicle_id=t.vehicle_id
 AND f.odometer>=e.start_km AND f.odometer<=e.end_km AND COALESCE(t.fuel_canceled_at,'')=''),0) AS addedLiters,
 COALESCE((SELECT MAX(f.odometer) FROM fueling f WHERE f.vehicle_id=t.vehicle_id),0) AS lastOdometer
 FROM trips t JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN trip_energy e ON e.trip_id=t.id
 WHERE ${activeTrip('t')}${before?' AND t.id<?':''} ORDER BY t.id DESC LIMIT 101`).bind(...(before?[before]:[])).all<any>();
 const list=rows.results.slice(0,100).map(row=>({...row,estimate:tankEstimate(row.startKm,row.endKm,row.startLiters,row.consumptionKmL,Number(row.addedLiters))}));
 return Response.json({trips:list,nextBefore:rows.results.length>100?list[list.length-1].id:null},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Não foi possível carregar a tabela de autonomia.'},{status:503})}
}
async function loggedPUT(req:Request){
 const user=await getSession(req);
 if(!user||user.passwordChangeRequired||!isManagementUser(user))return Response.json({error:'Acesso restrito à Adm e Gerência.'},{status:403});
 try{
 const body:any=await req.json(),id=numericReading(body.tripId),start=numericReading(body.startKm),end=numericReading(body.endKm),liters=numericReading(body.startLiters);
 if(id===null||!Number.isSafeInteger(id)||id<=0||start===null||end===null||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>99999999||liters===null||liters<0||liters>10000)
 return Response.json({error:'Informe os KM de saída e chegada e os litros iniciais. O KM de chegada não pode ser menor que o de saída.'},{status:400});
 await ensureTripEnergy();await ensureTripCancellation();
 const trip=await env.DB!.prepare(`SELECT v.consumption_km_l AS consumptionKmL,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=? AND ${activeTrip('t')}`).bind(id).first<{consumptionKmL:number|null;arrivalDate:string}>();
 if(!trip)return Response.json({error:'Viagem não encontrada ou cancelada.'},{status:404});
 if(trip.arrivalDate>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))return Response.json({error:'Registre o fechamento na data de chegada da viagem ou depois dela.'},{status:400});
 if(!trip.consumptionKmL||trip.consumptionKmL<=0)return Response.json({error:'Cadastre primeiro o consumo aproximado em km/L deste carro em Configurações → Cadastrar carros.'},{status:400});
 const at=new Date().toISOString();
 await env.DB!.prepare(`INSERT INTO trip_energy(trip_id,start_km,end_km,start_liters,consumption_km_l,updated_by_name,updated_at) VALUES (?,?,?,?,?,?,?)
 ON CONFLICT(trip_id) DO UPDATE SET start_km=excluded.start_km,end_km=excluded.end_km,start_liters=excluded.start_liters,consumption_km_l=excluded.consumption_km_l,updated_by_name=excluded.updated_by_name,updated_at=excluded.updated_at`).bind(id,start,end,liters,trip.consumptionKmL,user.name,at).run();
 return Response.json({saved:true,id,logDetails:`Fechamento de combustível da viagem ${id}: saída ${start} km, chegada ${end} km, saldo inicial ${liters} L, consumo ${trip.consumptionKmL} km/L.`});
 }catch{return Response.json({error:'Não foi possível salvar as leituras. Tente novamente.'},{status:503})}
}
export const PUT=withSystemLog(loggedPUT);
