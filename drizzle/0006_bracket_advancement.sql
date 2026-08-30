ALTER TABLE "matches" ADD COLUMN "bracket" text DEFAULT 'winners' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "round_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "winner_to_match_no" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "winner_to_slot" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "loser_to_match_no" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "loser_to_slot" text;