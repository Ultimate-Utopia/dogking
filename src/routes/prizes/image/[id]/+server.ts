import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrizeImage } from '$lib/server/prizes';

/**
 * 獎品圖片。
 *
 * 網址帶 ?v=內容雜湊，換圖網址就變，所以版本對得上時可以讓 CDN 快取一年 ——
 * 活動當天幾百人開首頁，資料庫一次都不用被打到。
 * 版本對不上（舊網址、或有人亂改參數）只快取一分鐘，免得把錯的內容長期留在 CDN。
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, '找不到圖片');

	const image = await getPrizeImage(id);
	if (!image) error(404, '找不到圖片');

	const fresh = url.searchParams.get('v') === image.version;

	return new Response(new Uint8Array(image.data!), {
		headers: {
			'Content-Type': image.type!,
			'Cache-Control': fresh ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
			// 上傳時已驗過魔術位元組，這行再保險一次：瀏覽器不准自己猜類型
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
