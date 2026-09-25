import {env} from 'cloudflare:workers';
import {isAdmin} from '../../admin-auth';
export async function POST(req:Request){if(!await isAdmin(req))return Response.json({error:'Apenas administrador.'},{status:403});try{await env.DB!.batch([
 env.DB!.prepare('CREATE TABLE IF NOT EXISTS app_users (id integer PRIMARY KEY AUTOINCREMENT NOT NULL,name text NOT NULL,username text NOT NULL,password_hash text NOT NULL,roles text NOT NULL,active integer DEFAULT 1 NOT NULL,created_at text NOT NULL)'),
 env.DB!.prepare('CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_unique ON app_users (username)'),
 env.DB!.prepare('CREATE TABLE IF NOT EXISTS trip_users (trip_id integer NOT NULL,user_id integer NOT NULL,FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE)'),
 env.DB!.prepare('CREATE UNIQUE INDEX IF NOT EXISTS trip_users_trip_user_unique ON trip_users (trip_id,user_id)'),
 env.DB!.prepare("CREATE TABLE IF NOT EXISTS fuel_requests (id integer PRIMARY KEY AUTOINCREMENT NOT NULL,trip_id integer NOT NULL,requested_by integer,liters real NOT NULL,route_km integer NOT NULL,payment_status text NOT NULL,outstanding_cents integer DEFAULT 0 NOT NULL,status text DEFAULT 'pending' NOT NULL,created_at text NOT NULL,authorized_by integer,authorized_at text,FOREIGN KEY (trip_id) REFERENCES trips(id),FOREIGN KEY (requested_by) REFERENCES app_users(id),FOREIGN KEY (authorized_by) REFERENCES app_users(id))"),
 env.DB!.prepare('CREATE INDEX IF NOT EXISTS fuel_requests_status_idx ON fuel_requests (status)'),
 env.DB!.prepare('CREATE TABLE IF NOT EXISTS app_notifications (id integer PRIMARY KEY AUTOINCREMENT NOT NULL,user_id integer NOT NULL,title text NOT NULL,message text NOT NULL,href text NOT NULL,read_at text,created_at text NOT NULL,FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE)'),
 env.DB!.prepare('CREATE INDEX IF NOT EXISTS app_notifications_user_idx ON app_notifications (user_id,read_at)')
]);return Response.json({ok:true});}catch{return Response.json({error:'Não foi possível preparar a atualização do banco.'},{status:503})}}
