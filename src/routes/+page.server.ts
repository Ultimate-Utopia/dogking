import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getBalance } from '$lib/server/ledger';
import { getBoardState, getLeaderboard, getMyBets, getRoster } from '$lib/server/board';
import { placeBet } from '$lib/server/tournament';
import { InsufficientBalanceError } from '$lib/server/ledger';

export const load: PageServerLoad = async ({ locals }) => {
	// 首次載入走 SSR，之後由前端輪詢 /api/board 更新。
	//
	// ⚠️ 全部包在同一個 Promise.all 裡，不要拆成兩段 await。
	// 正式站的 Function 與資料庫可能不在同一區，每次往返 200ms 以上，
	// 序列化執行會讓首頁直接超時（見 board.ts 裡的說明）。
	const [board, leaderboard, roster, balance, myBets] = await Promise.all([
		getBoardState(),
		getLeaderboard(5),
		getRoster(),
		locals.user ? getBalance(locals.user.id) : Promise.resolve(0),
		locals.user ? getMyBets(locals.user.id, 30) : Promise.resolve([])
	]);

	return { board, leaderboard, roster, user: locals.user, balance, myBets };
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
