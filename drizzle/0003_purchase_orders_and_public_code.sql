CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"order_ref" text NOT NULL,
	"amount_twd" integer NOT NULL,
	"chips" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"public_code" text,
	"admin_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_code" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_ref_idx" ON "purchase_orders" USING btree ("platform","order_ref");--> statement-breakpoint
CREATE INDEX "purchase_orders_user_idx" ON "purchase_orders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_public_code_idx" ON "users" USING btree ("public_code");