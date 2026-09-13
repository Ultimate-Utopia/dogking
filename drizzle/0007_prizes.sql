CREATE TABLE "prizes" (
	"id" serial PRIMARY KEY NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"ranks_label" text NOT NULL,
	"name" text NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_data" "bytea",
	"image_type" text,
	"image_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 原本寫死在 src/lib/data/prizes.js 的獎品，搬進資料表，上線後前台照常顯示
INSERT INTO "prizes" ("sort_order", "ranks_label", "name", "features")
VALUES (1, '持有狗狗幣前三名', '愛心水晶王座', '["可指定印刷的狗狗","含親簽","客製化 ID"]'::jsonb);
