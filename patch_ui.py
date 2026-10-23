from pathlib import Path
root=Path('/mnt/data/update_v152')
def edit(f):return (root/f).read_text()
def save(f,s):(root/f).write_text(s)
def r(f,a,b):
 s=edit(f)
 if a not in s:raise Exception(f'{f}: {a[:90]}')
 save(f,s.replace(a,b))
# Admin edit: explicit isCompleted controls gray, and reopen button instead of automatic fade.
f='app/admin/admin-client.tsx';s=edit(f)
s=s.replace('  isCompleted?:number;','  isCompleted?:number;\n  finalizedAt?:string|null;\n  finalizedBy?:string|null;')
s=s.replace('"total" | "parcial" | "nao_pago"','"total" | "parcial" | "nao_pago" | "cortesia"').replace('"total"|"parcial"|"nao_pago"','"total"|"parcial"|"nao_pago"|"cortesia"')
s=s.replace('fetch("/api/trips", { cache: "no-store" })','fetch("/api/trips?includeFinalized=1", { cache: "no-store" })')
s=s.replace('paymentStatus==="total"?0:paymentStatus==="nao_pago"?totalValueCents:enteredOutstandingCents','paymentStatus==="total"||paymentStatus==="cortesia"?0:paymentStatus==="nao_pago"?totalValueCents:enteredOutstandingCents')
s=s.replace('if(!Number.isSafeInteger(totalValueCents)||totalValueCents<=0)return setMsg("Informe um valor total válido.");','if(!Number.isSafeInteger(totalValueCents)||(paymentStatus==="cortesia"?totalValueCents!==0:totalValueCents<=0))return setMsg(paymentStatus==="cortesia"?"Viagem cortesia deve ter valor zero.":"Informe um valor total válido.");')
s=s.replace('totalValueCents=Math.round(decimal(totalValue) * 100),','totalValueCents=paymentStatus==="cortesia"?0:Math.round(decimal(totalValue) * 100),')
s=s.replace('if(status==="total")setOutstandingValue("");if(status==="nao_pago")setOutstandingValue(totalValue)', 'if(status==="total"||status==="cortesia")setOutstandingValue("");if(status==="cortesia")setTotalValue("0,00");if(status==="nao_pago")setOutstandingValue(totalValue)')
s=s.replace('<option value="nao_pago">Não paga</option></select>', '<option value="nao_pago">Não paga</option><option value="cortesia">Cortesia (gratuita)</option></select>')
# When selecting courtesy, total in form disabled and zero; locate input
pos=s.find('Valor total da viagem')
print('price UI location:',s[pos:pos+440])
# Reopen action in edit card: only completed, clear all pending post data untouched.
needle='                    {completed&&<p className="mt-3 inline-flex rounded-full border-2 border-slate-500 bg-slate-200 px-3 py-2 text-base font-extrabold text-slate-800">✓ Viagem realizada</p>}'
replacement='''                    {completed&&<p className="mt-3 inline-flex rounded-full border-2 border-slate-500 bg-slate-200 px-3 py-2 text-base font-extrabold text-slate-800">✓ Viagem finalizada manualmente{trip.finalizedBy?` por ${trip.finalizedBy}`:""}</p>}
                    {completed&&<button type="button" onClick={async()=>{if(!window.confirm(`Reabrir ${trip.controlNumber||`V-${trip.id}`} para edição e uso nas rotinas operacionais?`))return;try{const response=await fetch(`/api/trips/${trip.id}/reopen`,{method:"POST"}),data=await response.json();if(!response.ok)throw Error(data.error||"Falha ao reabrir.");setMsg("Viagem reaberta. Voltou ao status Aberta.");await load();}catch(error){setMsg(error instanceof Error?error.message:"Falha ao reabrir a viagem.");}}} className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-[#096a9b] px-5 py-2 text-base font-extrabold text-white">Reabrir viagem</button>}'''
if needle not in s:raise Exception('completed label missing')
s=s.replace(needle,replacement)
s=s.replace('                    {Number(trip.hasLateActivity)===1', '                    {Number(trip.hasLateActivity)===1')
s=s.replace('                    {confirmId === trip.id ? (', '                    {!completed&&(confirmId === trip.id ? (')
s=s.replace('                    )}\n                    <div className="mt-5 flex justify-end">','                    ))}\n                    <div className="mt-5 flex justify-end">')
save(f,s)
# List trips: sorting + select mode with checkbox + preserve filter default and print; sorted open trips desc
f='app/admin/lista-viagens/page.tsx';s=edit(f)
s=s.replace('"total"|"parcial"|"nao_pago"','"total"|"parcial"|"nao_pago"|"cortesia"')
s=s.replace('type PaymentFilter="all"|"total"|"parcial"|"nao_pago";', 'type PaymentFilter="all"|"total"|"parcial"|"nao_pago"|"cortesia";')
s=s.replace('if(trip.paymentStatus==="total")return', 'if(trip.paymentStatus==="cortesia")return <span className="font-extrabold text-violet-800">Cortesia · gratuita</span>;if(trip.paymentStatus==="total")return')
s=s.replace('const [trips,setTrips]=useState<Trip[]>([]),[message,setMessage]=useState("Carregando viagens..."),[filter,setFilter]=useState<PaymentFilter>("all"),[from,setFrom]=useState(""),[to,setTo]=useState("");', '''const [trips,setTrips]=useState<Trip[]>([]),[message,setMessage]=useState("Carregando viagens..."),[filter,setFilter]=useState<PaymentFilter>("all"),[from,setFrom]=useState(""),[to,setTo]=useState("");
 const [finalizeMode,setFinalizeMode]=useState(false),[selected,setSelected]=useState<number[]>([]),[saving,setSaving]=useState(false);''')
