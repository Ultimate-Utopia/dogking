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
 * Netlify Functions 每次呼叫都可能是獨立的執行環境，各自帶一個連線池，
 * 所以不能像單機服務那樣開很大。但也不能設成 1 ——
 * 那會讓同一個請求裡的並行查詢被迫排隊，跨區延遲下每多一次往返就多 200ms。
 * 3 條剛好夠 Promise.all 同時跑，又不會在多實例時撐爆。
 * 前面本來就還有雲端連線池（Supabase 的 pooler）再擋一層。
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
	max: dev ? 5 : 3,
	prepare: false,
	idle_timeout: 20,

	/**
	 * 連線卡住時要快速放棄。
	 *
	 * 原本設 10 秒，而 postgres.js 會重試 —— 實際遇過整個請求拖到 30 秒，
	 * 使用者盯著空白畫面等到逾時。設短一點的話，失敗會很快浮現，
	 * CDN 也能改送稍舊的快取內容（見各端點的 stale-while-revalidate）。
	 */
	connect_timeout: 5
});

export const db = drizzle(client, { schema });
export { schema };
