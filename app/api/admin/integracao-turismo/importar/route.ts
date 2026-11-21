import { env } from "cloudflare:workers";
import { getSession, isManagementUser } from "../../../admin-auth";
import { importReturnSplit, ImportConflict } from "../../../../lib/turismo-import";
import { validateReturnSplit } from "../../../../lib/turismo-return-split.mjs";

const headers = { "Cache-Control": "no-store" };
const reply = (error: string, status: number) => Response.json({ error }, { status, headers });
const safeId = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
const settings = env as typeof env & { TURISMO_SYNC_ORIGIN?: string; FUEL_INTEGRATION_TOKEN?: string };

async function loadPage(cursor: number) {
  const { TURISMO_SYNC_ORIGIN: origin, FUEL_INTEGRATION_TOKEN: token } = settings;
  if (!origin || !token || token.length < 32) throw new Error("Integração com Turismo ainda sem configuração.");
  const endpoint = new URL("/api/integration/fuel-trips", origin);
  if (endpoint.protocol !== "https:") throw new Error("Configure o endereço HTTPS do Turismo.");
  endpoint.searchParams.set("cursor", String(cursor));
  const response = await fetch(endpoint, {
    headers: { Authorization: "Bearer " + token },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("O Turismo não disponibilizou o lote de viagens.");
  return response.json() as Promise<{
    events: Array<{ cursor: number; event: Parameters<typeof importReturnSplit>[1] }>;
    nextCursor: number;
    hasMore: boolean;
  }>;
}

export async function GET(request: Request) {
  const user = await getSession(request);
  if (!user || !isManagementUser(user) || user.passwordChangeRequired) return reply("Acesso restrito.", 403);
  const cursor = Number(new URL(request.url).searchParams.get("cursor") ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return reply("Cursor inválido.", 400);
  try {
    return Response.json(await loadPage(cursor), { headers });
  } catch (cause) {
    return reply(cause instanceof Error ? cause.message : "Falha ao consultar o Turismo.", 503);
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply("Origem não autorizada.", 403);
  const user = await getSession(request);
  if (!user || !isManagementUser(user) || user.passwordChangeRequired) return reply("Acesso restrito.", 403);
  const data = await request.json().catch(() => null);
  if (!data || !safeId(data.cursor) || !safeId(data.outboundId) || !safeId(data.outboundVehicle) || !safeId(data.inboundVehicle)
      || typeof data.eventId !== "string" || data.eventId.length > 128) {
    return reply("Confira a divisão, a viagem da ida e os dois carros locais.", 400);
  }
  if (!env.DB) return reply("Banco do Abastecimento indisponível.", 503);
  try {
    const page = await loadPage(data.cursor - 1);
    const match = page.events.find(row => row.cursor === data.cursor && row.event.eventId === data.eventId);
    if (!match) return reply("O evento não está disponível no Turismo.", 404);
    const issues = validateReturnSplit(match.event);
    if (issues.length) return reply(issues.join(" "), 409);

    const saved = await importReturnSplit(env.DB, match.event, {
      outboundId: data.outboundId,
      outboundVehicle: data.outboundVehicle,
      inboundVehicle: data.inboundVehicle,
    }, { id: user.bootstrap ? null : user.id, name: user.name });
    return Response.json(saved, { headers, status: saved.repetido ? 200 : 201 });
  } catch (cause) {
    if (cause instanceof ImportConflict) return reply(cause.message, 409);
    console.error("turismo_return_import_failed", cause);
    return reply("Falha ao importar a divisão.", 503);
  }
}
