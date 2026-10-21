"use client";

import { useEffect, useRef, useState } from "react";

type Trip = {
  id: number;
  vehicleId: number;
  vehicleLabel: string;
  departureDate: string;
  arrivalDate: string;
  route: string;
  totalKm: number;
  totalValueCents: number;
  controlNumber?: string;
  userIds: number[];
  noFueling?:number;
  plannedLiters?:number|null;
  requestStatus?: "missing" | "pending" | "authorized" | "fueled" | "not_required";
  fuelCanceledAt?: string;
  fuelCanceledBy?: string;
  fuelCancelReason?: string;
  hasLateActivity?: number;
  lateActivities?: {action:string;actorName:string;effectiveAt:string;registeredAt:string}[];
  paymentStatus?: "total" | "parcial" | "nao_pago";
  outstandingCents?: number;
  externalDriverNames?: string[];
};
type AppUser = {
  id: number;
  name: string;
  groupName: "motorista" | "adm" | "gerencia";
};
type Confirmation = { messages: string[]; hasConflict: boolean };
type LiveConflict = { kind: "vehicle" | "drivers" | "duplicate"; key: string; message: string; driverIds?: number[] };
type PreviousTrip={id:number;vehicleLabel:string;route:string;departureDate:string;arrivalDate:string;hasFueling:number};
type FuelDecision={previousTripId:number;previousTripOccurred:boolean;newFuelingIntent?:'request'|'skip'};
type Displacement={trip:Trip;replacementVehicleId:string;replacementPreviousTrip:PreviousTrip|null;replacementPreviousTripOccurred:boolean|null};
const decimal=(value:string)=>{const clean=value.trim();return Number(clean.includes(",")?clean.replace(/\./g,"").replace(",","."):clean)};
const formatDate = (date: string) => date.split("-").reverse().join("/");
const tripStatus = (status?: Trip["requestStatus"]) => {
  if(status==="not_required")return {icon:"—",label:"Viagem sem abastecimento",className:"border-slate-400 bg-slate-200 text-slate-900",background:"#e2e8f0",border:"#64748b"};
  if (status === "fueled")
    return { icon: "✓", label: "Combustível disponível no carro", className: "border-emerald-500 bg-emerald-100 text-emerald-950", background: "#c8f0d5", border: "#178045" };
  if (status === "authorized")
    return { icon: "✓", label: "Abastecimento autorizado", className: "border-sky-500 bg-sky-100 text-sky-950", background: "#b9dafe", border: "#2563a6" };
  if (status === "pending")
    return { icon: "!", label: "Abastecimento solicitado · aguardando autorização", className: "border-orange-500 bg-orange-100 text-orange-950", background: "#ffd6a3", border: "#c75b00" };
  return { icon: "●", label: "Sem combustível ou solicitação", className: "border-red-500 bg-red-100 text-red-950", background: "#ffd4d4", border: "#b3262b" };
};
const lateActionLabel=(action:string)=>action==='viagem_cadastrada'?'Viagem cadastrada':action==='viagem_editada'?'Viagem editada':action==='pedido_criado'?'Pedido criado':action==='autorizacao_registrada'?'Autorização registrada':'Abastecimento lançado';
const dateTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bahia'}).format(new Date(value));

