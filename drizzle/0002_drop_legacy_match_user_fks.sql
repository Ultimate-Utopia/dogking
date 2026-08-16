ALTER TABLE "matches" DROP CONSTRAINT "matches_blue_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_red_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "blue_user_id";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "red_user_id";