import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';

/**
 * 部署健康檢查。
 *
 * ⚠️ 只回報「有沒有設定、能不能連上」，絕不回傳任何值。
 * 憑證的長度與前綴也不揭露 —— 這個端點是公開的。
 *
 * 上線時最常見的失敗是環境變數漏填或填錯，但那些症狀
 * （function crashed、白畫面、登入卡住）看起來都一樣。
 * 有這個端點就能一眼分辨是設定問題還是程式問題。
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'no-store' });

	const started = Date.now();
	const configured = {
		DATABASE_URL: !!env.DATABASE_URL,
		DISCORD_CLIENT_ID: !!env.DISCORD_CLIENT_ID,
		DISCORD_CLIENT_SECRET: !!env.DISCORD_CLIENT_SECRET,
		DISCORD_REDIRECT_URI: !!env.DISCORD_REDIRECT_URI
	};

	// redirect_uri 只要有一個字元不同，Discord 就會拒絕整次授權，
	// 所以特別檢查它跟目前這個網域是否相符。
	let redirectMatchesHost: boolean | null = null;
	if (env.DISCORD_REDIRECT_URI) {
		try {
			redirectMatchesHost = new URL(env.DISCORD_REDIRECT_URI).host === url.host;
		} catch {
			redirectMatchesHost = false;
		}
	}

	let database: { ok: boolean; ms?: number; tables?: number; error?: string };
	try {
		const t = Date.now();
		const rows = await db.execute(
			sql`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
		);
		database = { ok: true, ms: Date.now() - t, tables: Number(rows[0]?.n ?? 0) };
	} catch (e) {
		database = { ok: false, error: e instanceof Error ? e.name : 'UnknownError' };
	}

	const allSet = Object.values(configured).every(Boolean);
	const healthy = allSet && database.ok && redirectMatchesHost !== false;

	return json(
		{
			healthy,
			configured,
			redirectMatchesHost,
			database,
			totalMs: Date.now() - started
		},
		{ status: healthy ? 200 : 503 }
	);
};
