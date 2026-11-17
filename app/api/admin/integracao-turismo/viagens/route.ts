import { env } from "cloudflare:workers";
import { getSession, isManagementUser } from "../../../admin-auth";
import { ensureTripCancellation } from "../../../../lib/trip-cancellation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });
const day = /^\d{4}-\d{2}-\d{2}$/;
type Trip = { id: string; prefix: string; route: string; departure: string; arrival: string; km: number | null };

async function load(params: URLSearchParams): Promise<{ trips: Trip[]; next: string | null }> {
  const { TURISMO_SYNC_ORIGIN, FUEL_INTEGRATION_TOKEN } = env as typeof env & {
    TURISMO_SYNC_ORIGIN?: string;
    FUEL_INTEGRATION_TOKEN?: string;
  };
  if (!TURISMO_SYNC_ORIGIN || !FUEL_INTEGRATION_TOKEN || FUEL_INTEGRATION_TOKEN.length < 32) {
    throw new Error("Configure o endereço e o segredo da integração com o Turismo.");
  }
  const url = new URL("/api/integration/fuel-schedule", TURISMO_SYNC_ORIGIN);
  if (url.protocol !== "https:") throw new Error("O endereço do Turismo precisa usar HTTPS.");
  url.search = params.toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${FUEL_INTEGRATION_TOKEN}` },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`O Turismo recusou a consulta (HTTP ${response.status}).`);
  return response.json();
}

async function ensureLinks(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS turismo_schedule_links (
    external_id TEXT PRIMARY KEY NOT NULL,
    trip_id INTEGER NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE
  )`).run();
}

export async function GET(request: Request) {
  const user = await getSession(request);
  if (!user || !isManagementUser(user) || user.passwordChangeRequired) return error("Acesso restrito.", 403);
  if (!env.DB) return error("Banco do Abastecimento indisponível.", 503);
  const params = new URL(request.url).searchParams;
  if (!day.test(params.get("from") ?? "") || (params.get("after")?.length ?? 0) > 300) return error("Consulta inválida.", 400);
  params.delete("id");
  try {
    const page = await load(params);
    await ensureLinks(env.DB);
    const ids = page.trips.map(trip => trip.id);
    const links = ids.length ? await env.DB.prepare(
      `SELECT external_id, trip_id FROM turismo_schedule_links WHERE external_id IN (${ids.map(() => "?").join(",")})`,
    ).bind(...ids).all<{ external_id: string; trip_id: number }>() : null;
    const linked = new Map(links?.results.map(row => [row.external_id, row.trip_id]));
    return Response.json({ ...page, trips: page.trips.map(trip => ({ ...trip, localId: linked.get(trip.id) ?? null })) }, { headers });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao consultar as viagens do Turismo.", 503);
  }
}

export async function POST(request: Request) {
  const user = await getSession(request);
  if (!user || !isManagementUser(user) || user.passwordChangeRequired) return error("Acesso restrito.", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origem não autorizada.", 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !body.id || body.id.length > 300 ||
      !Number.isSafeInteger(body.km) || body.km < 0 || body.km > 100000) return error("Confira a viagem e a quilometragem.", 400);
  const db = env.DB;
  if (!db) return error("Banco do Abastecimento indisponível.", 503);
  try {
    const { trips: [trip] } = await load(new URLSearchParams({ id: body.id, from: "0000-01-01" }));
    if (!trip) return error("A viagem não está mais disponível no Turismo.", 404);
    if (trip.prefix !== body.prefix || trip.route !== body.route || trip.departure !== body.departure || trip.arrival !== body.arrival) {
      return error("A viagem mudou no Turismo. Atualize a lista e confira os dados novamente.", 409);
    }
    if (!day.test(trip.departure) || !day.test(trip.arrival) || trip.arrival < trip.departure || !trip.route.trim()) {
      return error("Confira o roteiro e as datas no Turismo.", 409);
    }
    await ensureLinks(db);
    await ensureTripCancellation();
    const lookup = () => db.prepare("SELECT trip_id AS id FROM turismo_schedule_links WHERE external_id = ?")
      .bind(trip.id).first<{ id: number }>();
    const linked = await lookup();
    if (linked) return Response.json(linked, { headers });

    const vehicles = await db.prepare("SELECT id, label FROM vehicles").all<{ id: number; label: string }>();
    const normalized = (label: string) => label.trim().toLowerCase().replace(/\s+/g, " ");
    const prefix = (label: string) => normalized(label).match(/^(?:carro )?(\d+)(?: dd)?$/)?.[1] ?? normalized(label);
    const matches = vehicles.results.filter(vehicle => prefix(vehicle.label) === prefix(trip.prefix));
    if (matches.length !== 1) return error("O prefixo do Turismo precisa corresponder a um único carro no Abastecimento.", 409);
    const vehicle = matches[0].id;
    const overlapping = `vehicle_id = ? AND COALESCE(canceled_at, '') = ''
      AND COALESCE(departure_date, travel_date) <= ? AND COALESCE(arrival_date, travel_date) >= ?`;
    const overlapArgs = [vehicle, trip.arrival, trip.departure];
    const local = await db.prepare(`SELECT id, route, COALESCE(departure_date, travel_date) AS departure,
      COALESCE(arrival_date, travel_date) AS arrival FROM trips WHERE ${overlapping}`)
      .bind(...overlapArgs).all<{ id: number; route: string; departure: string; arrival: string }>();
    const same = local.results.filter(row => normalized(row.route) === normalized(trip.route) &&
      row.departure === trip.departure && row.arrival === trip.arrival);
    if (same.length === 1) {
      await db.prepare("INSERT INTO turismo_schedule_links (external_id, trip_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .bind(trip.id, same[0].id).run();
    } else if (!local.results.length) {
      await db.batch([
        db.prepare(`INSERT INTO trips (vehicle_id, travel_date, departure_date, arrival_date, route, total_km)
          SELECT ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM trips WHERE ${overlapping})
          AND NOT EXISTS (SELECT 1 FROM turismo_schedule_links WHERE external_id = ?)`)
          .bind(vehicle, trip.departure, trip.departure, trip.arrival, trip.route.trim(), body.km, ...overlapArgs, trip.id),
        db.prepare(`INSERT INTO turismo_schedule_links (external_id, trip_id)
          SELECT ?, last_insert_rowid() WHERE changes() = 1`).bind(trip.id),
      ]);
    }
    const saved = await lookup();
    if (!saved) return error("Há um cadastro do Abastecimento para esse carro e período. Confira o roteiro e as datas em Editar viagens antes de importar.", 409);
    return Response.json(saved, { headers });
  } catch (cause) {
    console.error("turismo_schedule_import", cause);
    return error(cause instanceof Error ? cause.message : "Falha ao importar a viagem.", 503);
  }
}
