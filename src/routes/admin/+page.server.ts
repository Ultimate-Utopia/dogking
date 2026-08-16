import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { listMatches, createMatch } from '$lib/server/tournament';
import { recentAdminLogs, requireAdmin, logAdmin } from '$lib/server/admin';

export const load: PageServerLoad = async () => {
	const [matches, logs] = await Promise.all([listMatches(), recentAdminLogs(20)]);
	return { matches, logs };
};

export const actions: Actions = {
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
