import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getBalance } from '$lib/server/ledger';
import { redeem, PurchaseError, CHIPS_PER_TWD } from '$lib/server/purchase';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/');

	return {
		user: locals.user,
		balance: await getBalance(locals.user.id),
		rate: CHIPS_PER_TWD
	};
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
