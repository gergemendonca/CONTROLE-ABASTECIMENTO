CREATE TABLE `fueling` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`driver` text NOT NULL,
	`liters` real NOT NULL,
	`odometer` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_label_unique` ON `vehicles` (`label`);