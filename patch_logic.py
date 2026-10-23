from pathlib import Path
R=Path('/mnt/data/update_v152')
def edit(f):return (R/f).read_text()
def save(f,s):(R/f).write_text(s)
def r(f,old,new,require=True):
 s=edit(f)
 if old not in s:
  if require:raise Exception(f'{f} NOT FOUND: {old[:100]}')
  return
 save(f,s.replace(old,new))

# Courtesy is a zero-cost trip, distinct from 'already paid'.
f='app/api/trips/route.ts';s=edit(f)
s=s.replace('input.totalValueCents>0','input.totalValueCents>=0')
s=s.replace("  const payment=input.paymentStatus||'nao_pago',outstanding=payment==='total'?0:payment==='nao_pago'?input.totalValueCents:input.outstandingCents;", "  const payment=input.paymentStatus||'nao_pago',outstanding=payment==='total'||payment==='cortesia'?0:payment==='nao_pago'?input.totalValueCents:input.outstandingCents;")
s=s.replace("!['total','parcial','nao_pago'].includes(payment)","!['total','parcial','nao_pago','cortesia'].includes(payment)")
s=s.replace("if(!['total','parcial','nao_pago','cortesia'].includes(payment)||!Number.isSafeInteger(outstanding)","if(!['total','parcial','nao_pago','cortesia'].includes(payment)||(payment==='cortesia'?input.totalValueCents!==0:input.totalValueCents<=0)||!Number.isSafeInteger(outstanding)")
s=s.replace("(outstanding!<=0||outstanding!>=input.totalValueCents)","(outstanding<=0||outstanding>=input.totalValueCents)")
s=s.replace('fr.vehicle_id=t.vehicle_id AND fr.status', 'fr.trip_id=t.id AND fr.status')
# Ensure true no payment on free trip, no outstanding. Existing records retained.
save(f,s)
f='app/api/trips/[id]/full-edit/route.ts';s=edit(f)
s=s.replace("paymentStatus:'total'|'parcial'|'nao_pago'", "paymentStatus:'total'|'parcial'|'nao_pago'|'cortesia'")
s=s.replace("value==='total'||value==='parcial'||value==='nao_pago'", "value==='total'||value==='parcial'||value==='nao_pago'||value==='cortesia'")
s=s.replace('input.totalValueCents>0','input.totalValueCents>=0')
s=s.replace("  const total=input.totalValueCents;", "  const total=input.totalValueCents;\n  if(input.paymentStatus==='cortesia'&&(total!==0||input.outstandingCents!==0))return Response.json({error:'Cortesia deve ter valor total e saldo em aberto iguais a zero.'},{status:400});\n  if(input.paymentStatus!=='cortesia'&&total<=0)return Response.json({error:'Informe valor total maior que zero para uma viagem remunerada.'},{status:400});")
save(f,s)
f='app/admin/admin-client.tsx'
s=edit(f).replace('                min="0.01"','                min="0"\n                readOnly={paymentStatus==="cortesia"}')
s=s.replace('              />\n            </label>\n            <label className="block rounded-xl border-2 border-[#0b7184]','              />\n              {paymentStatus==="cortesia"&&<span className="mt-2 block text-sm font-bold text-violet-800">Viagem gratuita: R$ 0,00, sem valor a receber.</span>}\n            </label>\n            <label className="block rounded-xl border-2 border-[#0b7184]')
save(f,s)

