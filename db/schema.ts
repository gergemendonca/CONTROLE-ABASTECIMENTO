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