s=s.replace('setTrips(data.trips||[]);setMessage("")','setTrips(data.trips||[]);setSelected([]);setMessage("")')
s=s.replace('const visible=useMemo(()=>trips.filter(trip=>{', 'const visible=useMemo(()=>trips.filter(trip=>{if(finalizeMode)return true;')
s=s.replace('return matchesPayment&&matchesFrom&&matchesTo}),[trips,filter,from,to]);', 'return matchesPayment&&matchesFrom&&matchesTo}).sort((a,b)=>finalizeMode?(b.departureDate.localeCompare(a.departureDate)||b.id-a.id):b.id-a.id),[trips,filter,from,to,finalizeMode]);')
s=s.replace('filter==="parcial"?"Parcialmente pagas":"Não pagas"','filter==="parcial"?"Parcialmente pagas":filter==="cortesia"?"Cortesia":"Não pagas"')
s=s.replace('const filterButton=', '''async function finalizeSelected(){if(saving||selected.length===0)return;if(!window.confirm(`Finalizar ${selected.length} viagem(ns)? Elas desaparecerão das telas operacionais e só poderão ser reabertas em Editar Viagens.`))return;setSaving(true);try{const response=await fetch('/api/trips/finalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tripIds:selected})}),data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível finalizar.');setFinalizeMode(false);await load();setMessage(`${data.count} viagem(ns) finalizada(s). Para reabrir, acesse Editar Viagens.`);}catch(error){setMessage(error instanceof Error?error.message:'Falha ao finalizar.');}finally{setSaving(false)}}
 const filterButton=''')
s=s.replace('{filterButton("nao_pago","Não pagos","border-red-700 bg-red-700 text-white")}', '{filterButton("nao_pago","Não pagos","border-red-700 bg-red-700 text-white")}{filterButton("cortesia","Cortesia","border-violet-700 bg-violet-700 text-white")}')
needle='<div className="trip-list-filters mt-5 rounded-2xl bg-slate-50 p-4 print:hidden">'
repl='''<div className="mt-5 flex flex-wrap gap-3 print:hidden"><button type="button" onClick={()=>{setFinalizeMode(value=>!value);setSelected([]);setMessage('')}} className={`min-h-14 rounded-xl px-5 py-3 text-base font-extrabold ${finalizeMode?'border-2 border-slate-600 bg-white text-slate-800':'bg-[#5636a3] text-white'}`}>{finalizeMode?'Voltar à lista normal':'Finalizar viagens abertas'}</button>{finalizeMode&&<><button type="button" onClick={()=>setSelected(visible.length===selected.length?[]:visible.map(item=>item.id))} className="min-h-14 rounded-xl border-2 border-[#096a9b] bg-white px-5 py-3 font-bold text-[#096a9b]">{selected.length===visible.length?'Desmarcar todas':'Selecionar todas'}</button><button type="button" disabled={saving||!selected.length} onClick={()=>void finalizeSelected()} className="min-h-14 rounded-xl bg-[#178045] px-5 py-3 font-extrabold text-white disabled:opacity-50">{saving?'Finalizando...':`Confirmar finalização (${selected.length})`}</button></>}</div>{finalizeMode&&<p className="mt-3 rounded-xl bg-violet-50 p-3 text-base font-semibold text-violet-900 print:hidden">Somente viagens ABERTAS, ordenadas pela data de saída da mais recente para a mais antiga. Marque as caixas e confirme para arquivar na operação; o histórico permanece intacto.</p>}
<div className={`trip-list-filters mt-5 rounded-2xl bg-slate-50 p-4 print:hidden ${finalizeMode?'hidden':''}`}>'''
if needle not in s:raise Exception('filter section')
s=s.replace(needle,repl)
s=s.replace('<colgroup><col className="w-[28%]"', '<colgroup>{finalizeMode&&<col className="w-[6%]"/>}<col className="w-[28%]"')
s=s.replace('<thead className="bg-[#102b43] text-white"><tr><th className="break-words p-3">Carro / viagem</th>', '<thead className="bg-[#102b43] text-white"><tr>{finalizeMode&&<th className="p-3 print:hidden">Marcar</th>}<th className="break-words p-3">Carro / viagem</th>')
s=s.replace('<tr key={trip.id} className="border-t align-top even:bg-slate-50"><td className="break-words p-3">', '<tr key={trip.id} className="border-t align-top even:bg-slate-50">{finalizeMode&&<td className="p-3 print:hidden"><input type="checkbox" aria-label={`Selecionar ${control(trip)}`} checked={selected.includes(trip.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,trip.id]:ids.filter(id=>id!==trip.id))} className="h-6 w-6 accent-[#178045]"/></td>}<td className="break-words p-3">')
s=s.replace('Consulta administrativa das viagens ativas, com pagamento e situação do abastecimento.', 'Consulta administrativa das viagens abertas, com pagamento e situação do abastecimento.')
save(f,s)
# Ordered fuelings: two admin views by actual completed data, newest first.
f='app/admin/abastecimentos-feitos/page.tsx';s=edit(f).replace('setItems(data.fueling||[]);setMessage(\'\')','setItems([...(data.fueling||[])].sort((a:Fueling,b:Fueling)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.id-a.id));setMessage(\'\')');save(f,s)
f='app/admin/lista-abastecimentos/page.tsx';s=edit(f).replace('sort==="order"?a.id-b.id','sort==="order"?b.id-a.id');save(f,s)
print('ui patched')