# Requests are allowed for courtesy trips; fuel is physical despite R$ 0 trip revenue.
f='app/api/fuel-requests/route.ts';s=edit(f)
s=s.replace("import {activeTrip,ensureTripCancellation}","import {activeTrip,operationalTrip,ensureTripCancellation}")
s=s.replace("paymentStatus:'total'|'parcial'|'nao_pago'","paymentStatus:'total'|'parcial'|'nao_pago'|'cortesia'")
s=s.replace("value==='total'||value==='parcial'||value==='nao_pago'", "value==='total'||value==='parcial'||value==='nao_pago'||value==='cortesia'")
s=s.replace("${activeTrip('trips')} AND COALESCE(fuel_canceled_at,'')=''","${operationalTrip('trips')} AND COALESCE(fuel_canceled_at,'')=''")
s=s.replace('if(total<=0)return Response.json({error:\'Esta viagem não possui valor total válido. Edite a viagem antes de solicitar autorização.\'},{status:400});', "if(total<=0&&item.paymentStatus!=='cortesia')return Response.json({error:'Esta viagem não possui valor total válido. Edite a viagem antes de solicitar autorização.'},{status:400});\n   if(item.paymentStatus==='cortesia'&&(total!==0||item.outstandingCents!==0))return Response.json({error:'Viagem cortesia deve ter valor zero e não pode ter saldo em aberto.'},{status:400});")
s=s.replace("${activeTrip('t')} AND COALESCE(t.fuel_canceled_at,'')=''","${operationalTrip('t')} AND COALESCE(t.fuel_canceled_at,'')=''")
save(f,s)
f='app/solicitar-abastecimento/detalhes/page.tsx';s=edit(f)
s=s.replace("'total'|'parcial'|'nao_pago'","'total'|'parcial'|'nao_pago'|'cortesia'")
s=s.replace("status==='total'?{icon:'✓',label:'Totalmente paga'", "status==='cortesia'?{icon:'★',label:'Cortesia — gratuita',className:'bg-violet-50 text-violet-800'}:status==='total'?{icon:'✓',label:'Totalmente paga'")
s=s.replace("status==='total'?'':status==='nao_pago'", "status==='total'||status==='cortesia'?'':status==='nao_pago'")
s=s.replace("if(total<=0)return fail(trip,'Esta viagem não possui valor total válido. Corrija o valor no cadastro da viagem; os dados das demais continuam guardados.');", "if(total<=0&&detail.paymentStatus!=='cortesia')return fail(trip,'Esta viagem não possui valor total válido. Corrija o valor no cadastro da viagem; os dados das demais continuam guardados.');if(detail.paymentStatus==='cortesia'&&total!==0)return fail(trip,'Uma viagem cortesia deve estar cadastrada com valor R$ 0,00.');")
s=s.replace('<option value="nao_pago">Não paga</option></select>', '<option value="nao_pago">Não paga</option><option value="cortesia">Cortesia (gratuita)</option></select>')
save(f,s)
f='app/solicitar-abastecimento/enviar/page.tsx';s=edit(f)
s=s.replace("payments[index]==='parcial'?'Parcialmente paga':'Não paga'", "payments[index]==='parcial'?'Parcialmente paga':payments[index]==='cortesia'?'Cortesia (gratuita)':'Não paga'")
s=s.replace("...(payment==='Totalmente paga'?[]:[`*Valor pendente:* R$ ${balances[index]||''}`])", "...(payment==='Totalmente paga'||payment==='Cortesia (gratuita)'?[]:[`*Valor pendente:* R$ ${balances[index]||''}`])")
save(f,s)
# Finance reports always retain finalised historical trips. Courtesy tagged in payment reports.
f='app/admin/relatorios/page.tsx';s=edit(f)
s=s.replace("paymentStatus?:'total'|'parcial'|'nao_pago'", "paymentStatus?:'total'|'parcial'|'nao_pago'|'cortesia'")
s=s.replace("if(item.paymentStatus==='total')return", "if(item.paymentStatus==='cortesia')return {label:'Cortesia',detail:'Viagem gratuita, sem cobrança',className:'bg-violet-100 text-violet-900'};if(item.paymentStatus==='total')return")
s=s.replace("item.paymentStatus==='parcial'?'Parcial':'Não paga'", "item.paymentStatus==='parcial'?'Parcial':item.paymentStatus==='cortesia'?'Cortesia':'Não paga'")
save(f,s)

# Avoid rerunning any automatic completion status, preserve scheduled work logic.
# Operational visibility: requests, auth, upload, resend, WhatsApp, availability, launch.
paths=[
 'app/api/fuel-request-trips/route.ts',
 'app/api/fuel-requests/[id]/authorize/route.ts',
 'app/api/fueling/common.ts',
 'app/api/fuel-request-message/route.ts',
 'app/api/fuel-requests/recent/route.ts',
]
for f in paths:
 s=edit(f)
 if "from '@/app/lib/trip-cancellation'" in s:
  s=s.replace("import {activeTrip,ensureTripCancellation}", "import {activeTrip,operationalTrip,ensureTripCancellation}")
  s=s.replace("import {ensureTripCancellation,activeTrip}", "import {ensureTripCancellation,activeTrip,operationalTrip}")
  s=s.replace("${activeTrip('t')}","${operationalTrip('t')}")
  s=s.replace("${activeTrip('trips')}","${operationalTrip('trips')}")
 else:
  s=s.replace("import {env} from 'cloudflare:workers';", "import {env} from 'cloudflare:workers';\nimport {ensureTripCancellation,operationalTrip} from '@/app/lib/trip-cancellation';")
  s=s.replace("COALESCE(t.canceled_at,'')=''", "${operationalTrip('t')}")
  # Insert migration before queries (for recent and whatsapp)
  if f.endswith('recent/route.ts'):
   s=s.replace("  const rows=await env.DB!", "  await ensureTripCancellation();\n  const rows=await env.DB!")
  if f.endswith('fuel-request-message/route.ts'):
   s=s.replace("  const trip=await env.DB!", "  await ensureTripCancellation();\n  const trip=await env.DB!")
 if f.endswith('fuel-request-message/route.ts'):
  s=s.replace("WHERE t.id=? AND COALESCE(t.no_fueling,0)=0", "WHERE t.id=? AND ${operationalTrip('t')} AND COALESCE(t.no_fueling,0)=0")
 save(f,s)

# Launch endpoints already use same trip validation in common; additionally mark /api/trips?launch query operational in part one.
# Individual payment reports should not read vehicle's unrelated pending request.
f='app/api/admin/reports/route.ts';s=edit(f)
s=s.replace("(SELECT fr.payment_status FROM fuel_requests fr WHERE fr.trip_id=t.id", "(SELECT fr.payment_status FROM fuel_requests fr WHERE fr.trip_id=t.id")
save(f,s)

# Setup migration also adds manual completion columns (lazily ensures current DB schema).
f='app/api/system/setup/route.ts';s=edit(f)
s=s.replace("import {ensureVehicleFuelAssignment} from '@/app/lib/vehicle-fueling-assignment';", "import {ensureVehicleFuelAssignment} from '@/app/lib/vehicle-fueling-assignment';\nimport {ensureTripCancellation} from '@/app/lib/trip-cancellation';")
s=s.replace('await ensureUserPasswordPolicy();await ensureVehicleFuelAssignment();', 'await ensureUserPasswordPolicy();await ensureTripCancellation();await ensureVehicleFuelAssignment();')
save(f,s)
print('logic patched')
