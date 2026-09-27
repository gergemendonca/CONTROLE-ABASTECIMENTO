import {env} from 'cloudflare:workers';
import {isAdmin} from '../admin-auth';

export async function GET(request:Request){
 if(!await isAdmin(request))return Response.json({error:'Acesso restrito.'},{status:403});
 const url=new URL(request.url),tripIds=url.searchParams.getAll('trip').map(Number).filter(Number.isInteger),liters=url.searchParams.getAll('liters'),kms=url.searchParams.getAll('km'),contactIds=url.searchParams.getAll('contact').map(Number).filter(Number.isInteger);
 if(!tripIds.length||tripIds.length!==liters.length||tripIds.length!==kms.length)return Response.json({error:'Dados da solicitação inválidos.'},{status:400});
 const lines=['*SOLICITAÇÃO DE ABASTECIMENTO*',''];
 for(let index=0;index<tripIds.length;index++){
  const trip:any=await env.DB!.prepare("SELECT t.id,v.label AS vehicleLabel,t.route,COALESCE(t.departure_date,t.travel_date) AS departureDate,COALESCE(t.arrival_date,t.travel_date) AS arrivalDate FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=?").bind(tripIds[index]).first();
  if(!trip)continue;
  lines.push(`${index+1}. *Carro:* ${trip.vehicleLabel}`,`*Roteiro:* ${trip.route}`,`*Período:* ${String(trip.departureDate).split('-').reverse().join('/')} a ${String(trip.arrivalDate).split('-').reverse().join('/')}`,`*Litros solicitados:* ${liters[index]} L`,`*KM previsto:* ${kms[index]} km`,'');
 }
 if(contactIds.length){const marks=contactIds.map(()=>'?').join(',');const contacts=await env.DB!.prepare(`SELECT name FROM contacts WHERE id IN (${marks})`).bind(...contactIds).all();lines.push(`*Destinatários:* ${(contacts.results as any[]).map(contact=>contact.name).join(', ')}`)}
 return Response.redirect('https://wa.me/?text='+encodeURIComponent(lines.join('\n')),302);
}
