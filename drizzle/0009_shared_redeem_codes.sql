CREATE TABLE "redeem_uses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD COLUMN "multi_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "redeem_codes" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "redeem_uses" ADD CONSTRAINT "redeem_uses_code_redeem_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."redeem_codes"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redeem_uses" ADD CONSTRAINT "redeem_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "redeem_uses_code_user_idx" ON "redeem_uses" USING btree ("code","user_id");--> statement-breakpoint
CREATE INDEX "redeem_uses_code_idx" ON "redeem_uses" USING btree ("code");