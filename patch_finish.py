from pathlib import Path
R=Path('/mnt/data/update_v152')
def upd(f,a,b):
 p=R/f;s=p.read_text()
 if a not in s:raise Exception('missing '+f+': '+a[:90])
 p.write_text(s.replace(a,b))

# Old specific mutation endpoints cannot alter finalized trips until reopened.
upd('app/api/trips/[id]/cancel-fueling/route.ts',"import {ensureTripCancellation,activeTrip}","import {ensureTripCancellation,operationalTrip}")
upd('app/api/trips/[id]/cancel-fueling/route.ts',"${activeTrip('trips')}","${operationalTrip('trips')}")
# Historical fueling info may contain finalized trips for old vehicle, but they don't appear for reuse selection.
upd('app/api/vehicle-fuel-context/route.ts',"import {activeTrip,ensureTripCancellation}","import {activeTrip,operationalTrip,ensureTripCancellation}")
upd('app/api/vehicle-fuel-context/route.ts',"${activeTrip('t')}","${operationalTrip('t')}")
# Linked authorization only from an operational trip.
p='app/api/fueling/route.ts';s=(R/p).read_text()
s=s.replace("import {requestUnusedSql} from '@/app/lib/fuel-request-usage';", "import {requestUnusedSql} from '@/app/lib/fuel-request-usage';\nimport {ensureTripCancellation,operationalTrip} from '@/app/lib/trip-cancellation';")
s=s.replace("SELECT fr.id FROM fuel_requests fr WHERE fr.vehicle_id=?", "SELECT fr.id FROM fuel_requests fr JOIN trips t ON t.id=fr.trip_id WHERE fr.vehicle_id=? AND ${operationalTrip('t')}")
s=s.replace('const request=await linkedRequest(data.vehicleId);', 'await ensureTripCancellation();const request=await linkedRequest(data.vehicleId);')
(R/p).write_text(s)
# Supplementary printed WhatsApp contains free status.
p='app/admin/reenvio-whatsapp/page.tsx';s=(R/p).read_text()
s=s.replace("'total'|'parcial'|'nao_pago'", "'total'|'parcial'|'nao_pago'|'cortesia'")
s=s.replace("request.paymentStatus==='parcial'?'Parcialmente paga':'Não paga'", "request.paymentStatus==='parcial'?'Parcialmente paga':request.paymentStatus==='cortesia'?'Cortesia (gratuita)':'Não paga'")
s=s.replace("...(payment==='Totalmente paga'?[]:[`*Valor pendente:* ${money(request.outstandingCents)}`])", "...(payment==='Totalmente paga'||payment==='Cortesia (gratuita)'?[]:[`*Valor pendente:* ${money(request.outstandingCents)}`])")
(R/p).write_text(s)

# Restrict finalize/reopen button visibility to ADM user on UI.
p='app/admin/lista-viagens/page.tsx';s=(R/p).read_text()
s=s.replace('const [finalizeMode,setFinalizeMode]=useState(false)', 'const [canFinalize,setCanFinalize]=useState(false);\n const [finalizeMode,setFinalizeMode]=useState(false)')
s=s.replace(' useEffect(()=>{void load()},[]);', ''' useEffect(()=>{void load();void fetch('/api/admin-session',{cache:'no-store'}).then(r=>r.json()).then(data=>{setCanFinalize(data.user?.groupName==='adm'||data.user?.roles?.includes('admin'));}).catch(()=>setCanFinalize(false))},[]);''')
s=s.replace('<div className="mt-5 flex flex-wrap gap-3 print:hidden"><button type="button" onClick={()=>{setFinalizeMode', '<div className="mt-5 flex flex-wrap gap-3 print:hidden">{canFinalize&&<button type="button" onClick={()=>{setFinalizeMode')
s=s.replace("'Finalizar viagens abertas'}</button>{finalizeMode&&<>", "'Finalizar viagens abertas'}</button>}{finalizeMode&&<>")
# Manage visibility of select all and confirmation remains inside final mode.
(R/p).write_text(s)
p='app/admin/admin-client.tsx';s=(R/p).read_text()
s=s.replace('  const [cars, setCars]', '  const [isAdm,setIsAdm]=useState(false);\n  const [cars, setCars]')
s=s.replace('  useEffect(() => {\n    void (async () => {\n      const setup', "  useEffect(()=>{void fetch('/api/admin-session',{cache:'no-store'}).then(r=>r.json()).then(data=>setIsAdm(data.user?.groupName==='adm'||data.user?.roles?.includes('admin'))).catch(()=>setIsAdm(false))},[]);\n  useEffect(() => {\n    void (async () => {\n      const setup")
s=s.replace('{completed&&<button type="button" onClick={async()=>', '{completed&&isAdm&&<button type="button" onClick={async()=>')
(R/p).write_text(s)
# Add explicit docs for operator.
(R/'LEIA-ME-ATUALIZACAO-V152-STATUS-MANUAL-E-CORTESIA.txt').write_text('''CONTROLE DE ABASTECIMENTO — ATUALIZAÇÃO V152\n\nBASE: v151 — IDs no rodapé do card\n\n1. Cancelar uma viagem abastecida\n   - Permitido cancelar qualquer viagem ABERTA mediante motivo, mesmo se já abastecida.\n   - O abastecimento físico, combustível, hodômetro, valores, IDs e histórico do carro permanecem.\n   - Solicitações pendentes/autorizações não utilizadas da viagem cancelada são canceladas, para não bloquear o carro.\n\n2. Cortesia\n   - Novo status "Cortesia (gratuita)" nos formulários e relatórios de pagamento.\n   - Valor total e valor em aberto obrigatoriamente R$ 0,00.\n   - Cortesia não elimina a necessidade de abastecimento, se prevista.\n\n3. Histórico de abastecimentos\n   - "Abastecimentos feitos" e "Lista de abastecimentos": registros mais recentes no topo.\n   - Critério primário data/hora do abastecimento, secundário ID do lançamento.\n\n4. Finalização manual de viagens\n   - Em "Lista de viagens", ADM aciona "Finalizar viagens abertas".\n   - Exibe apenas viagens ABERTAS, ordenadas por data da saída (decrescente), com caixas de seleção.\n   - ADM marca uma ou mais e confirma finalização.\n   - Status FINALIZADA gravado com data, usuário e ID, não derivado de número de dias.\n   - FINALIZADAS ocultas das listas e ações operacionais (pedidos normais/extraordinários, autorizações,\n     reenvio WhatsApp e vinculação para novo abastecimento).\n   - Aparecem esmaecidas em "Editar Viagens" (área administrativa), com botão "Reabrir viagem" somente ADM.\n   - Reabrir restabelece a condição ABERTA.\n   - Não houve exclusão de viagens, combustíveis, pedidos, valores, pagamentos ou histórico.\n   - Relatórios históricos e abastecimentos realizados permanecem consultáveis.\n\nMIGRAÇÃO D1: Adiciona colunas trips.finalized_at, finalized_by, finalized_by_name por ALTER TABLE,\nsem apagar registros. Executada automaticamente em /api/system/setup e na leitura das viagens.\n\nNÃO PUBLICA AUTOMATICAMENTE. Para atualizar a produção, implantar o projeto desta versão pelo\nfluxo utilizado para as versões anteriores. Preservar o banco D1 existente.\n''')
print('finishing patches')
