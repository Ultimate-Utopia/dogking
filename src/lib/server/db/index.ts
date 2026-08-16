import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

if (!env.DATABASE_URL) {
	throw new Error('缺少 DATABASE_URL。請複製 .env.example 為 .env 並填入連線字串。');
}

/**
 * 連線設定。本機與 serverless 的最佳解完全不同，兩者差異很大。
 *
 * ── max ──
 * Netlify Functions 每次呼叫都可能是獨立的執行環境，各自帶一個連線池。
 * 本機開 5 條沒問題，但在 serverless 上「每個實例 5 條 × 數十個並行實例」
 * 會直接打爆資料庫的連線上限。正式環境設 1，靠雲端的連線池去分配。
 *
 * ── prepare ──
 * 雲端 Postgres（Supabase、Neon 等）給的通常是 transaction 模式的
 * 連線池位址。那個模式下，同一條實體連線會在不同交易之間輪替，
 * 因此**不支援 prepared statements** —— 沒關掉的話，
 * 上線後會出現「prepared statement already exists」這類間歇性錯誤，
 * 而且本機測完全測不出來。
 *
 * 交易期間連線不會被換走，所以下注與結算用的 SELECT ... FOR UPDATE
 * 在 transaction 模式下依然正確。
 */
const client = postgres(env.DATABASE_URL, {
	max: dev ? 5 : 1,
	prepare: false,
	idle_timeout: 20,
	connect_timeout: 10
});

export const db = drizzle(client, { schema });
export { schema };
