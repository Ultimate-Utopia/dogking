import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBoardState } from '$lib/server/board';

/**
 * 公開看板資料。對所有人都一樣，因此交給 CDN 快取。
 *
 * 規格書 §09 試算：300 人每 3 秒輪詢、活動 5 小時 = 180 萬次函式呼叫，
 * 而 Netlify 免費額度是 12.5 萬次／月。加上這行快取後，
 * 打到函式的次數與人數無關，整場只有約 6,000 次。
 *
 * 代價是資料最多延遲 3 秒。封盤判定在 placeBet 內以伺服器時間執行，
 * 所以畫面慢 3 秒不會讓人下到封盤後的注。
 */
export const GET: RequestHandler = async ({ setHeaders }) => {
	const state = await getBoardState();

	// stale-while-revalidate 拉長的理由見 src/routes/+page.server.ts：
	// 太短的話，快取一過期就會有使用者被擋著等回源。
	setHeaders({
		'Cache-Control': 'public, max-age=3, stale-while-revalidate=600'
	});

	return json(state);
};
