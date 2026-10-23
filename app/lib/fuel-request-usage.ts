// Uma autorização só é consumida pelo abastecimento fisico ligado ao seu ID.
// Compatibilidade limitada: pedidos comuns antigos podem ter sido realizados
// como lançamento direto, sem fuel_request_id. Pedidos extraordinários exigem
// vínculo explícito e jamais herdam o abastecimento anterior do carro/viagem.
export const requestUsedSql=(requestAlias='fr',fuelingAlias='used')=>`EXISTS (
 SELECT 1 FROM fueling ${fuelingAlias}
 WHERE ${fuelingAlias}.fuel_request_id=${requestAlias}.id
    OR (
      COALESCE(${requestAlias}.extraordinary,0)=0
      AND ${fuelingAlias}.fuel_request_id IS NULL
      AND ${fuelingAlias}.trip_id=${requestAlias}.trip_id
      AND ${fuelingAlias}.vehicle_id=${requestAlias}.vehicle_id
      AND ${fuelingAlias}.liters>0
      AND datetime(${fuelingAlias}.created_at)>=datetime(${requestAlias}.created_at)
    )
)`;
export const requestUnusedSql=(requestAlias='fr',fuelingAlias='used')=>`NOT ${requestUsedSql(requestAlias,fuelingAlias)}`;
