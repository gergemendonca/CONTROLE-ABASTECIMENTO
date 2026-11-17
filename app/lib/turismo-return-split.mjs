const id = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 128;
const text = (value, maximum) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
const integer = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
const instant = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?[+-](?:0\d|1[0-4]):[0-5]\d$/.test(value)) return false;
  const date = new Date(value.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value.slice(0, 10) && Number.isFinite(Date.parse(value));
};

export function validateReturnSplit(event) {
  if (!event || event.schemaVersion !== 1 || event.type !== "trip.return_split") {
    return ["Evento de divisão de retorno inválido ou versão incompatível."];
  }
  const issues = [];
  if (!id(event.eventId) || !id(event.atendimentoId)) issues.push("Confira os IDs do evento e do atendimento.");
  if (!integer(event.valorContratadoCentavos, 0)) issues.push("Confira o valor contratado em centavos.");
  if (!text(event.motivo, 1200)) issues.push("Informe o motivo da divisão.");
  if (!Array.isArray(event.viagens) || event.viagens.length !== 2) return [...issues, "Informe duas viagens."];
  const ida = event.viagens.find((trip) => trip?.papel === "ida");
  const volta = event.viagens.find((trip) => trip?.papel === "volta");
  if (!ida || !volta) return [...issues, "Informe uma ida e uma volta."];
  if (ida.turismoViagemId === volta.turismoViagemId) issues.push("A ida e a volta precisam ter IDs diferentes.");
  if (ida.turismoCarroId === volta.turismoCarroId) issues.push("A divisão exige veículos diferentes.");
  for (const trip of [ida, volta]) {
    const label = trip.papel === "ida" ? "Ida" : "Volta";
    if (!id(trip.turismoViagemId) || !id(trip.turismoCarroId) || !integer(trip.revisao, 1)) issues.push(label + " com identificação ou revisão inválida.");
    if (!text(trip.prefixo, 40) || !text(trip.titulo, 250) || !text(trip.roteiroOperacional, 300)) issues.push(label + " com prefixo, título ou roteiro inválido.");
    if (!instant(trip.inicio) || !instant(trip.fim) || Date.parse(trip.fim) < Date.parse(trip.inicio)) issues.push(label + " com período inválido.");
    if (trip.kmReferencia !== null && !integer(trip.kmReferencia, 1)) issues.push(label + " com KM inválido.");
    if (!["programada", "em_andamento", "realizada"].includes(trip.situacao)) issues.push(label + " com situação inválida.");
  }
  return issues;
}
