CREATE TABLE `drivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drivers_name_unique` ON `drivers` (`name`);--> statement-breakpoint
CREATE TABLE `fueling_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fueling_id` integer NOT NULL,
	`kind` text NOT NULL,
	`quantity` real NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`fueling_id`) REFERENCES `fueling`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `fueling` ADD `driver_id` integer REFERENCES drivers(id);--> statement-breakpoint
ALTER TABLE `fueling` ADD `amount_cents` integer DEFAULT 0 NOT NULL;