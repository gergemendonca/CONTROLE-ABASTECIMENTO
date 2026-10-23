import {withSystemLog} from '@/app/lib/system-log';
import { env } from 'cloudflare:workers';
import {isAdmin} from '../admin-auth';
import {ensureVehicleConsumption} from '@/app/lib/vehicle-consumption';
import {numericReading} from '@/app/lib/tank-estimate';
export const dynamic='force-dynamic';
export async function GET(){try{await ensureVehicleConsumption();const result=await env.DB!.prepare('SELECT id, label,consumption_km_l AS consumptionKmL FROM vehicles ORDER BY label').all();return Response.json({vehicles:result.results})}catch{return Response.json({error:'Lista indisponível.'},{status:503})}}
async function loggedPOST(req:Request){if(!await isAdmin(req))return Response.json({error:'Acesso restrito à Área Adm.'},{status:403});try{const {label,consumptionKmL}=await req.json() as {label?:string;consumptionKmL?:unknown};const clean=typeof label==='string'?label.trim():'';const consumption=consumptionKmL===undefined||consumptionKmL===null||consumptionKmL===''?null:numericReading(consumptionKmL);if(consumptionKmL!==undefined&&consumptionKmL!==null&&consumptionKmL!==''&&(consumption===null||consumption<=0||consumption>100))return Response.json({error:'Informe o consumo em km/L, maior que zero e até 100.'},{status:400});await ensureVehicleConsumption();if(!clean||clean.length>60)return Response.json({error:'Informe o número ou a placa do veículo.'},{status:400});const exists=await env.DB!.prepare('SELECT id FROM vehicles WHERE lower(label)=lower(?) LIMIT 1').bind(clean).first();if(exists)return Response.json({error:'Este veículo já está cadastrado.'},{status:409});const result=await env.DB!.prepare('INSERT INTO vehicles (label,consumption_km_l) VALUES (?,?) RETURNING id, label,consumption_km_l AS consumptionKmL').bind(clean,consumption).first();return Response.json({vehicle:result},{status:201})}catch{return Response.json({error:'Não foi possível cadastrar o veículo.'},{status:503})}}

export const POST=withSystemLog(loggedPOST);
