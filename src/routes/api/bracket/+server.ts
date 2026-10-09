import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBracket } from '$lib/server/board';

/**
 * 賽程樹。公開資料，交給 CDN 快取。
 *
 * 快取比 /api/board 長（15 秒）：樹狀圖只在某一場判定勝負時才會變，
 * 不像應援場獎池那樣每一筆應援都在動。前台也配合用 15 秒輪詢，
 * 讓這支的函式呼叫次數維持在整場數百次的量級。
 */
export const GET: RequestHandler = async ({ setHeaders }) => {
	const bracket = await getBracket();

	// 賽程樹對「舊資料」最敏感 —— 判出勝負後晉級的人會被填進下一場，
	// 送到舊內容時那一格的名字與立繪會整個消失（都在 {#if} 裡）。
	// 見 src/routes/+page.server.ts 對 stale-while-revalidate 的說明。
	setHeaders({ 'Cache-Control': 'public, max-age=15, stale-while-revalidate=60' });

	return json(bracket);
};
