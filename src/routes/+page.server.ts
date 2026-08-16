import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getBoardState, getLeaderboard, getRoster } from '$lib/server/board';
import { placeBet } from '$lib/server/tournament';
import { InsufficientBalanceError } from '$lib/server/ledger';

/**
 * 首頁只回傳「所有人都一樣」的資料，讓整頁可以被 CDN 快取。
 *
 * ⚠️ 絕對不要把餘額或個人下注紀錄加回這裡。
 *
 * 原本這裡會一併載入使用者資料，導致整頁無法快取 —— 每個觀眾的每次
 * 重新整理都會叫起一個 Function 並開資料庫連線。實測下來首頁的失敗率
 * 高達 35%（連線池被打爆後請求排隊到逾時），而同樣資料量、
 * 但有 3 秒快取的 /api/board 則是 20/20 全部成功。
 *
 * 個人資料改由前端向 /api/me 取得（那支是 private, no-store）。
 * 代價是登入狀態會在 JS 載入後才出現，換來的是整站扛得住活動當天的流量。
 */
export const load: PageServerLoad = async ({ setHeaders }) => {
	const [board, leaderboard, roster] = await Promise.all([
		getBoardState(),
		getLeaderboard(5),
		getRoster()
	]);

	setHeaders({ 'Cache-Control': 'public, max-age=3, stale-while-revalidate=10' });

	return { board, leaderboard, roster };
};

export const actions: Actions = {
	bet: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: '請先登入' });

		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const side = String(form.get('side'));
		const amount = Number(form.get('amount'));
		const idempotencyKey = String(form.get('idempotencyKey') ?? '');

		if (side !== 'blue' && side !== 'red') return fail(400, { error: '請選擇要押哪一邊' });
		if (!Number.isInteger(amount) || amount <= 0) return fail(400, { error: '下注金額無效' });
		if (!idempotencyKey) return fail(400, { error: '請重新整理後再試一次' });

		try {
			await placeBet({ userId: locals.user.id, marketId, side, amount, idempotencyKey });
			return { success: `已押注 ${amount.toLocaleString('zh-TW')} 狗狗幣` };
		} catch (e) {
			if (e instanceof InsufficientBalanceError) {
				return fail(400, { error: `狗狗幣不足，你目前只有 ${e.balance.toLocaleString('zh-TW')}` });
			}
			return fail(400, { error: e instanceof Error ? e.message : '下注失敗，請再試一次' });
		}
	}
};
