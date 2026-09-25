CREATE TABLE `app_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`roles` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_username_unique` ON `app_users` (`username`);
--> statement-breakpoint
CREATE TABLE `trip_users` (
	`trip_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_users_trip_user_unique` ON `trip_users` (`trip_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `fuel_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`requested_by` integer,
	`liters` real NOT NULL,
	`route_km` integer NOT NULL,
	`payment_status` text NOT NULL,
	`outstanding_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`authorized_by` integer,
	`authorized_at` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authorized_by`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fuel_requests_status_idx` ON `fuel_requests` (`status`);
--> statement-breakpoint
CREATE TABLE `app_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`href` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_notifications_user_idx` ON `app_notifications` (`user_id`,`read_at`);
