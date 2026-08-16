CREATE TABLE "admin_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" integer NOT NULL,
	"side" text NOT NULL,
	"amount" bigint NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"payout" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"ref_market_id" integer,
	"ref_bet_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"type" text NOT NULL,
	"game_no" integer,
	"state" text DEFAULT 'pending' NOT NULL,
	"pool_blue" bigint DEFAULT 0 NOT NULL,
	"pool_red" bigint DEFAULT 0 NOT NULL,
	"winner_side" text,
	"lock_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_no" integer NOT NULL,
	"round_label" text NOT NULL,
	"format" text NOT NULL,
	"blue_user_id" uuid,
	"red_user_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"score_blue" integer DEFAULT 0 NOT NULL,
	"score_red" integer DEFAULT 0 NOT NULL,
	"winner_side" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redeem_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"amount" bigint NOT NULL,
	"order_ref" text,
	"used_by_user_id" uuid,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"is_participant" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_logs" ADD CONSTRAINT "admin_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_ref_market_id_markets_id_fk" FOREIGN KEY ("ref_market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_ref_bet_id_bets_id_fk" FOREIGN KEY ("ref_bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_blue_user_id_users_id_fk" FOREIGN KEY ("blue_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_red_user_id_users_id_fk" FOREIGN KEY ("red_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_logs_admin_user_id_idx" ON "admin_logs" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bets_idempotency_key_idx" ON "bets" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "bets_user_id_idx" ON "bets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bets_market_id_idx" ON "bets" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "ledger_user_id_idx" ON "ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ledger_type_idx" ON "ledger" USING btree ("type");--> statement-breakpoint
CREATE INDEX "markets_match_id_idx" ON "markets" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "markets_state_idx" ON "markets" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_match_type_game_idx" ON "markets" USING btree ("match_id","type","game_no");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_id_idx" ON "users" USING btree ("discord_id");