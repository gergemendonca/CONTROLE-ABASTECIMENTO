import {withSystemLog} from '@/app/lib/system-log';
import { env } from 'cloudflare:workers';
import {isAdmin} from '../admin-auth';
export const dynamic='force-dynamic';
export async function GET(){try{const result=await env.DB!.prepare('SELECT id, label FROM vehicles ORDER BY label').all();return Response.json({vehicles:result.results})}catch{return Response.json({error:'Lista indisponível.'},{status:503})}}
async function loggedPOST(req:Request){if(!await isAdmin(req))return Response.json({error:'Acesso restrito à Área Adm.'},{status:403});try{const {label}=await req.json() as {label?:string};const clean=label?.trim();if(!clean||clean.length>60)return Response.json({error:'Informe o número ou a placa do veículo.'},{status:400});const exists=await env.DB!.prepare('SELECT id FROM vehicles WHERE lower(label)=lower(?) LIMIT 1').bind(clean).first();if(exists)return Response.json({error:'Este veículo já está cadastrado.'},{status:409});const result=await env.DB!.prepare('INSERT INTO vehicles (label) VALUES (?) RETURNING id, label').bind(clean).first();return Response.json({vehicle:result},{status:201})}catch{return Response.json({error:'Não foi possível cadastrar o veículo.'},{status:503})}}

export const POST=withSystemLog(loggedPOST);
