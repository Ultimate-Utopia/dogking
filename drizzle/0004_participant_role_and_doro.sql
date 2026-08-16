ALTER TABLE "participants" ADD COLUMN "role" text DEFAULT 'player' NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "role_label" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "doro_slug" text;