import type { PageServerLoad } from './$types';
import { getBalance, getHistory } from '$lib/server/ledger';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { user: null, balance: 0, history: [] };
	}

	const [balance, history] = await Promise.all([
		getBalance(locals.user.id),
		getHistory(locals.user.id, 20)
	]);

	return { user: locals.user, balance, history };
};