export default function AdminClient({ mode = "list" }: { mode?: "list" | "new" }) {
  const today = new Date().toISOString().slice(0, 10),
    formSectionRef = useRef<HTMLElement>(null),
    queryEditLoaded=useRef(false);
  const [cars, setCars] = useState<any[]>([]),
    [trips, setTrips] = useState<Trip[]>([]),
    [users, setUsers] = useState<AppUser[]>([]);
  const [car, setCar] = useState(""),
    [lastOdometer,setLastOdometer]=useState<number|null>(null),
    [odometerMessage,setOdometerMessage]=useState(""),
    [departureDate, setDepartureDate] = useState(today),
    [arrivalDate, setArrivalDate] = useState(today),
    [route, setRoute] = useState(""),
    [totalKm, setTotalKm] = useState(""),
    [totalValue, setTotalValue] = useState(""),
    [noFueling,setNoFueling]=useState(false),[plannedLiters,setPlannedLiters]=useState(""),[originalLiters,setOriginalLiters]=useState<number|null>(null),
    [paymentStatus,setPaymentStatus]=useState<"total"|"parcial"|"nao_pago">("nao_pago"),
    [outstandingValue,setOutstandingValue]=useState(""),
    [datesConfirmed, setDatesConfirmed] = useState(false),
    [selectedDriverIds, setSelectedDriverIds] = useState<number[]>([]),
    [externalDriverNames,setExternalDriverNames]=useState<string[]>([]),
    [externalDriverName,setExternalDriverName]=useState(""),
    [editing, setEditing] = useState<number | null>(null),
    [editingVehicleId,setEditingVehicleId]=useState<number|null>(null),
    [confirmId, setConfirmId] = useState<number | null>(null),
    [cancelReason,setCancelReason]=useState(""),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [liveConflict, setLiveConflict] = useState<LiveConflict | null>(null),
    [previousTrip,setPreviousTrip]=useState<PreviousTrip|null>(null),
    [previousTripOccurred,setPreviousTripOccurred]=useState<boolean|null>(null),
    [fuelDecision,setFuelDecision]=useState<FuelDecision|null>(null),
    [vehicleConflictTrip,setVehicleConflictTrip]=useState<Trip|null>(null),
    [displacement,setDisplacement]=useState<Displacement|null>(null),
    [checkingVehicleHistory,setCheckingVehicleHistory]=useState(false),
    [acceptedConflicts, setAcceptedConflicts] = useState<string[]>([]),
    [msg, setMsg] = useState("");
  async function load() {
    const [carsResponse, tripsResponse, usersResponse] = await Promise.all([
      fetch("/api/vehicles", { cache: "no-store" }),
      fetch("/api/trips", { cache: "no-store" }),
      fetch("/api/users", { cache: "no-store" }),
    ]);
    const carsData: any = await carsResponse.json(),
      tripsData: any = await tripsResponse.json(),
      usersData: any = await usersResponse.json();
    setCars(carsData.vehicles || []);
    if (!tripsResponse.ok) throw Error(tripsData.error);
    setTrips(tripsData.trips || []);
    if (usersResponse.ok) setUsers(usersData.users || []);
  }
  useEffect(() => {
    void (async () => {
      const setup = await fetch("/api/system/setup", { method: "POST" }),
        data: any = await setup.json();
      if (!setup.ok) throw Error(data.error);
      await load();
    })().catch((error: Error) =>
      setMsg(error.message || "Não foi possível carregar os dados."),
    );
  }, []);
  useEffect(()=>{if(mode!=="list")return;const notice=window.sessionStorage.getItem("fuelVehicleTransferNotice");if(notice){window.sessionStorage.removeItem("fuelVehicleTransferNotice");setMsg(notice);}},[mode]);
  useEffect(()=>{const id=Number(new URLSearchParams(window.location.search).get("edit"));if(mode!=="new"||queryEditLoaded.current||!Number.isSafeInteger(id)||users.length===0)return;queryEditLoaded.current=true;void fetch(`/api/trips/${id}/full-edit`,{cache:"no-store"}).then(async response=>{const data:any=await response.json();if(!response.ok)throw Error(data.error);edit(data.trip)}).catch((error:Error)=>setMsg(error.message||"Não foi possível abrir a viagem para edição."));},[mode,users]);
  useEffect(()=>{
    const controller=new AbortController();
    setLastOdometer(null);
    if(!car){setOdometerMessage("");return ()=>controller.abort();}
    setOdometerMessage("Consultando última quilometragem...");
    void (async()=>{
      try{
        const response=await fetch(`/api/fueling/last-odometer?vehicleId=${encodeURIComponent(car)}`,{cache:"no-store",signal:controller.signal});
        const data=await response.json();
        if(!response.ok)throw Error(data.error||"Não foi possível consultar a quilometragem.");
        if(controller.signal.aborted)return;
        setLastOdometer(typeof data.odometer==="number"?data.odometer:null);
        setOdometerMessage(data.odometer===null?"Este carro ainda não possui quilometragem registrada.":"");
      }catch(error){if(!controller.signal.aborted)setOdometerMessage(error instanceof Error?error.message:"Não foi possível consultar a quilometragem.");}
    })();
    return ()=>controller.abort();
  },[car]);
  const drivers = users.filter((user) => user.groupName === "motorista");
  const driverName = (id: number) =>
    drivers.find((user) => user.id === id)?.name || "";
  function clear() {
    setCar("");
    setDepartureDate(today);
    setArrivalDate(today);
    setRoute("");
    setTotalKm("");
    setTotalValue("");setNoFueling(false);setPlannedLiters("");setOriginalLiters(null);
    setPaymentStatus("nao_pago");
    setOutstandingValue("");
    setDatesConfirmed(false);
    setSelectedDriverIds([]);
    setExternalDriverNames([]);
    setExternalDriverName("");
    setEditing(null);
    setEditingVehicleId(null);
    setConfirmId(null);
    setCancelReason("");
    setConfirmation(null);
    setLiveConflict(null);
    setPreviousTrip(null);
    setPreviousTripOccurred(null);
    setFuelDecision(null);
    setVehicleConflictTrip(null);
    setDisplacement(null);
    setCheckingVehicleHistory(false);
    setAcceptedConflicts([]);
  }
  function overlapping(trip: Trip) {
    return (
      trip.id !== editing &&
      trip.departureDate <= arrivalDate &&
      trip.arrivalDate >= departureDate
    );
  }
  const vehicleConflictKey = `vehicle:${car}:${departureDate}:${arrivalDate}`;
  const driversConflictKey = `drivers:${[...selectedDriverIds].sort((a, b) => a - b).join(",")}:${departureDate}:${arrivalDate}`;
  const selectedDriversCount=selectedDriverIds.length+externalDriverNames.length;
  function addExternalDriver(){
    const name=externalDriverName.trim().replace(/\s+/g," ");
    if(!name)return setMsg("Digite o nome do motorista.");
    if(selectedDriversCount>=3)return setMsg("É permitido associar no máximo 3 motoristas à viagem.");
    if(externalDriverNames.some(item=>item.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"))||drivers.some(item=>item.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR")))return setMsg("Esse motorista já está associado ou já existe na lista.");
    setExternalDriverNames(items=>[...items,name]);
    setExternalDriverName("");
    setMsg(`${name} foi incluído apenas nesta viagem, sem acesso ao app.`);
  }
  function currentConflicts() {
    const currentTrips = trips.filter(overlapping);
    const vehicleBusy = currentTrips.some((trip) => trip.vehicleId === Number(car));
    const exactDuplicate = currentTrips.some((trip) => trip.vehicleId === Number(car) && trip.departureDate === departureDate && trip.arrivalDate === arrivalDate);
    const busyDriverIds = selectedDriverIds.filter((id) => currentTrips.some((trip) => trip.userIds.includes(id)));
    return { currentTrips, vehicleBusy, exactDuplicate, busyDriverIds };
  }
  function checkVehicleConflict() {
    if (!car || !departureDate || !arrivalDate || arrivalDate < departureDate) return;
    const { vehicleBusy, exactDuplicate } = currentConflicts();
    if (vehicleBusy && !acceptedConflicts.includes(vehicleConflictKey)) {
      setLiveConflict({ kind: "vehicle", key: vehicleConflictKey, message: "JÁ TEM VIAGEM PARA ESTE CARRO NESTA DATA. HÁ COMPATIBILIDADE DE HORÁRIO?" });
      return;
    }
  }
  function finishDatesConfirmation() {
    if (!car || !departureDate || !arrivalDate || arrivalDate < departureDate) {
      setMsg("Selecione o veículo e informe corretamente a saída e a chegada antes de confirmar as datas.");
      return;
    }
    const { vehicleBusy, exactDuplicate } = currentConflicts();
    if (vehicleBusy && !acceptedConflicts.includes(vehicleConflictKey)) {
      setDatesConfirmed(false);
      setLiveConflict({ kind: "vehicle", key: vehicleConflictKey, message: "JÁ TEM VIAGEM PARA ESTE CARRO NESTA DATA. HÁ COMPATIBILIDADE DE HORÁRIO?" });
      return;
    }
    setDatesConfirmed(true);
    setMsg("Carro e datas aceitos ✓ Agora informe os demais dados da viagem.");
  }
  async function confirmDates() {
    if (!car || !departureDate || !arrivalDate || arrivalDate < departureDate || (editing!==null&&Number(car)===editingVehicleId)) return finishDatesConfirmation();
    const {currentTrips,vehicleBusy}=currentConflicts();
    const sameCar=currentTrips.filter(trip=>trip.vehicleId===Number(car));
    if(editing===null&&vehicleBusy&&!acceptedConflicts.includes(vehicleConflictKey)&&!displacement){
      if(sameCar.length!==1)return setMsg('Este carro está em mais de uma viagem no período. Edite as viagens já cadastradas antes de destiná-lo somente para esta nova viagem.');
      setVehicleConflictTrip(sameCar[0]);
      return;
    }
    try{
      setCheckingVehicleHistory(true);
      const response=await fetch(`/api/vehicle-fuel-context?vehicleId=${encodeURIComponent(car)}&excludeTripId=${encodeURIComponent(editing||0)}&referenceDate=${encodeURIComponent(departureDate)}`,{cache:'no-store'}),data:any=await response.json();
      if(!response.ok)throw Error(data.error||'Não foi possível verificar o histórico do veículo.');
      const trip=data.previousTrip as PreviousTrip|null;
      if(trip&&fuelDecision?.previousTripId!==trip.id){setPreviousTrip(trip);return;}
      finishDatesConfirmation();
    }catch(error){setMsg(error instanceof Error?error.message:'Não foi possível verificar o histórico do veículo.');}
    finally{setCheckingVehicleHistory(false);}
  }
  function beginDisplacementHistory(){
    if(!displacement)return;
    setAcceptedConflicts(items=>items.includes(vehicleConflictKey)?items:[...items,vehicleConflictKey]);
    setPreviousTrip(displacement.trip);
    setPreviousTripOccurred(null);
  }
  async function checkReplacementVehicle(){
    if(!displacement?.replacementVehicleId)return setMsg('Escolha o carro que ficará na viagem anterior.');
    try{
      const response=await fetch(`/api/vehicle-fuel-context?vehicleId=${encodeURIComponent(displacement.replacementVehicleId)}&excludeTripId=${encodeURIComponent(displacement.trip.id)}&referenceDate=${encodeURIComponent(displacement.trip.departureDate)}`,{cache:'no-store'}),data:any=await response.json();
      if(!response.ok)throw Error(data.error||'Não foi possível verificar o carro substituto.');
      const previous=data.previousTrip as PreviousTrip|null;
      if(previous&&Number(previous.hasFueling)===1){setDisplacement({...displacement,replacementPreviousTrip:previous,replacementPreviousTripOccurred:null});return;}
      beginDisplacementHistory();
    }catch(error){setMsg(error instanceof Error?error.message:'Não foi possível verificar o carro substituto.');}
  }
  useEffect(() => {
    if (!datesConfirmed || !selectedDriverIds.length || liveConflict) return;
    const { busyDriverIds } = currentConflicts();
    if (busyDriverIds.length && !acceptedConflicts.includes(driversConflictKey)) setLiveConflict({ kind: "drivers", key: driversConflictKey, driverIds: busyDriverIds, message: `Já existe viagem no período informado para: ${busyDriverIds.map(driverName).filter(Boolean).join(", ")}. Há compatibilidade de horário?` });
  }, [datesConfirmed, selectedDriverIds, trips, editing, acceptedConflicts, liveConflict, car, departureDate, arrivalDate]);
  function askBeforeSaving(event: React.FormEvent) {
    event.preventDefault();
    if (!datesConfirmed) return setMsg("Confirme carro e datas antes de salvar a viagem.");
    const messages: string[] = [];
    if (editing === null && selectedDriversCount === 1)
      messages.push(
        `Você selecionou apenas ${driverName(selectedDriverIds[0])||externalDriverNames[0]}. Confirma que será o único motorista desta viagem?`,
      );
    const { vehicleBusy, exactDuplicate, busyDriverIds } = currentConflicts();
    if (vehicleBusy && !acceptedConflicts.includes(vehicleConflictKey))
      messages.push(
        "JÁ TEM VIAGEM PARA ESTE CARRO NESTA DATA. HÁ COMPATIBILIDADE DE HORÁRIO?",
      );
    const busyDrivers = busyDriverIds
      .map(driverName)
      .filter(Boolean);
    if (busyDrivers.length && !acceptedConflicts.includes(driversConflictKey))
      messages.push(
        `Já existe viagem no mesmo período para: ${busyDrivers.join(", ")}. Há compatibilidade de horário?`,
      );
    if (messages.length) {
      setConfirmation({
        messages,
        hasConflict:
          vehicleBusy ||
          busyDrivers.length > 0,
      });
      return;
    }
    void persist(vehicleBusy || busyDrivers.length > 0);
  }
  async function persist(allowConflicts: boolean) {
    const wasEditing = editing !== null,
      totalValueCents=Math.round(decimal(totalValue) * 100),
      enteredOutstandingCents=Math.round(decimal(outstandingValue) * 100),
      outstandingCents=paymentStatus==="total"?0:paymentStatus==="nao_pago"?totalValueCents:enteredOutstandingCents;
    const restored=plannedLiters.trim()?decimal(plannedLiters):originalLiters;
    if(restored!==null&&(!Number.isFinite(restored)||restored<=0))return setMsg("Informe uma quantidade de litros maior que zero.");
    if(!plannedLiters.trim()&&originalLiters!==null)setPlannedLiters(String(originalLiters).replace(".",","));
    if(!Number.isSafeInteger(totalValueCents)||totalValueCents<=0)return setMsg("Informe um valor total válido.");
    if(paymentStatus==="total"&&outstandingCents!==0)return setMsg("Viagem totalmente paga não pode ter valor em aberto.");
    if(wasEditing&&paymentStatus==="parcial"&&(!Number.isSafeInteger(outstandingCents)||outstandingCents<=0||outstandingCents>=totalValueCents))return setMsg("No pagamento parcial, o valor em aberto deve ser maior que zero e menor que o valor total.");
    if(wasEditing&&paymentStatus==="nao_pago"&&outstandingCents!==totalValueCents)return setMsg("Em viagem não paga, o valor em aberto deve ser igual ao valor total.");
    const response = await fetch(editing ? `/api/trips/${editing}/full-edit` : "/api/trips", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: Number(car),
          departureDate,
          arrivalDate,
          route,
          totalKm: Number(totalKm),
          totalValueCents,
          noFueling,plannedLiters:restored,
          associatedUserIds: selectedDriverIds,
          externalDriverNames,
          paymentStatus,
          outstandingCents,
          allowConflicts,
          previousTripId:fuelDecision?.previousTripId,
          previousTripOccurred:fuelDecision?.previousTripOccurred,
          newFuelingIntent:fuelDecision?.newFuelingIntent,
          displacedTripId:displacement?.trip.id,
          replacementVehicleId:displacement?Number(displacement.replacementVehicleId):undefined,
          replacementPreviousTripId:displacement?.replacementPreviousTrip?.id,
          replacementPreviousTripOccurred:displacement?.replacementPreviousTripOccurred,
        }),
      }),
      data: any = await response.json();
    if (!response.ok) {
      setConfirmation(null);
      return setMsg(data.error || "Não foi possível salvar.");
    }
    setConfirmation(null);
    await load();
    if (wasEditing) {
      const notice=data.vehicleChanged
        ?data.receivedFuelingId
          ?"Veículo atualizado. O abastecimento inicial foi reconhecido no novo carro. A viagem anterior poderá solicitar abastecimento com o veículo substituto."
          :data.releasedFuelingId
            ?"Veículo atualizado. O abastecimento inicial continua com o carro original. Esta viagem só aparecerá abastecida quando o carro substituto receber um abastecimento válido."
            :"Veículo atualizado. Esta viagem deverá solicitar abastecimento, caso o novo carro ainda não tenha combustível inicial vinculado."
        :"Viagem atualizada com sucesso.";
      window.sessionStorage.setItem("fuelVehicleTransferNotice",notice);
      setMsg(notice);
      const destination=new URLSearchParams(window.location.search).get("return")||"/admin/viagens";
      if(destination.startsWith("/")&&!destination.startsWith("//")){window.location.assign(destination);return;}
      window.location.assign("/admin/viagens");
      return;
    }
    clear();
    setMsg(data.displacedTripUpdated?data.receivedFuelingId?"Viagem salva. O carro foi trocado entre as viagens e o abastecimento real acompanhou o veículo.":data.replacementReceivedFuelingId?"Viagem salva. A viagem anterior recebeu o carro substituto já abastecido.":"Viagem salva. A viagem anterior recebeu o carro substituto; pedidos ainda não utilizados permaneceram nela.":data.receivedFuelingId?"Viagem salva. Como a viagem anterior não aconteceu, o abastecimento já registrado acompanhou este carro; não é necessário solicitar novamente.":noFueling?"Viagem salva sem solicitação de abastecimento. O formulário foi limpo para iniciar outro cadastro.":"Viagem salva com sucesso. O formulário foi limpo para iniciar outro cadastro.");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }
  function edit(trip: Trip) {
    setEditing(trip.id);setEditingVehicleId(trip.vehicleId);setNoFueling(Number(trip.noFueling)===1);setOriginalLiters(trip.plannedLiters??null);setPlannedLiters(trip.plannedLiters==null?"":String(trip.plannedLiters).replace(".",","));
    setCar(String(trip.vehicleId));
    setDepartureDate(trip.departureDate);
    setArrivalDate(trip.arrivalDate);
    setRoute(trip.route);
    setTotalKm(String(trip.totalKm || ""));
    setTotalValue(((trip.totalValueCents || 0) / 100).toFixed(2).replace(".", ","));
    setPaymentStatus(trip.paymentStatus||"nao_pago");
    setOutstandingValue(((trip.outstandingCents ?? trip.totalValueCents ?? 0) / 100).toFixed(2).replace(".", ","));
    setDatesConfirmed(true);
    setSelectedDriverIds(
      trip.userIds.filter((id) => drivers.some((driver) => driver.id === id)),
    );
    setExternalDriverNames(trip.externalDriverNames||[]);
    setMsg("Editando a viagem selecionada.");
    formSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  async function remove(trip: Trip) {
    if(cancelReason.trim().length<3)return setMsg("Informe o motivo do cancelamento antes de confirmar.");
    const response = await fetch(`/api/trips/${trip.id}`, {
        method: "DELETE",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({reason:cancelReason.trim()}),
        cache: "no-store",
      }),
      data: any = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg(data.error || "Não foi possível apagar.");
    setTrips((items) => items.filter((item) => item.id !== trip.id));
    setConfirmId(null);
    setCancelReason("");
    setMsg("Viagem cancelada e removida da lista operacional.");
  }
  return (
    <main className="min-h-screen bg-[#f3f6f9] p-5">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => window.location.assign("/admin")} className="h-14 rounded-xl border-2 border-slate-500 bg-white px-3 text-lg font-bold text-slate-700">Voltar para Área Adm</button>{mode !== "list"&&<button type="button" onClick={() => window.location.assign("/admin/viagens")} className="h-14 rounded-xl border-2 border-[#1677d8] bg-white px-3 text-lg font-bold text-[#1677d8]">Editar viagens</button>}</div>
        {mode !== "list" && <>
        <section
          ref={formSectionRef}
          className="rounded-3xl bg-white p-7 shadow"
        >
          <h1 className="text-3xl font-bold">
            {editing ? "Editar viagem" : "Lançar viagem"}
          </h1>
          <p className="mt-2 text-lg">Área exclusiva do administrador.</p>
          <form onSubmit={askBeforeSaving} className="mt-6 space-y-5">
            <label className="block text-lg font-bold">
              Veículo
              <select
                value={car}
                onChange={(event) => { setCar(event.target.value); setDatesConfirmed(false); setAcceptedConflicts([]); setFuelDecision(null); setPreviousTrip(null); setPreviousTripOccurred(null); setVehicleConflictTrip(null); setDisplacement(null); }}
                required
                className="mt-2 h-16 w-full rounded-xl border p-3 text-2xl"
              >
                <option value="">Selecione</option>
                {cars.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {car&&<div role="status" aria-live="polite" className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-base font-bold text-[#075579]">Última quilometragem salva do carro</p>
              {lastOdometer!==null?<><p className="mt-1 text-2xl font-extrabold tabular-nums text-[#102b43]">{lastOdometer.toLocaleString("pt-BR")} km</p><p className="mt-2 text-sm text-slate-600">Obtida dos abastecimentos lançados. A quilometragem total da viagem é preenchida separadamente.</p></>:<p className="mt-2 text-base text-slate-600">{odometerMessage}</p>}
            </div>}
            <div className="grid grid-cols-2 gap-5">
              <label className="block min-w-0 text-lg font-bold">
                Saída
                <input
                  type="date"
                  value={departureDate}
                  onChange={(event) => {
                    setDepartureDate(event.target.value);
                    setDatesConfirmed(false);
                    setAcceptedConflicts([]);
                    setFuelDecision(null);setPreviousTrip(null);setPreviousTripOccurred(null);setVehicleConflictTrip(null);setDisplacement(null);
                    if (arrivalDate < event.target.value)
                      setArrivalDate(event.target.value);
                  }}
                  className="mt-2 h-16 min-w-0 w-full rounded-xl border p-3 text-lg"
                />
              </label>
              <label className="block min-w-0 text-lg font-bold">
                Chegada
                <input
                  type="date"
                  min={departureDate}
                  value={arrivalDate}
                  onChange={(event) => { setArrivalDate(event.target.value); setDatesConfirmed(false); setAcceptedConflicts([]); setFuelDecision(null);setPreviousTrip(null);setPreviousTripOccurred(null);setVehicleConflictTrip(null);setDisplacement(null); }}
                  className="mt-2 h-16 min-w-0 w-full rounded-xl border p-3 text-lg"
                />
              </label>
            </div>
            <button type="button" onClick={confirmDates} className={`min-h-12 w-full rounded-xl border-2 px-4 py-2 text-lg font-bold ${datesConfirmed ? "border-[#178045] bg-[#178045] text-white" : "border-[#1677d8] bg-[#eaf4ff] text-[#075a9f]"}`}>
              {checkingVehicleHistory ? "Verificando histórico do carro..." : datesConfirmed ? "✓ Carro e datas aceitos" : "Confirmar carro e datas"}
            </button>
            <label className="block text-lg font-bold">
              Quilometragem total da viagem
              <input
                required
                min="1"
                inputMode="numeric"
                type="number"
                value={totalKm}
                onChange={(event) => setTotalKm(event.target.value)}
                placeholder="Ex.: 320"
                className="mt-2 h-16 w-full rounded-xl border p-3 text-2xl"
              />
            </label>
            <label className="block text-lg font-bold">
              Valor total da viagem (R$)
              <input
                required
                min="0.01"
                inputMode="decimal"
                type="text"
                value={totalValue}
                onChange={(event) => setTotalValue(event.target.value)}
                placeholder="Ex.: 1.250,00"
                className="mt-2 h-16 w-full rounded-xl border p-3 text-2xl"
              />
            </label>
            <label className="block rounded-xl border-2 border-[#0b7184] bg-sky-50 p-4 text-lg font-bold">Esta viagem terá abastecimento?<select value={noFueling?"nao":"sim"} onChange={event=>setNoFueling(event.target.value==="nao")} className="mt-2 min-h-14 w-full rounded-xl border bg-white p-3 text-xl"><option value="sim">Sim</option><option value="nao">Não — sem solicitação, autorização ou abastecimento</option></select><span className="mt-2 block text-sm font-normal">Você pode mudar esta opção na edição. O histórico já registrado será preservado.</span></label>
            {!noFueling&&<label className="block text-lg font-bold">Litros previstos / solicitados<input inputMode="decimal" value={plannedLiters} onChange={event=>setPlannedLiters(event.target.value)} placeholder="Opcional: ex. 100,50" className="mt-2 h-16 w-full rounded-xl border p-3 text-2xl"/><span className="mt-2 block text-sm font-normal text-slate-600">Na edição, se salvar este campo vazio, os litros anteriores serão mantidos.</span></label>}
            {<><label className="block text-lg font-bold">Situação de pagamento<select value={paymentStatus} onChange={(event)=>{const status=event.target.value as "total"|"parcial"|"nao_pago";setPaymentStatus(status);if(status==="total")setOutstandingValue("");if(status==="nao_pago")setOutstandingValue(totalValue)}} className="mt-2 h-16 w-full rounded-xl border bg-white p-3 text-xl"><option value="total">Totalmente paga</option><option value="parcial">Parcialmente paga</option><option value="nao_pago">Não paga</option></select></label>{paymentStatus==="parcial"&&<label className="block text-lg font-bold">Valor em aberto (R$)<input required inputMode="decimal" value={outstandingValue} onChange={(event)=>setOutstandingValue(event.target.value)} placeholder="Ex.: 350,00" className="mt-2 h-16 w-full rounded-xl border p-3 text-2xl"/></label>}</>}
            <label className="block text-lg font-bold">
              Roteiro
              <textarea
                value={route}
                onChange={(event) => setRoute(event.target.value)}
                required
                maxLength={300}
                className="mt-2 min-h-32 w-full rounded-xl border p-3 text-2xl"
              />
            </label>
            <fieldset className="rounded-2xl border p-4">
              <legend className="px-2 text-lg font-bold">
                Motoristas associados à viagem
              </legend>
              <p className="mb-3 text-base text-slate-600">
                Selecione ou informe até 3 motoristas. Adm e Gerência são associados
                automaticamente.
              </p>
              {drivers.length === 0 ? (
                <p className="text-base">
                  Cadastre motoristas em Configurações.
                </p>
              ) : (
                <div className="space-y-2">
                  {drivers.map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-lg"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDriverIds.includes(user.id)}
                        disabled={
                          !selectedDriverIds.includes(user.id) &&
                          selectedDriversCount >= 3
                        }
                        onChange={(event) =>
                          setSelectedDriverIds((ids) =>
                            event.target.checked
                              ? [...ids, user.id]
                              : ids.filter((id) => id !== user.id),
                          )
                        }
                        className="h-5 w-5 accent-[#178045] disabled:opacity-40"
                      />
                      <span>{user.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="mt-4 rounded-xl border-2 border-dashed border-[#096a9b] bg-[#eaf6fa] p-4">
                <p className="text-lg font-bold text-[#075579]">Motorista não está na lista?</p>
                <p className="mt-1 text-base text-slate-600">Inclua somente o nome para esta viagem. Isso não cria usuário, senha ou acesso ao app.</p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <input value={externalDriverName} onChange={(event)=>setExternalDriverName(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();addExternalDriver();}}} disabled={selectedDriversCount>=3} placeholder="Nome do motorista" className="h-12 min-w-0 flex-1 rounded-lg border bg-white px-3 text-lg disabled:bg-slate-100"/>
                  <button type="button" onClick={addExternalDriver} disabled={selectedDriversCount>=3} className="min-h-12 rounded-lg bg-[#096a9b] px-4 py-2 text-lg font-bold text-white disabled:opacity-50">Adicionar nome</button>
                </div>
                {externalDriverNames.length>0&&<div className="mt-3 flex flex-wrap gap-2">{externalDriverNames.map(name=><span key={name} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-base font-bold text-[#102b43]">{name}<button type="button" onClick={()=>setExternalDriverNames(items=>items.filter(item=>item!==name))} aria-label={`Remover ${name}`} className="grid h-6 w-6 place-items-center rounded-full bg-red-100 text-lg text-[#b3262b]">×</button></span>)}</div>}
              </div>
            </fieldset>
            <div className="flex gap-3">
              <button className="h-14 flex-1 rounded-xl bg-[#178045] text-xl font-bold text-white">
                {editing ? "Salvar alterações" : "Salvar viagem"}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    setMsg("Edição cancelada. O formulário foi limpo.");
                  }}
                  className="h-14 rounded-xl border px-4 text-lg"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
          {msg && (
            <p role="status" className="mt-5 rounded-xl bg-sky-50 p-4 text-lg">
              {msg}
            </p>
          )}
        </section>
        </>}
        {vehicleConflictTrip && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-5">
            <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-[#b3262b]"><span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#b3262b] text-3xl font-black text-white">!</span><h2 className="text-2xl font-extrabold leading-tight">CARRO JÁ ASSOCIADO</h2></div>
              <p className="mt-4 text-lg font-bold text-slate-800">{vehicleConflictTrip.vehicleLabel} já está na {vehicleConflictTrip.controlNumber||`V-${String(vehicleConflictTrip.id).padStart(6,"0")}`}: {vehicleConflictTrip.route}.</p>
              <p className="mt-3 text-base text-slate-600">Escolha se o carro atenderá as duas viagens ou se será trocado para ficar somente nesta nova viagem.</p>
              <div className="mt-6 grid gap-3"><button type="button" onClick={()=>{setAcceptedConflicts(items=>items.includes(vehicleConflictKey)?items:[...items,vehicleConflictKey]);setVehicleConflictTrip(null);setDatesConfirmed(true);setMsg('O carro permanecerá nas duas viagens. Continue o cadastro normalmente.');}} className="min-h-16 rounded-xl bg-[#178045] px-4 py-3 text-left text-lg font-bold text-white"><span className="block">Usar o carro nas duas viagens</span><span className="mt-1 block text-sm font-medium">Mantém as duas viagens com o mesmo carro; não transfere combustível automaticamente.</span></button><button type="button" onClick={()=>{setVehicleConflictTrip(null);setDisplacement({trip:vehicleConflictTrip,replacementVehicleId:"",replacementPreviousTrip:null,replacementPreviousTripOccurred:null});}} className="min-h-16 rounded-xl border-2 border-[#096a9b] bg-white px-4 py-3 text-left text-lg font-bold text-[#075579]"><span className="block">Usar o carro somente nesta viagem</span><span className="mt-1 block text-sm font-medium">Será obrigatório definir agora o carro substituto da viagem anterior.</span></button></div>
              <button type="button" onClick={()=>{setVehicleConflictTrip(null);setCar("");setDatesConfirmed(false);setMsg('Selecione outro carro ou revise as datas.');}} className="mt-4 min-h-12 w-full rounded-xl border px-4 py-2 text-base font-bold text-slate-700">Cancelar e escolher outro carro</button>
            </section>
          </div>
        )}
        {displacement && !previousTrip && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-5">
            <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center gap-3 rounded-2xl bg-sky-50 p-4 text-[#075579]"><span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#096a9b] text-3xl font-black text-white">↔</span><h2 className="text-2xl font-extrabold leading-tight">DEFINIR CARRO SUBSTITUTO</h2></div>
              <p className="mt-4 text-lg font-bold text-slate-800">A {displacement.trip.controlNumber||`V-${String(displacement.trip.id).padStart(6,"0")}`} ficará sem carro. Escolha o veículo que ficará nela antes de salvar esta nova viagem.</p>
              {!displacement.replacementPreviousTrip?<><label className="mt-5 block text-lg font-bold">Carro para {displacement.trip.controlNumber||`V-${String(displacement.trip.id).padStart(6,"0")}`}<select value={displacement.replacementVehicleId} onChange={event=>setDisplacement({...displacement,replacementVehicleId:event.target.value})} className="mt-2 h-14 w-full rounded-xl border bg-white p-3 text-lg"><option value="">Selecione</option>{cars.filter(item=>Number(item.id)!==Number(car)&&!trips.some(trip=>trip.id!==displacement.trip.id&&trip.vehicleId===Number(item.id)&&trip.departureDate<=displacement.trip.arrivalDate&&trip.arrivalDate>=displacement.trip.departureDate)).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" onClick={()=>void checkReplacementVehicle()} className="mt-6 min-h-14 w-full rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold text-white">Confirmar carro substituto</button></>:<><div className="mt-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-lg"><p className="font-extrabold">O carro substituto possui abastecimento registrado em outra viagem.</p><p className="mt-2">{displacement.replacementPreviousTrip.route}</p></div><p className="mt-5 text-xl font-extrabold text-slate-900">Essa viagem anterior aconteceu?</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={()=>{setDisplacement({...displacement,replacementPreviousTripOccurred:true});beginDisplacementHistory();}} className="min-h-14 rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold text-white">Sim, aconteceu</button><button type="button" onClick={()=>{setDisplacement({...displacement,replacementPreviousTripOccurred:false});beginDisplacementHistory();}} className="min-h-14 rounded-xl border-2 border-[#096a9b] bg-white px-4 py-2 text-lg font-bold text-[#075579]">Não, não aconteceu</button></div></>}
              <button type="button" onClick={()=>{setDisplacement(null);setCar("");setDatesConfirmed(false);setMsg('Troca cancelada. Escolha outro carro.');}} className="mt-4 min-h-12 w-full rounded-xl border px-4 py-2 text-base font-bold text-slate-700">Cancelar troca</button>
            </section>
          </div>
        )}
        {previousTrip && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-5">
            <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 text-[#8a5600]"><span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#d38b00] text-3xl font-black text-white">!</span><h2 className="text-2xl font-extrabold leading-tight">HISTÓRICO DO CARRO</h2></div>
              <p className="mt-4 text-lg font-bold text-slate-800">Este carro já está cadastrado em outra viagem:</p>
              <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-lg"><p className="font-extrabold">{previousTrip.vehicleLabel}</p><p className="mt-1">{previousTrip.route}</p><p className="mt-2 text-base">Período: {formatDate(previousTrip.departureDate)} a {formatDate(previousTrip.arrivalDate)}</p>{Number(previousTrip.hasFueling)===1&&<p className="mt-3 rounded-lg bg-sky-100 px-3 py-2 text-base font-extrabold text-sky-900">Este carro possui abastecimento registrado para essa viagem.</p>}</div>
              {previousTripOccurred!==true?<><p className="mt-5 text-xl font-extrabold text-slate-900">O combustível da viagem anterior foi utilizado?</p><p className="mt-2 text-base text-slate-600">Se não foi utilizado, o combustível permanece disponível no carro para esta nova viagem.</p><div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={()=>setPreviousTripOccurred(true)} className="min-h-14 rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold text-white">Sim, foi utilizado</button><button type="button" onClick={()=>{setFuelDecision({previousTripId:previousTrip.id,previousTripOccurred:false});setNoFueling(false);setPreviousTrip(null);setPreviousTripOccurred(null);finishDatesConfirmation();}} className="min-h-14 rounded-xl border-2 border-[#096a9b] bg-white px-4 py-2 text-lg font-bold text-[#075579]">Não, permanece no carro</button></div></>:<><p className="mt-5 text-xl font-extrabold text-slate-900">Haverá novo abastecimento para esta viagem?</p><p className="mt-2 text-base text-slate-600">Como o combustível anterior foi utilizado, escolha se esta viagem seguirá o fluxo normal ou ficará sem abastecimento.</p><div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={()=>{setFuelDecision({previousTripId:previousTrip.id,previousTripOccurred:true,newFuelingIntent:'request'});setNoFueling(false);setPreviousTrip(null);setPreviousTripOccurred(null);finishDatesConfirmation();}} className="min-h-14 rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold text-white">Sim, solicitar abastecimento</button><button type="button" onClick={()=>{setFuelDecision({previousTripId:previousTrip.id,previousTripOccurred:true,newFuelingIntent:'skip'});setNoFueling(true);setPreviousTrip(null);setPreviousTripOccurred(null);finishDatesConfirmation();}} className="min-h-14 rounded-xl border-2 border-slate-600 bg-slate-100 px-4 py-2 text-lg font-bold text-slate-900">Não, viagem sem abastecimento</button></div><p className="mt-3 text-sm font-medium text-slate-600">A viagem ficará cinza, sem solicitação ou pendência, e poderá ser alterada depois em Editar viagem.</p></>}
              <button type="button" onClick={()=>{setPreviousTrip(null);setPreviousTripOccurred(null);setDisplacement(null);setCar('');setDatesConfirmed(false);setMsg('Selecione outro carro ou revise a viagem anterior.');}} className="mt-4 min-h-12 w-full rounded-xl border px-4 py-2 text-base font-bold text-slate-700">Cancelar e alterar carro</button>
            </section>
          </div>
        )}
        {confirmation && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-5">
            <section
              role="dialog"
              aria-modal="true"
              className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
            >
              <h2 className="text-2xl font-bold text-[#b3262b]">
                Confirmação necessária
              </h2>
              <div className="mt-4 space-y-3 text-lg">
                {confirmation.messages.map((message, index) => (
                  <p key={index} className="rounded-xl bg-amber-50 p-3">
                    {message}
                  </p>
                ))}
              </div>
              <p className="mt-4 text-base text-slate-600">
                Se não houver compatibilidade de horário, cancele. A viagem não
                será registrada.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void persist(confirmation.hasConflict)}
                  className="min-h-14 rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold text-white"
                >
                  {confirmation.hasConflict
                    ? "Sim, há compatibilidade"
                    : "Sim, confirmar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmation(null);
                    setMsg(
                      "Cadastro cancelado. Nenhuma viagem foi registrada.",
                    );
                  }}
                  className="min-h-14 rounded-xl border-2 border-[#b3262b] px-4 py-2 text-lg font-bold text-[#b3262b]"
                >
                  Não, cancelar
                </button>
              </div>
            </section>
          </div>
        )}
        {liveConflict && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-5">
            <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-[#b3262b]"><span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#b3262b] text-3xl font-black text-white">!</span><h2 className="text-2xl font-extrabold leading-tight">ALERTA DE CONFLITO</h2></div>
              <p className="mt-4 rounded-xl border-2 border-[#b3262b] bg-amber-50 p-4 text-xl font-extrabold leading-snug text-[#7f1d1d]">{liveConflict.message}</p>
              {liveConflict.kind === "vehicle"&&<p className="mt-3 text-lg font-bold text-slate-700">Confirme somente se os horários realmente não se cruzam.</p>}
              {liveConflict.kind === "duplicate" ? <button type="button" onClick={() => { setLiveConflict(null); setCar(""); setDatesConfirmed(false); setMsg("Selecione outro carro ou altere as datas da viagem."); }} className="mt-6 min-h-14 w-full rounded-xl bg-[#1677d8] px-4 py-2 text-lg font-bold text-white">Entendi, alterar cadastro</button> : <div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => { const conflict=liveConflict; setAcceptedConflicts((items) => [...items, conflict.key]); setLiveConflict(null); if(conflict.kind==='vehicle')setDatesConfirmed(true); setMsg(conflict.kind==='vehicle'?"Carro e datas aceitos ✓ Você pode continuar o cadastro.":"Compatibilidade de horário confirmada. Você pode continuar o cadastro."); }} className="min-h-14 rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold text-white">Sim, há compatibilidade</button><button type="button" onClick={() => { const conflict = liveConflict; setLiveConflict(null); setDatesConfirmed(false); if (conflict.kind === "vehicle") setCar(""); else setSelectedDriverIds((ids) => ids.filter((id) => !conflict.driverIds?.includes(id))); setMsg(conflict.kind === "vehicle" ? "Selecione outro carro ou altere as datas." : "Selecione outro motorista."); }} className="min-h-14 rounded-xl border-2 border-[#b3262b] px-4 py-2 text-lg font-bold text-[#b3262b]">Não, alterar seleção</button></div>}
            </section>
          </div>
        )}
        {mode !== "new" && <section className="mt-7">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-bold">Abastecimentos</h2><p className="mt-1 text-base text-slate-600">Acompanhe solicitações, autorizações e lançamentos. A mais recente aparece no topo.</p></div><div className="grid gap-2 sm:flex"><button type="button" onClick={() => window.location.assign("/admin/lista-viagens")} className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl border-2 border-[#5636a3] bg-white px-4 py-3 text-center text-base font-bold leading-tight text-[#5636a3] sm:px-5 sm:text-lg">Lista de viagens</button><button type="button" onClick={() => window.location.assign("/admin/viagens/canceladas")} className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl border-2 border-[#b3262b] bg-white px-4 py-3 text-center text-base font-bold leading-tight text-[#b3262b] sm:px-5 sm:text-lg">Canceladas</button><button type="button" onClick={() => window.location.assign("/admin/viagens/nova")} className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl bg-[#1677d8] px-4 py-3 text-center text-base font-bold leading-tight text-white sm:px-5 sm:text-lg">+ Incluir nova viagem</button></div></div>
          {trips.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-lg">
              Nenhuma viagem salva.
            </p>
          ) : (
            <div className="space-y-4">
              {trips.map((trip) => {
                const names = [...trip.userIds
                  .filter((id) => drivers.some((driver) => driver.id === id))
                  .map(driverName)
                  .filter(Boolean),...(trip.externalDriverNames||[])];
                const status = Number(trip.noFueling)===1 ? tripStatus("not_required") : trip.fuelCanceledAt ? {icon:"×",label:"Abastecimento cancelado",className:"border-slate-400 bg-slate-200 text-slate-900",background:"#d9e0e8",border:"#64748b"} : tripStatus(trip.requestStatus);
                return (
                  <article
                    key={trip.id}
                    className="rounded-2xl border-2 p-5 text-slate-900 shadow-sm"
                    data-trip-status={trip.noFueling ? "not_required" : trip.fuelCanceledAt ? "canceled" : trip.requestStatus || "missing"}
                    style={{backgroundColor:status.background,borderColor:status.border,color:"#0f172a"}}
                  >
                    <p className="inline-flex rounded-full bg-[#102b43] px-3 py-1 text-base font-extrabold text-white">Controle: {trip.controlNumber||`V-${String(trip.id).padStart(6,"0")}`}</p>
                    {Number(trip.hasLateActivity)===1&&<p className="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-amber-500 bg-amber-100 px-3 py-2 text-base font-extrabold text-amber-950"><span className="text-xl" aria-hidden="true">⚠</span>MOVIMENTAÇÃO FORA DO PRAZO</p>}
                    {(trip.lateActivities||[]).map((activity,index)=><p key={index} className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">⚠ {lateActionLabel(activity.action)} por {activity.actorName}. Data do fato: {dateTime(activity.effectiveAt)} · registrado no app: {dateTime(activity.registeredAt)}.</p>)}
                    {trip.fuelCanceledAt&&<p className="mt-3 text-base font-semibold">Cancelado por {trip.fuelCanceledBy||"Não informado"} em {dateTime(trip.fuelCanceledAt)}. Motivo: {trip.fuelCancelReason}</p>}
                    <p className="text-xl font-bold">{trip.vehicleLabel}</p>
                    <p className="mt-1 text-lg">
                      {formatDate(trip.departureDate)} até{" "}
                      {formatDate(trip.arrivalDate)}
                    </p>
                    <p className={`mt-3 inline-flex items-center gap-2 rounded-full border-2 px-3 py-2 text-base font-extrabold ${status.className}`}>
                      <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-current text-lg leading-none" aria-hidden="true">{status.icon}</span>
                      {status.label}
                    </p>
                    <p className="mt-2 text-lg text-slate-700">{trip.route}</p>
                    <p className="mt-2 text-lg">
                      <strong>Quilometragem total:</strong>{" "}
                      {Number(trip.totalKm || 0).toLocaleString("pt-BR")} km
                    </p>
                    <p className="mt-2 text-lg">
                      <strong>Valor total da viagem:</strong>{" "}
                      {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((trip.totalValueCents || 0) / 100)}
                    </p>
                    <p className="mt-2 text-lg">
                      <strong>Motorista{names.length === 1 ? "" : "s"}:</strong>{" "}
                      {names.length
                        ? names.join(", ")
                        : "Nenhum motorista associado"}
                    </p>
                    {confirmId === trip.id ? (
                      <div className="mt-5 rounded-xl border-2 border-[#b3262b] bg-red-50 p-4">
                        <p className="text-lg font-bold text-[#7f1d1d]">
                          Cancelar esta viagem?
                        </p>
                        <label className="mt-4 block text-base font-bold text-slate-800">Motivo do cancelamento<textarea autoFocus value={cancelReason} onChange={event=>setCancelReason(event.target.value)} maxLength={500} placeholder="Ex.: cliente cancelou o roteiro" className="mt-2 min-h-24 w-full rounded-xl border bg-white p-3 text-base font-normal text-slate-900"/></label>
                        <div className="mt-4 flex gap-3">
                          <button
                            type="button"
                            onClick={() => void remove(trip)}
                            className="h-12 rounded-xl bg-[#b3262b] px-5 text-lg font-bold text-white"
                          >
                            Confirmar cancelamento
                          </button>
                          <button
                            type="button"
                            onClick={() => {setConfirmId(null);setCancelReason("");}}
                            className="h-12 rounded-xl border px-5 text-lg font-bold"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => window.location.assign(`/admin/viagens/nova?edit=${trip.id}&return=${encodeURIComponent('/admin/viagens')}`)}
                          className="h-12 rounded-xl bg-[#e7b629] px-5 text-lg font-bold text-[#2c2509]"
                        >
                          Editar viagem
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(trip.id)}
                          className="h-12 rounded-xl bg-[#b3262b] px-5 text-lg font-bold text-white"
                        >
                          Cancelar viagem
                        </button>
                        {!trip.noFueling&&!trip.fuelCanceledAt&&<button type="button" onClick={async()=>{const reason=window.prompt("Cancelar abastecimento desta viagem? A viagem permanece no histórico e nos relatórios. Litros, produtos e despesas serão excluídos dos cálculos. Informe o motivo:");if(reason===null)return;if(reason.trim().length<3){setMsg("Informe um motivo com pelo menos 3 caracteres.");return;}if(!window.confirm("Confirma o cancelamento do abastecimento?"))return;try{const response=await fetch(`/api/trips/${trip.id}/cancel-fueling`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason})});const data=await response.json();if(!response.ok)throw Error(data.error);setMsg(data.message);await load();}catch(error){setMsg(error instanceof Error?error.message:"Falha ao cancelar.");}}} className="min-h-12 rounded-xl border-2 border-red-800 bg-white px-4 py-2 text-lg font-bold text-red-800">Cancelar abastecimento</button>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>}
      </div>
    </main>
  );
}
