import { ensureTripAudit } from "./trip-audit";
import { ensureTripCancellation } from "./trip-cancellation";

type Leg = {
  turismoViagemId: string;
  revisao: number;
  roteiroOperacional: string;
  inicio: string;
  fim: string;
  kmReferencia: number | null;
  situacao: "programada" | "em_andamento" | "realizada";
};

type Split = {
  eventId: string;
  atendimentoId: string;
  valorContratadoCentavos: number;
  viagens: [(Leg & { papel: "ida" | "volta" }), (Leg & { papel: "ida" | "volta" })];
};

export class ImportConflict extends Error {}

export async function importReturnSplit(db: D1Database, event: Split, selection: {
  outboundId: number;
  outboundVehicle: number;
  inboundVehicle: number;
}, actor: { id: number | null; name: string }) {
  const outbound = event.viagens.find(trip => trip.papel === "ida")!;
  const inbound = event.viagens.find(trip => trip.papel === "volta")!;
  if (selection.outboundVehicle === selection.inboundVehicle) throw new ImportConflict("Selecione dois carros diferentes.");
  if (outbound.kmReferencia === null || inbound.kmReferencia === null) throw new ImportConflict("Confira a quilometragem das duas viagens no Turismo.");

  await ensureTripCancellation();
  await ensureTripAudit();
  for (const [column, type] of [["finalized_at", "TEXT"], ["finalized_by", "INTEGER"], ["finalized_by_name", "TEXT"]]) {
    const hasColumn = async () => (await db.prepare("PRAGMA table_info(trips)").all<{ name: string }>()).results.some(row => row.name === column);
    if (await hasColumn()) continue;
    try {
      await db.prepare(`ALTER TABLE trips ADD COLUMN ${column} ${type}`).run();
    } catch (error) {
      if (!await hasColumn()) throw error;
    }
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS turismo_return_imports (
    event_id TEXT PRIMARY KEY,
    atendimento_id TEXT NOT NULL,
    outbound_external_id TEXT NOT NULL UNIQUE,
    inbound_external_id TEXT NOT NULL UNIQUE,
    outbound_local_id INTEGER NOT NULL UNIQUE REFERENCES trips(id),
    inbound_local_id INTEGER UNIQUE REFERENCES trips(id),
    outbound_vehicle_id INTEGER NOT NULL,
    inbound_vehicle_id INTEGER NOT NULL,
    payload TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    verified INTEGER NOT NULL CONSTRAINT turismo_import_precondition CHECK (verified = 1)
  )`).run();

  const payload = JSON.stringify(event);
  const existing = () => db.prepare(
    "SELECT payload, outbound_local_id, inbound_local_id, inbound_vehicle_id, outbound_vehicle_id FROM turismo_return_imports WHERE event_id = ?",
  ).bind(event.eventId).first<{
    payload: string; outbound_local_id: number; inbound_local_id: number;
    inbound_vehicle_id: number; outbound_vehicle_id: number;
  }>();
  const compare = (row: NonNullable<Awaited<ReturnType<typeof existing>>>) => {
    if (row.payload !== payload || row.outbound_local_id !== selection.outboundId ||
        row.inbound_vehicle_id !== selection.inboundVehicle || row.outbound_vehicle_id !== selection.outboundVehicle) {
      throw new ImportConflict("O evento já foi importado com outros vínculos.");
    }
    return { idaId: row.outbound_local_id, voltaId: row.inbound_local_id, repetido: true };
  };
  const prior = await existing();
  if (prior) return compare(prior);

  const now = new Date().toISOString();
  const outboundStart = outbound.inicio.slice(0, 10);
  const inboundStart = inbound.inicio.slice(0, 10);
  const inboundEnd = inbound.fim.slice(0, 10);
  const auditSql = `INSERT INTO trip_audit (trip_id, action, actor_name, effective_at, registered_at, retroactive)
    VALUES (?, ?, ?, ?, ?, 0)`;

  try {
    await db.batch([
      db.prepare(`INSERT INTO turismo_return_imports
        (event_id, atendimento_id, outbound_external_id, inbound_external_id, outbound_local_id,
         outbound_vehicle_id, inbound_vehicle_id, payload, imported_at, verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN
          EXISTS (SELECT 1 FROM trips t WHERE t.id = ? AND t.vehicle_id = ?
            AND COALESCE(t.canceled_at, '') = '' AND COALESCE(t.departure_date, t.travel_date) = ?)
          AND EXISTS (SELECT 1 FROM vehicles WHERE id = ?)
          AND NOT EXISTS (SELECT 1 FROM fuel_requests WHERE trip_id = ? AND status IN ('pending', 'authorized')
            AND NOT EXISTS (SELECT 1 FROM fueling WHERE fueling.fuel_request_id = fuel_requests.id AND fueling.liters > 0))
          AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = ? AND COALESCE(t.canceled_at, '') = ''
            AND COALESCE(t.departure_date, t.travel_date) = ?
            AND COALESCE(t.arrival_date, t.travel_date) = ?)
          AND NOT EXISTS (SELECT 1 FROM turismo_return_imports WHERE inbound_local_id = ?
            OR inbound_external_id = ? OR outbound_external_id = ?)
          THEN 1 ELSE 0 END)`).bind(
        event.eventId, event.atendimentoId, outbound.turismoViagemId, inbound.turismoViagemId,
        selection.outboundId, selection.outboundVehicle, selection.inboundVehicle, payload, now,
        selection.outboundId, selection.outboundVehicle, outboundStart, selection.inboundVehicle,
        selection.outboundId, selection.inboundVehicle, inboundStart, inboundEnd,
        selection.outboundId, outbound.turismoViagemId, inbound.turismoViagemId,
      ),
      db.prepare(`UPDATE trips SET departure_date = ?, arrival_date = ?, route = ?, total_km = ?,
        total_value_cents = ?, planned_liters = NULL,
        finalized_at = CASE WHEN ? THEN COALESCE(NULLIF(finalized_at, ''), ?) ELSE finalized_at END,
        finalized_by = CASE WHEN ? AND COALESCE(finalized_at, '') = '' THEN ? ELSE finalized_by END,
        finalized_by_name = CASE WHEN ? AND COALESCE(finalized_at, '') = '' THEN ? ELSE finalized_by_name END
        WHERE id = ?`).bind(outboundStart, outbound.fim.slice(0, 10), outbound.roteiroOperacional,
        outbound.kmReferencia, event.valorContratadoCentavos, Number(outbound.situacao === "realizada"),
        now, Number(outbound.situacao === "realizada"), actor.id, Number(outbound.situacao === "realizada"), actor.name, selection.outboundId),
      db.prepare(`INSERT INTO trips
        (vehicle_id, travel_date, departure_date, arrival_date, route, total_km, total_value_cents, finalized_at, finalized_by, finalized_by_name)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).bind(selection.inboundVehicle, inboundStart, inboundStart, inboundEnd,
        inbound.roteiroOperacional, inbound.kmReferencia, inbound.situacao === "realizada" ? now : null,
        inbound.situacao === "realizada" ? actor.id : null, inbound.situacao === "realizada" ? actor.name : null),
      db.prepare("UPDATE turismo_return_imports SET inbound_local_id = last_insert_rowid() WHERE event_id = ?").bind(event.eventId),
      db.prepare(auditSql).bind(selection.outboundId, "viagem_editada", actor.name, outbound.inicio, now),
      db.prepare(`INSERT INTO trip_audit (trip_id, action, actor_name, effective_at, registered_at, retroactive)
        SELECT inbound_local_id, 'viagem_cadastrada', ?, ?, ?, 0 FROM turismo_return_imports WHERE event_id = ?`).bind(actor.name, inbound.inicio, now, event.eventId),
    ]);
  } catch (error) {
    const concurrent = await existing();
    if (concurrent) return compare(concurrent);
    if (/constraint/i.test(String(error))) {
      throw new ImportConflict("Confira a viagem local da ida, pedidos e autorizações em aberto, vínculo dos carros e possível cadastro prévio da volta.");
    }
    throw error;
  }

  const saved = await existing();
  if (!saved) throw new Error("Não foi possível localizar a divisão gravada.");
  return { idaId: saved.outbound_local_id, voltaId: saved.inbound_local_id, repetido: false };
}
