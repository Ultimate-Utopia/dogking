import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { listMatches, createMatch, openAllMatchMarkets } from '$lib/server/tournament';
import { recentAdminLogs, requireAdmin, logAdmin } from '$lib/server/admin';

export const load: PageServerLoad = async () => {
	const [matches, logs] = await Promise.all([listMatches(), recentAdminLogs(20)]);
	return { matches, logs };
};

export const actions: Actions = {
	/**
	 * 一次開放所有場次的整場盤。活動開始前按一次即可。
	 * 已經封盤或已結算的場次不會被重新打開（見 openAllMatchMarkets）。
	 */
	openAll: async ({ locals }) => {
		const admin = requireAdmin(locals.user);
		const result = await openAllMatchMarkets();
		await logAdmin(admin.id, '一鍵開放全部場次', `新開 ${result.created} 場`, result);

		const parts = [`新開放 ${result.created} 場`];
		if (result.alreadyOpen) parts.push(`原本就開著 ${result.alreadyOpen} 場`);
		if (result.skipped.length) parts.push(`未處理 ${result.skipped.length} 場：${result.skipped.join('、')}`);
		return { success: parts.join('，') };
	},

	createMatch: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const orderNo = Number(form.get('orderNo') ?? 0);
		const roundLabel = String(form.get('roundLabel') ?? '');
		const format = String(form.get('format') ?? 'BO1');

		if (!Number.isInteger(orderNo) || orderNo <= 0) {
			return fail(400, { error: '場次編號必須是正整數' });
		}

		try {
			const created = await createMatch(orderNo, roundLabel, format);
			await logAdmin(admin.id, '新增場次', `場次 ${created.orderNo}`, { roundLabel, format });
			redirect(303, `/admin/matches/${created.id}`);
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
			return fail(400, { error: e instanceof Error ? e.message : '新增失敗' });
		}
	}
};
