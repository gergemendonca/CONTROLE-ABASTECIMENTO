"use client";

import { useEffect, useState } from "react";

type Trip = {
  id: string;
  prefix: string;
  route: string;
  departure: string;
  arrival: string;
  km: number | null;
  localId: number | null;
};
const endpoint = "/api/admin/integracao-turismo/viagens";
const requestUrl = "/solicitar-abastecimento?origem=adm";
const displayDate = (value: string) => value.split("-").reverse().join("/");
function initialDate() {
  return new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bahia" });
}

export default function ViagensTurismo() {
  const [from, setFrom] = useState(initialDate);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [selected, setSelected] = useState<Trip | null>(null);
  const [km, setKm] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [imported, setImported] = useState<number[]>([]);

  async function load(start: string, cursor?: string, signal?: AbortSignal) {
    setBusy(true);
    setMessage("");
    setSelected(null);
    if (!cursor) {
      setTrips([]);
      setNext(null);
    }
    try {
      const query = new URLSearchParams({ from: start, after: cursor ?? "" });
      const response = await fetch(`${endpoint}?${query}`, { signal });
      if (response.status === 403) {
        window.location.replace("/admin?next=/admin/viagens/turismo");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (signal?.aborted) return;
      setTrips(current => cursor ? [...current, ...data.trips] : data.trips);
      setNext(data.next);
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Falha ao consultar o Turismo.");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    if (from) void load(from, undefined, controller.signal);
    return () => controller.abort();
  }, [from]);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selected, km: km === "" ? 0 : Number(km) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTrips(current => current.map(trip => trip.id === selected.id ? { ...trip, localId: data.id } : trip));
      setImported(current => current.includes(data.id) ? current : [...current, data.id]);
      setSelected(null);
      setMessage("Viagem disponível no Abastecimento.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao importar a viagem.");
    } finally {
      setBusy(false);
    }
  }

  const nextRequest = requestUrl + imported.map(id => `&trip=${id}`).join("");
  return <main className="min-h-screen bg-slate-50 p-5">
    <section className="mx-auto max-w-4xl space-y-5 rounded-3xl bg-white p-6 shadow">
      <nav className="flex flex-wrap gap-4 font-bold text-blue-800">
        <a href="/admin/viagens">Editar viagens</a>
        <a href={nextRequest}>Solicitar abastecimento{imported.length > 0 ? ` (${imported.length})` : ""}</a>
      </nav>
      <h1 className="text-3xl font-extrabold">Revisar viagens do Turismo</h1>
      <label className="block font-bold">Retorno a partir de
        <input type="date" required value={from} disabled={busy}
          onChange={event => setFrom(event.target.value)} className="ml-2 rounded-lg border p-2"/>
      </label>
      {busy && <p role="status">Aguarde…</p>}
      {message && <p role="status" className="rounded-lg bg-sky-50 p-3">{message}</p>}
      {selected && <form onSubmit={confirm} className="space-y-3 rounded-xl border-2 border-blue-400 p-4">
        <h2 className="text-xl font-bold">Conferir viagem</h2>
        <p>{selected.prefix} · {selected.route}</p>
        <p>{displayDate(selected.departure)} a {displayDate(selected.arrival)}</p>
        <label className="block font-bold">KM previstos
          <input type="number" min="0" max="100000" step="1" value={km} onChange={event => setKm(event.target.value)}
            placeholder="Pode preencher na solicitação" className="ml-2 rounded-lg border p-2"/>
        </label>
        <button disabled={busy} className="rounded-lg bg-blue-800 px-4 py-2 font-bold text-white">Confirmar viagem</button>
        <button type="button" disabled={busy} onClick={() => setSelected(null)} className="ml-4 font-bold">Fechar revisão</button>
      </form>}
      {!busy && !message && trips.length === 0 && <p>Nenhuma viagem encontrada nesse período.</p>}
      <ul className="space-y-2">
        {trips.map(trip => <li key={trip.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div><strong>{trip.prefix} · {trip.route}</strong>
            <p>{displayDate(trip.departure)} a {displayDate(trip.arrival)}</p>
          </div>
          {trip.localId
            ? <a className="font-bold text-blue-800" href={`${requestUrl}&trip=${trip.localId}`}>Solicitar abastecimento</a>
            : <button type="button" disabled={busy} onClick={() => {
                setSelected(trip);
                setKm(trip.km === null ? "" : String(trip.km));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }} className="font-bold text-blue-800">Revisar</button>}
        </li>)}
      </ul>
      {next && <button disabled={busy} onClick={() => void load(from, next)} className="font-bold text-blue-800">Carregar mais viagens</button>}
    </section>
  </main>;
}
