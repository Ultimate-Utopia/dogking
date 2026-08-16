import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBalance } from '$lib/server/ledger';
import { getMyBets } from '$lib/server/board';

/**
 * 個人資料：餘額與下注紀錄。
 *
 * ⚠️ 這裡的內容因人而異，一旦被快取就會把甲的餘額送給乙。
 * no-store 是必要的，不要為了省流量改掉。
 */
export const GET: RequestHandler = async ({ locals, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store' });

	if (!locals.user) {
		return json({ user: null, balance: 0, bets: [] });
	}

	const [balance, myBets] = await Promise.all([
		getBalance(locals.user.id),
		getMyBets(locals.user.id, 30)
	]);

	return json({
		user: {
			displayName: locals.user.displayName,
			avatarUrl: locals.user.avatarUrl,
			isAdmin: locals.user.isAdmin
		},
		balance,
		bets: myBets
	});
};
