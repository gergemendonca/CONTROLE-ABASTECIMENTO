import {env} from 'cloudflare:workers';
import {isAdmin} from '../../admin-auth';

type Context={params:Promise<{id:string}>};
const validId=(value:string)=>{const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null};

export async function PUT(req:Request,{params}:Context){
 if(!await isAdmin(req))return Response.json({error:'Acesso restrito à Área Adm.'},{status:403});
 try{const id=validId((await params).id),{label}=await req.json() as {label?:string},clean=label?.trim();if(!id||!clean||clean.length>60)return Response.json({error:'Informe um veículo válido.'},{status:400});const vehicle=await env.DB!.prepare('SELECT id FROM vehicles WHERE id=?').bind(id).first();if(!vehicle)return Response.json({error:'Veículo não encontrado.'},{status:404});const duplicate=await env.DB!.prepare('SELECT id FROM vehicles WHERE lower(label)=lower(?) AND id<>? LIMIT 1').bind(clean,id).first();if(duplicate)return Response.json({error:'Já existe outro veículo com este nome ou placa.'},{status:409});const updated=await env.DB!.prepare('UPDATE vehicles SET label=? WHERE id=? RETURNING id,label').bind(clean,id).first();return Response.json({vehicle:updated});}catch{return Response.json({error:'Não foi possível editar o veículo.'},{status:503})}
}

export async function DELETE(req:Request,{params}:Context){
 if(!await isAdmin(req))return Response.json({error:'Acesso restrito à Área Adm.'},{status:403});
 try{const id=validId((await params).id);if(!id)return Response.json({error:'Veículo inválido.'},{status:400});const vehicle=await env.DB!.prepare('SELECT id FROM vehicles WHERE id=?').bind(id).first();if(!vehicle)return Response.json({error:'Veículo não encontrado.'},{status:404});const [trip,fueling]=await Promise.all([env.DB!.prepare('SELECT id FROM trips WHERE vehicle_id=? LIMIT 1').bind(id).first(),env.DB!.prepare('SELECT id FROM fueling WHERE vehicle_id=? LIMIT 1').bind(id).first()]);if(trip||fueling)return Response.json({error:'Este veículo possui viagens ou abastecimentos vinculados e não pode ser apagado.'},{status:409});await env.DB!.prepare('DELETE FROM vehicles WHERE id=?').bind(id).run();return Response.json({deleted:true});}catch{return Response.json({error:'Não foi possível apagar o veículo.'},{status:503})}
}
