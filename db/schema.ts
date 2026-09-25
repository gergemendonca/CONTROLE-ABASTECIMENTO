import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';
export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull().unique(),
});
export const drivers = sqliteTable('drivers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});
export const fueling = sqliteTable('fueling', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vehicleId: integer('vehicle_id').notNull().references(() => vehicles.id),
  driver: text('driver').notNull(),
  driverId: integer('driver_id').references(() => drivers.id),
  liters: real('liters').notNull(),
  odometer: integer('odometer').notNull(),
  amountCents: integer('amount_cents').notNull().default(0),
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
 createdAt:text('created_at').notNull(),
});

export const tripUsers=sqliteTable('trip_users',{
 tripId:integer('trip_id').notNull().references(()=>trips.id,{onDelete:'cascade'}),
 userId:integer('user_id').notNull().references(()=>appUsers.id,{onDelete:'cascade'}),
});

export const fuelRequests=sqliteTable('fuel_requests',{
 id:integer('id').primaryKey({autoIncrement:true}),
 tripId:integer('trip_id').notNull().references(()=>trips.id),
 requestedBy:integer('requested_by').references(()=>appUsers.id),
 liters:real('liters').notNull(),
 routeKm:integer('route_km').notNull(),
 paymentStatus:text('payment_status').notNull(),
 outstandingCents:integer('outstanding_cents').notNull().default(0),
 status:text('status').notNull().default('pending'),
 createdAt:text('created_at').notNull(),
 authorizedBy:integer('authorized_by').references(()=>appUsers.id),
 authorizedAt:text('authorized_at'),
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
