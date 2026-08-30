import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getBalance, getCoinHistory } from '$lib/server/ledger';
import { redeem, PurchaseError, CHIPS_PER_TWD } from '$lib/server/purchase';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	if (!locals.user) redirect(302, '/');

	/**
	 * ⚠️ 這一頁全是個人資料（訂單備註碼、餘額、收支紀錄），
	 * 絕對不能被 CDN 快取 —— 快取了就是把甲的帳本送給乙。
	 * 首頁是快取的、這一頁必須相反，不要看到首頁那行就拿來套。
	 */
	setHeaders({ 'Cache-Control': 'private, no-store' });

	const [balance, history] = await Promise.all([
		getBalance(locals.user.id),
		getCoinHistory(locals.user.id, 60)
	]);

	return { user: locals.user, balance, history, rate: CHIPS_PER_TWD };
};

export const actions: Actions = {
	redeem: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: '請先登入' });

		const form = await request.formData();
		const code = String(form.get('code') ?? '');

		try {
			const amount = await redeem(locals.user.id, code);
			return { success: `兌換成功，獲得 ${amount.toLocaleString('zh-TW')} 狗狗幣` };
		} catch (e) {
			if (e instanceof PurchaseError) return fail(400, { error: e.message });
			return fail(400, { error: '兌換失敗，請再試一次' });
		}
	}
};
