import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

if (!env.DATABASE_URL) {
	throw new Error('缺少 DATABASE_URL。請複製 .env.example 為 .env 並填入連線字串。');
}

/**
 * postgres.js 連線池。
 *
 * max 設低是刻意的：Netlify Functions 每次呼叫都是獨立執行環境，
 * 連線數失控會直接打爆資料庫。公開資料端點靠 CDN 快取擋掉絕大多數請求
 * （規格書 §09），真正打到這裡的量很小。
 */
const client = postgres(env.DATABASE_URL, { max: 5 });

export const db = drizzle(client, { schema });
export { schema };
