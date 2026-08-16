import { json } from '@sveltejs/kit';
import { eq, asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { markets } from '$lib/server/db/schema';
import { calcOdds, expireLocks } from '$lib/server/tournament';
import { requireAdmin } from '$lib/server/admin';

/**
 * 後台用的即時盤口狀態。
 *
 * 後台頁面是表單為主，不能整頁重新載入 —— 操作員可能正在輸入比分，
 * 資料一更新輸入框就被蓋掉。所以另開這個唯讀端點，
 * 只更新倒數與彩池的顯示，表單完全不碰。
 *
 * 內容隨管理員權限而異且需要即時，因此不快取。
 */
export const GET: RequestHandler = async ({ params, locals, setHeaders }) => {
	requireAdmin(locals.user);
	setHeaders({ 'Cache-Control': 'private, no-store' });

	await expireLocks();

	const rows = await db
		.select()
		.from(markets)
		.where(eq(markets.matchId, Number(params.id)))
		.orderBy(asc(markets.gameNo));

	return json({
		now: new Date().toISOString(),
		// 形狀刻意與頁面 load 回傳的一致，前端才能直接替換
		markets: rows.map((m) => ({ ...m, odds: calcOdds(m.poolBlue, m.poolRed) }))
	});
};
