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
  userIds: number[];
};
type AppUser = {
  id: number;
  name: string;
  groupName: "motorista" | "adm" | "gerencia";
};
type Confirmation = { messages: string[]; hasConflict: boolean };
type LiveConflict = { kind: "vehicle" | "drivers" | "duplicate"; key: string; message: string; driverIds?: number[] };
const formatDate = (date: string) => date.split("-").reverse().join("/");

export default function AdminClient({ mode = "list" }: { mode?: "list" | "new" }) {
  const today = new Date().toISOString().slice(0, 10),
    formSectionRef = useRef<HTMLElement>(null);
  const [cars, setCars] = useState<any[]>([]),
    [trips, setTrips] = useState<Trip[]>([]),
    [users, setUsers] = useState<AppUser[]>([]);
  const [car, setCar] = useState(""),
    [departureDate, setDepartureDate] = useState(today),
    [arrivalDate, setArrivalDate] = useState(today),
    [route, setRoute] = useState(""),
    [totalKm, setTotalKm] = useState(""),
    [totalValue, setTotalValue] = useState(""),
    [datesConfirmed, setDatesConfirmed] = useState(false),
    [selectedDriverIds, setSelectedDriverIds] = useState<number[]>([]),
    [editing, setEditing] = useState<number | null>(null),
    [confirmId, setConfirmId] = useState<number | null>(null),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [liveConflict, setLiveConflict] = useState<LiveConflict | null>(null),
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
  const drivers = users.filter((user) => user.groupName === "motorista");
  const driverName = (id: number) =>
    drivers.find((user) => user.id === id)?.name || "";
  function clear() {
    setCar("");
    setDepartureDate(today);
    setArrivalDate(today);
    setRoute("");
    setTotalKm("");
    setTotalValue("");
    setDatesConfirmed(false);
    setSelectedDriverIds([]);
    setEditing(null);
    setConfirmId(null);
    setConfirmation(null);
    setLiveConflict(null);
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
    if (exactDuplicate) {
      setLiveConflict({ kind: "duplicate", key: vehicleConflictKey, message: "Este carro já possui uma viagem cadastrada exatamente neste mesmo período. Escolha outro carro ou altere as datas." });
      return;
    }
    if (vehicleBusy && !acceptedConflicts.includes(vehicleConflictKey)) {
      setLiveConflict({ kind: "vehicle", key: vehicleConflictKey, message: "Já existe uma viagem para este carro no período informado. Há compatibilidade de horário?" });
      return;
    }
  }
  function confirmDates() {
    if (!car || !departureDate || !arrivalDate || arrivalDate < departureDate) {
      setMsg("Selecione o veículo e informe corretamente a saída e a chegada antes de confirmar as datas.");
      return;
    }
    const { vehicleBusy, exactDuplicate } = currentConflicts();
    if (exactDuplicate) {
      setDatesConfirmed(false);
      setLiveConflict({ kind: "duplicate", key: vehicleConflictKey, message: "Este carro já possui uma viagem cadastrada exatamente neste mesmo período. Escolha outro carro ou altere as datas." });
      return;
    }
    if (vehicleBusy && !acceptedConflicts.includes(vehicleConflictKey)) {
      setDatesConfirmed(false);
      setLiveConflict({ kind: "vehicle", key: vehicleConflictKey, message: "Já existe uma viagem para este carro no período informado. Há compatibilidade de horário?" });
      return;
    }
    setDatesConfirmed(true);
    setMsg("Carro e datas aceitos ✓ Agora informe os demais dados da viagem.");
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
    if (editing === null && selectedDriverIds.length === 1)
      messages.push(
        `Você selecionou apenas ${driverName(selectedDriverIds[0])}. Confirma que será o único motorista desta viagem?`,
      );
    const { vehicleBusy, exactDuplicate, busyDriverIds } = currentConflicts();
    if (exactDuplicate) return setMsg("Já existe uma viagem cadastrada para este carro exatamente neste mesmo período. Escolha outro carro ou altere as datas.");
    if (vehicleBusy && !acceptedConflicts.includes(vehicleConflictKey))
      messages.push(
        "Já existe uma viagem para este carro no mesmo período. Há compatibilidade de horário?",
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
      response = await fetch(editing ? `/api/trips/${editing}` : "/api/trips", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: Number(car),
          departureDate,
          arrivalDate,
          route,
          totalKm: Number(totalKm),
          totalValueCents: Math.round(Number(String(totalValue).replace(",", ".")) * 100),
          associatedUserIds: selectedDriverIds,
          allowConflicts,
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
      setMsg("Viagem atualizada com sucesso.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    clear();
    setMsg(
      "Viagem salva com sucesso. O formulário foi limpo para iniciar outro cadastro.",
    );
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }
  function edit(trip: Trip) {
    setEditing(trip.id);
    setCar(String(trip.vehicleId));
    setDepartureDate(trip.departureDate);
    setArrivalDate(trip.arrivalDate);
    setRoute(trip.route);
    setTotalKm(String(trip.totalKm || ""));
    setTotalValue(((trip.totalValueCents || 0) / 100).toFixed(2).replace(".", ","));
    setDatesConfirmed(true);
    setSelectedDriverIds(
      trip.userIds.filter((id) => drivers.some((driver) => driver.id === id)),
    );
    setMsg("Editando a viagem selecionada.");
    formSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  async function remove(trip: Trip) {
    const response = await fetch(`/api/trips/${trip.id}`, {
        method: "DELETE",
        cache: "no-store",
      }),
      data: any = await response.json().catch(() => ({}));
    if (!response.ok) return setMsg(data.error || "Não foi possível apagar.");
    setTrips((items) => items.filter((item) => item.id !== trip.id));
    setConfirmId(null);
    setMsg("Viagem apagada e removida da lista.");
  }
  return (
    <main className="min-h-screen bg-[#f3f6f9] p-5">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => window.location.assign("/admin")} className="h-14 rounded-xl border-2 border-slate-500 bg-white px-3 text-lg font-bold text-slate-700">Voltar para Área Adm</button>{mode !== "list"&&<button type="button" onClick={() => window.location.assign("/admin/viagens")} className="h-14 rounded-xl border-2 border-[#1677d8] bg-white px-3 text-lg font-bold text-[#1677d8]">Viagens lançadas</button>}</div>
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
                onChange={(event) => { setCar(event.target.value); setDatesConfirmed(false); setAcceptedConflicts([]); }}
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
                  onChange={(event) => { setArrivalDate(event.target.value); setDatesConfirmed(false); setAcceptedConflicts([]); }}
                  className="mt-2 h-16 min-w-0 w-full rounded-xl border p-3 text-lg"
                />
              </label>
            </div>
            <button type="button" onClick={confirmDates} className={`min-h-12 w-full rounded-xl border-2 px-4 py-2 text-lg font-bold ${datesConfirmed ? "border-[#178045] bg-[#178045] text-white" : "border-[#1677d8] bg-[#eaf4ff] text-[#075a9f]"}`}>
              {datesConfirmed ? "✓ Carro e datas aceitos" : "Confirmar carro e datas"}
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
                type="number"
                step="0.01"
                value={totalValue}
                onChange={(event) => setTotalValue(event.target.value)}
                placeholder="Ex.: 1.250,00"
                className="mt-2 h-16 w-full rounded-xl border p-3 text-2xl"
              />
            </label>
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
                Selecione até 3 motoristas. Adm e Gerência são associados
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
                          selectedDriverIds.length >= 3
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
              <h2 className="text-2xl font-bold text-[#b3262b]">Conflito de viagem</h2>
              <p className="mt-4 rounded-xl bg-amber-50 p-4 text-lg">{liveConflict.message}</p>
              {liveConflict.kind === "duplicate" ? <button type="button" onClick={() => { setLiveConflict(null); setCar(""); setDatesConfirmed(false); setMsg("Selecione outro carro ou altere as datas da viagem."); }} className="mt-6 min-h-14 w-full rounded-xl bg-[#1677d8] px-4 py-2 text-lg font-bold text-white">Entendi, alterar cadastro</button> : <div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => { const conflict=liveConflict; setAcceptedConflicts((items) => [...items, conflict.key]); setLiveConflict(null); if(conflict.kind==='vehicle')setDatesConfirmed(true); setMsg(conflict.kind==='vehicle'?"Carro e datas aceitos ✓ Você pode continuar o cadastro.":"Compatibilidade de horário confirmada. Você pode continuar o cadastro."); }} className="min-h-14 rounded-xl bg-[#178045] px-4 py-2 text-lg font-bold text-white">Sim, há compatibilidade</button><button type="button" onClick={() => { const conflict = liveConflict; setLiveConflict(null); setDatesConfirmed(false); if (conflict.kind === "vehicle") setCar(""); else setSelectedDriverIds((ids) => ids.filter((id) => !conflict.driverIds?.includes(id))); setMsg(conflict.kind === "vehicle" ? "Selecione outro carro ou altere as datas." : "Selecione outro motorista."); }} className="min-h-14 rounded-xl border-2 border-[#b3262b] px-4 py-2 text-lg font-bold text-[#b3262b]">Não, alterar seleção</button></div>}
            </section>
          </div>
        )}
        {mode !== "new" && <section className="mt-7">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-2xl font-bold">Viagens cadastradas</h2><p className="mt-1 text-base text-slate-600">A mais recentemente cadastrada aparece no topo.</p></div><button type="button" onClick={() => window.location.assign("/admin/viagens/nova")} className="inline-flex min-h-12 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[#1677d8] px-4 py-3 text-center text-base font-bold leading-tight text-white sm:w-auto sm:px-5 sm:text-lg">+ Incluir nova viagem</button></div>
          {trips.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-lg">
              Nenhuma viagem salva.
            </p>
          ) : (
            <div className="space-y-4">
              {trips.map((trip) => {
                const names = trip.userIds
                  .filter((id) => drivers.some((driver) => driver.id === id))
                  .map(driverName)
                  .filter(Boolean);
                return (
                  <article
                    key={trip.id}
                    className="rounded-2xl bg-white p-5 shadow-sm"
                  >
                    <p className="text-xl font-bold">{trip.vehicleLabel}</p>
                    <p className="mt-1 text-lg">
                      {formatDate(trip.departureDate)} até{" "}
                      {formatDate(trip.arrivalDate)}
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
                          Deseja apagar esta viagem?
                        </p>
                        <div className="mt-4 flex gap-3">
                          <button
                            type="button"
                            onClick={() => void remove(trip)}
                            className="h-12 rounded-xl bg-[#b3262b] px-5 text-lg font-bold text-white"
                          >
                            Confirmar apagar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="h-12 rounded-xl border px-5 text-lg font-bold"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 flex gap-4">
                        <button
                          type="button"
                          onClick={() => edit(trip)}
                          className="h-12 rounded-xl bg-[#e7b629] px-5 text-lg font-bold text-[#2c2509]"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(trip.id)}
                          className="h-12 rounded-xl bg-[#b3262b] px-5 text-lg font-bold text-white"
                        >
                          Apagar
                        </button>
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
