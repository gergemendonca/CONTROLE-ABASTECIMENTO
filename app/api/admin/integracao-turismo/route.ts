import { env } from "cloudflare:workers";
import { isAdmin } from "../../admin-auth";
import { validateReturnSplit } from "../../../lib/turismo-return-split.mjs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Origem não autorizada." }, { status: 403, headers });
  }
  if (!await isAdmin(request)) {
    return Response.json({ error: "Acesso restrito." }, { status: 403, headers });
  }
  const event = await request.json().catch(() => null);
  const issues = validateReturnSplit(event);
  if (issues.length) {
    return Response.json({ issues }, { status: 400, headers });
  }

  try {
    const prefixes = event.viagens.map((trip: { prefixo: string }) => trip.prefixo.trim());
    const data = await env.DB!.prepare(
      "SELECT id, label FROM vehicles WHERE trim(label) IN (?, ?)",
    ).bind(...prefixes).all<{ id: number; label: string }>();
    const viagens = event.viagens.map((trip: {
      turismoViagemId: string;
      turismoCarroId: string;
      papel: string;
      prefixo: string;
      kmReferencia: number | null;
    }) => {
      const candidates = data.results.filter((vehicle) => vehicle.label.trim() === trip.prefixo.trim());
      return {
        ...trip,
        candidatosPorPrefixo: candidates.map((vehicle) => vehicle.id),
        conferirCarro: candidates.length !== 1,
        kmPendente: trip.kmReferencia === null,
      };
    });
    return Response.json({
      modo: "previsualizacao",
      eventId: event.eventId,
      atendimentoId: event.atendimentoId,
      valorContratadoCentavos: event.valorContratadoCentavos,
      viagens,
    }, { headers });
  } catch {
    return Response.json({ error: "Não foi possível conferir os veículos." }, { status: 503, headers });
  }
}
