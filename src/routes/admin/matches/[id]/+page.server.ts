import { fail, error, redirect } from '@sveltejs/kit';
import { eq, asc } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { matches, markets, participants } from '$lib/server/db/schema';
import {
	openMarket,
	lockMarket,
	scheduleLock,
	settleMarket,
	voidMarket,
	previewSettle,
	setMatchParticipants,
	updateMatchScore,
	calcOdds
} from '$lib/server/tournament';
import { requireAdmin, logAdmin } from '$lib/server/admin';
import type { Side } from '$lib/server/db/schema';

/** BO1 → 1 局，BO3 → 最多 3 局，BO5 → 最多 5 局 */
const MAX_GAMES: Record<string, number> = { BO1: 1, BO3: 3, BO5: 5 };

export const load: PageServerLoad = async ({ params, url }) => {
	const matchId = Number(params.id);
	if (!Number.isInteger(matchId)) error(400, '場次編號無效');

	const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
	if (!match) error(404, '找不到這個場次');

	const marketRows = await db
		.select()
		.from(markets)
		.where(eq(markets.matchId, matchId))
		.orderBy(asc(markets.gameNo));

	const allParticipants = await db.select().from(participants).orderBy(asc(participants.orderNo));

	// 若網址帶了 ?confirm=<marketId>&side=<blue|red>，就先算出結算預覽給操作員看
	const confirmId = Number(url.searchParams.get('confirm'));
	const confirmSide = url.searchParams.get('side') as Side | null;
	const preview =
		Number.isInteger(confirmId) && confirmId > 0 && (confirmSide === 'blue' || confirmSide === 'red')
			? { marketId: confirmId, side: confirmSide, ...(await previewSettle(confirmId, confirmSide)) }
			: null;

	return {
		match,
		participants: allParticipants,
		maxGames: MAX_GAMES[match.format] ?? 1,
		markets: marketRows.map((m) => ({ ...m, odds: calcOdds(m.poolBlue, m.poolRed) })),
		preview
	};
};

/** 把領域層丟出的錯誤轉成畫面上看得懂的訊息。 */
function toFail(e: unknown) {
	const message = e instanceof Error ? e.message : '操作失敗';
	return fail(400, { error: message });
}

export const actions: Actions = {
	setParticipants: async ({ request, params, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const blue = form.get('blue') ? Number(form.get('blue')) : null;
		const red = form.get('red') ? Number(form.get('red')) : null;

		try {
			await setMatchParticipants(Number(params.id), blue, red);
			await logAdmin(admin.id, '設定對戰組合', `場次 ${params.id}`, { blue, red });
			return { success: '對戰組合已更新' };
		} catch (e) {
			return toFail(e);
		}
	},

	updateScore: async ({ request, params, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const scoreBlue = Number(form.get('scoreBlue') ?? 0);
		const scoreRed = Number(form.get('scoreRed') ?? 0);
		const state = String(form.get('state') ?? 'pending');
		const winnerRaw = String(form.get('winnerSide') ?? '');
		const winnerSide = winnerRaw === 'blue' || winnerRaw === 'red' ? winnerRaw : null;

		if (scoreBlue < 0 || scoreRed < 0) return fail(400, { error: '比分不能是負數' });

		try {
			await updateMatchScore(Number(params.id), scoreBlue, scoreRed, state, winnerSide);
			await logAdmin(admin.id, '更新比分', `場次 ${params.id}`, {
				scoreBlue,
				scoreRed,
				state,
				winnerSide
			});
			return { success: '比分已更新' };
		} catch (e) {
			return toFail(e);
		}
	},

	openMarket: async ({ request, params, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const gameNo = Number(form.get('gameNo') ?? 0);

		try {
			const market = await openMarket(Number(params.id), gameNo);
			await logAdmin(admin.id, '開盤', `盤口 ${market.id}`, { matchId: params.id, gameNo });
			return { success: gameNo === 0 ? '整場盤已開放下注' : `第 ${gameNo} 局盤已開放下注` };
		} catch (e) {
			return toFail(e);
		}
	},

	lockMarket: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));

		try {
			await lockMarket(marketId);
			await logAdmin(admin.id, '封盤', `盤口 ${marketId}`);
			return { success: '已封盤，不再接受下注' };
		} catch (e) {
			return toFail(e);
		}
	},

	scheduleLock: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const seconds = Number(form.get('seconds') ?? 60);

		try {
			await scheduleLock(marketId, seconds);
			await logAdmin(admin.id, `設定 ${seconds} 秒後封盤`, `盤口 ${marketId}`);
			return { success: `已設定 ${seconds} 秒後封盤，前台開始倒數` };
		} catch (e) {
			return toFail(e);
		}
	},

	settle: async ({ request, params, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const side = String(form.get('side'));

		if (side !== 'blue' && side !== 'red') return fail(400, { error: '勝方無效' });

		try {
			const result = await settleMarket(marketId, side);
			await logAdmin(admin.id, '派彩', `盤口 ${marketId}`, result);
			redirect(303, `/admin/matches/${params.id}`);
		} catch (e) {
			// redirect 是用丟出例外實作的，不能被當成錯誤吞掉
			if (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
			return toFail(e);
		}
	},

	voidMarket: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const marketId = Number(form.get('marketId'));
		const reason = String(form.get('reason') || '後台取消');

		try {
			const result = await voidMarket(marketId, reason);
			await logAdmin(admin.id, '取消並退款', `盤口 ${marketId}`, result);
			return { success: `已取消並退款 ${result.betsRefunded} 筆，共 ${result.paidOut} 狗狗幣` };
		} catch (e) {
			return toFail(e);
		}
	}
};
