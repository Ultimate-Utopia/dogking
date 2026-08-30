import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBracket } from '$lib/server/board';

/**
 * 賽程樹。公開資料，交給 CDN 快取。
 *
 * 快取比 /api/board 長（15 秒）：樹狀圖只在某一場判定勝負時才會變，
 * 不像盤口彩池那樣每一筆下注都在動。前台也配合用 15 秒輪詢，
 * 讓這支的函式呼叫次數維持在整場數百次的量級。
 */
export const GET: RequestHandler = async ({ setHeaders }) => {
	const bracket = await getBracket();

	setHeaders({ 'Cache-Control': 'public, max-age=15, stale-while-revalidate=600' });

	return json(bracket);
};
