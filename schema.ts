import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';
export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull().unique(),
  consumptionKmL: real('consumption_km_l'),
});
export const drivers = sqliteTable('drivers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});
export const fueling = sqliteTable('fueling', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vehicleId: integer('vehicle_id').notNull().references(() => vehicles.id),
  originalTripId: integer('original_trip_id'),
  tripId: integer('trip_id'),
  fuelRequestId: integer('fuel_request_id'),
  driver: text('driver').notNull(),
  driverId: integer('driver_id').references(() => drivers.id),
  liters: real('liters').notNull(),
  paidByThirdParty:integer('paid_by_third_party'),
  odometer: integer('odometer').notNull(),
  amountCents: integer('amount_cents').notNull().default(0),
  launchedBy: integer('launched_by').references(() => appUsers.id),
  launchedByName: text('launched_by_name'),
  directLaunch: integer('direct_launch').notNull().default(0),
  authorizationObservation: text('authorization_observation'),
  createdAt: text('created_at').notNull(),
});
export const fuelingItems=sqliteTable('fueling_items',{
  id:integer('id').primaryKey({autoIncrement:true}),
  fuelingId:integer('fueling_id').notNull().references(()=>fueling.id,{onDelete:'cascade'}),
  kind:text('kind').notNull(),
  quantity:real('quantity').notNull(),
  amountCents:integer('amount_cents').notNull(),
});

export const trips=sqliteTable('trips',{
 id:integer('id').primaryKey({autoIncrement:true}),
 vehicleId:integer('vehicle_id').notNull().references(()=>vehicles.id),
 travelDate:text('travel_date').notNull(),
 departureDate:text('departure_date'),
 arrivalDate:text('arrival_date'),
 route:text('route').notNull(),
 totalKm:integer('total_km').notNull().default(0),
 noFueling:integer('no_fueling').notNull().default(0),
 plannedLiters:real('planned_liters'),
 paymentStatus:text('payment_status'),
 outstandingCents:integer('outstanding_cents'),
 totalValueCents:integer('total_value_cents').notNull().default(0),
 controlNumber:text('control_number'),
 canceledAt:text('canceled_at'),
 canceledBy:integer('canceled_by').references(()=>appUsers.id),
 canceledByName:text('canceled_by_name'),
 cancelReason:text('cancel_reason'),
});

export const whatsappContacts=sqliteTable('whatsapp_contacts',{
 id:integer('id').primaryKey({autoIncrement:true}),
 name:text('name').notNull(),
 phone:text('phone').notNull().unique(),
});

export const appUsers=sqliteTable('app_users',{
 id:integer('id').primaryKey({autoIncrement:true}),
 name:text('name').notNull(),
 username:text('username').notNull().unique(),
 passwordHash:text('password_hash').notNull(),
 groupName:text('group_name').notNull().default('motorista'),
 roles:text('roles').notNull(),
  active:integer('active').notNull().default(1),
  passwordChangeRequired:integer('password_change_required').notNull().default(0),
  createdAt:text('created_at').notNull(),
});

export const tripUsers=sqliteTable('trip_users',{
 tripId:integer('trip_id').notNull().references(()=>trips.id,{onDelete:'cascade'}),
 userId:integer('user_id').notNull().references(()=>appUsers.id,{onDelete:'cascade'}),
});

export const tripExternalDrivers=sqliteTable('trip_external_drivers',{
 tripId:integer('trip_id').notNull().references(()=>trips.id,{onDelete:'cascade'}),
 name:text('name').notNull(),
});

export const fuelRequests=sqliteTable('fuel_requests',{
 id:integer('id').primaryKey({autoIncrement:true}),
 tripId:integer('trip_id').notNull().references(()=>trips.id),
 vehicleId:integer('vehicle_id').references(()=>vehicles.id),
 requestedBy:integer('requested_by').references(()=>appUsers.id),
 liters:real('liters').notNull(),
 routeKm:integer('route_km').notNull(),
 paymentStatus:text('payment_status').notNull(),
 outstandingCents:integer('outstanding_cents').notNull().default(0),
 clientPaid:integer('client_paid').notNull().default(0),
  extraordinary:integer('extraordinary').notNull().default(0),
 status:text('status').notNull().default('pending'),
 createdAt:text('created_at').notNull(),
 authorizedBy:integer('authorized_by').references(()=>appUsers.id),
 authorizedAt:text('authorized_at'),
});

// Estado operacional do combustível: o abastecimento e o pedido pertencem ao
// veículo. As viagens apenas consultam o carro que lhes está atribuído.
export const vehicleFuelStatus=sqliteTable('vehicle_fuel_status',{
 vehicleId:integer('vehicle_id').primaryKey().references(()=>vehicles.id),
 state:text('state').notNull(),
 fuelingId:integer('fueling_id').references(()=>fueling.id),
 requestId:integer('request_id').references(()=>fuelRequests.id),
 updatedAt:text('updated_at').notNull(),
 note:text('note').notNull().default(''),
});

export const appNotifications=sqliteTable('app_notifications',{
 id:integer('id').primaryKey({autoIncrement:true}),
 userId:integer('user_id').notNull().references(()=>appUsers.id,{onDelete:'cascade'}),
 title:text('title').notNull(),
 message:text('message').notNull(),
 href:text('href').notNull(),
 readAt:text('read_at'),
 createdAt:text('created_at').notNull(),
});

export const tripEnergy=sqliteTable('trip_energy',{
 tripId:integer('trip_id').primaryKey().references(()=>trips.id),
 startKm:integer('start_km').notNull(),
 endKm:integer('end_km').notNull(),
 startLiters:real('start_liters').notNull(),
 consumptionKmL:real('consumption_km_l').notNull(),
 updatedByName:text('updated_by_name').notNull(),
 updatedAt:text('updated_at').notNull(),
});

// Auditoria das trocas: registra a viagem anterior e a viagem de destino.
export const fuelingReassignments=sqliteTable('fueling_reassignments',{
 id:integer('id').primaryKey({autoIncrement:true}),
 fuelingId:integer('fueling_id').notNull().references(()=>fueling.id),
 vehicleId:integer('vehicle_id').notNull().references(()=>vehicles.id),
 fromTripId:integer('from_trip_id').references(()=>trips.id),
 toTripId:integer('to_trip_id').references(()=>trips.id),
 actorName:text('actor_name').notNull(),
 changedAt:text('changed_at').notNull(),
 reason:text('reason').notNull(),
});

// Confirmação auditável de combustível físico legado cujo vínculo técnico não
// pode mais ser recuperado com segurança após troca/recriação do veículo.
export const fuelingStatusConfirmations=sqliteTable('fueling_status_confirmations',{
 tripId:integer('trip_id').primaryKey().references(()=>trips.id),
 vehicleId:integer('vehicle_id').notNull().references(()=>vehicles.id),
 sourceTripId:integer('source_trip_id').references(()=>trips.id),
 confirmedAt:text('confirmed_at').notNull(),
 reason:text('reason').notNull(),
});
