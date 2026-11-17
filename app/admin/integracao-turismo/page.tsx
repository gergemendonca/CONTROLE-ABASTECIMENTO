"use client";

import { useEffect, useState, type FormEvent } from "react";

type Trip = { id: number; controlNumber?: string; vehicleId: number; route: string; departureDate: string };
type Vehicle = { id: number; label: string };
type Leg = { papel: "ida" | "volta"; prefixo: string; roteiroOperacional: string; inicio: string; fim: string; kmReferencia: number | null };
type Entry = { cursor: number; event: { eventId: string; viagens: Leg[]; motivo: string } };

const endpoint = "/api/admin/integracao-turismo/importar";
const field = "block w-full rounded border p-2";
const button = "rounded border bg-white px-4 py-2 font-semibold disabled:opacity-50";
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Falha na integração.");
  return data;
}

export default function IntegracaoTurismo() {
  const [events, setEvents] = useState<Entry[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [selected, select] = useState<Entry | null>(null);
  const [localTrip, setLocalTrip] = useState("");
  const [inbound, setInbound] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load(cursor = 0) {
    setBusy(true);
    setMessage("");
    try {
      const [feed, current, fleet] = await Promise.all([json(endpoint + "?cursor=" + cursor), json("/api/trips"), json("/api/vehicles")]);
      setEvents(feed.events);
      setNext(feed.hasMore ? feed.nextCursor : null);
      setTrips(current.trips);
      setVehicles(fleet.vehicles);
      select(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao consultar a programação.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const outboundLeg = selected?.event.viagens.find(leg => leg.papel === "ida");
  const inboundLeg = selected?.event.viagens.find(leg => leg.papel === "volta");
  const outboundTrip = trips.find(trip => String(trip.id) === localTrip);

  function choose(entry: Entry) {
    select(entry);
    setLocalTrip("");
    setInbound("");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selected || !outboundTrip || !inbound) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await json(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cursor: selected.cursor, eventId: selected.event.eventId, outboundId: outboundTrip.id,
          outboundVehicle: outboundTrip.vehicleId, inboundVehicle: Number(inbound),
        }),
      });
      setMessage("Divisão registrada. Ida V-" + String(data.idaId).padStart(3, "0") + " · Volta V-" + String(data.voltaId).padStart(3, "0") + ".");
      select(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao importar a divisão.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto grid max-w-3xl gap-4 p-5">
    <a href="/admin/lista-viagens" className="text-blue-700 underline">Voltar para viagens</a>
    <h1 className="text-2xl font-bold">Importar retorno do Turismo</h1>
    <div className="flex gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => void load()}>Atualizar</button>
      {next !== null ? <button type="button" className={button} disabled={busy} onClick={() => void load(next)}>Próxima página</button> : null}
    </div>
    {message ? <p role="status">{message}</p> : null}
    {!events.length && !message ? <p>{busy ? "Consultando o Turismo…" : "Nenhuma divisão encontrada."}</p> : null}
    <ul className="grid gap-2">
      {events.map(entry => <li key={entry.cursor}><button type="button" disabled={busy} className={button} onClick={() => choose(entry)}>
        {entry.event.viagens.map(leg => leg.prefixo + " · " + leg.roteiroOperacional).join(" / ")}
      </button></li>)}
    </ul>
    {outboundLeg && inboundLeg ? <form className="grid gap-3 rounded border p-4" onSubmit={save}>
      <p>Ida no Turismo: {outboundLeg.prefixo} · {outboundLeg.roteiroOperacional} · {outboundLeg.kmReferencia ?? "KM pendente"}</p>
      <p>Volta no Turismo: {inboundLeg.prefixo} · {inboundLeg.roteiroOperacional} · {inboundLeg.kmReferencia ?? "KM pendente"}</p>
      <label>Viagem da ida já cadastrada<select className={field} value={localTrip} onChange={e => setLocalTrip(e.target.value)} required>
        <option value="">Selecione a viagem</option>
        {trips.filter(trip => trip.departureDate === outboundLeg.inicio.slice(0, 10)).map(trip => <option key={trip.id} value={trip.id}>
          {trip.controlNumber ?? trip.id} · {vehicles.find(item => item.id === trip.vehicleId)?.label} · {trip.route}
        </option>)}
      </select></label>
      <label>Carro local da volta<select className={field} value={inbound} onChange={e => setInbound(e.target.value)} required>
        <option value="">Selecione o carro</option>
        {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>)}
      </select></label>
      <button className={button} disabled={busy || !outboundTrip || !inbound || outboundLeg.kmReferencia === null || inboundLeg.kmReferencia === null}>Importar divisão</button>
    </form> : null}
  </main>;
}
