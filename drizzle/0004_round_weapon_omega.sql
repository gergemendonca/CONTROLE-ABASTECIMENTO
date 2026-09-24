CREATE TABLE `whatsapp_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_contacts_phone_unique` ON `whatsapp_contacts` (`phone`);