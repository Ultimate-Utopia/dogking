CREATE TABLE "participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"channel_url" text,
	"avatar_url" text,
	"doro_image_url" text,
	"order_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "game_no" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "game_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "is_elimination" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "blue_participant_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "red_participant_id" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_blue_participant_id_participants_id_fk" FOREIGN KEY ("blue_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_red_participant_id_participants_id_fk" FOREIGN KEY ("red_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;