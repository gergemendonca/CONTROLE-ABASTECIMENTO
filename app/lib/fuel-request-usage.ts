// Um pedido é considerado utilizado tanto quando o lançamento guarda
// fuel_request_id quanto quando há abastecimento físico posterior para a mesma
// viagem e carro. Isto preserva os lançamentos diretos antigos.
export const requestUsedSql=(requestAlias='fr',fuelingAlias='used')=>`EXISTS (
 SELECT 1 FROM fueling ${fuelingAlias}
 WHERE ${fuelingAlias}.fuel_request_id=${requestAlias}.id
    OR (
      ${fuelingAlias}.trip_id=${requestAlias}.trip_id
      AND ${fuelingAlias}.vehicle_id=${requestAlias}.vehicle_id
      AND ${fuelingAlias}.liters>0
      AND datetime(${fuelingAlias}.created_at)>=datetime(${requestAlias}.created_at)
    )
)`;
export const requestUnusedSql=(requestAlias='fr',fuelingAlias='used')=>`NOT ${requestUsedSql(requestAlias,fuelingAlias)}`;
