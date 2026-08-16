/**
 * 帳本自我測試 —— 僅在開發模式可用。
 *
 * 驗證規格書 §05 的三個保證：
 *   1. 餘額由 ledger 加總得出
 *   2. 餘額不足時拒絕扣款
 *   3. 併發扣款不會造成負餘額（這是下注流程的命脈）
 *
 * 測試會建立臨時使用者，結束後自行清除。
 * 之後實作下注時，這裡應該再加上「彩池分配結算」的測試。
 */

import { json, error, type Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { users, ledger, sessions, matches, markets, bets } from '$lib/server/db/schema';
import {
	getBalance,
	writeLedger,
	lockUser,
	InsufficientBalanceError
} from '$lib/server/ledger';
import { createSession, resolveSession, destroySession } from '$lib/server/auth';
import {
	openMarket,
	lockMarket,
	placeBet,
	settleMarket,
	voidMarket,
	calcOdds,
	calcPayout,
	deleteMarketsForMatches
} from '$lib/server/tournament';

/** 假的 cookie 容器，讓我們能在不經過瀏覽器的情況下測試 session。 */
function stubCookies() {
	const jar = new Map<string, string>();
	return {
		jar,
		cookies: {
			get: (name: string) => jar.get(name),
			set: (name: string, value: string) => void jar.set(name, value),
			delete: (name: string) => void jar.delete(name),
			getAll: () => [...jar].map(([name, value]) => ({ name, value })),
			serialize: () => ''
		} as unknown as Cookies
	};
}

interface Result {
	name: string;
	pass: boolean;
	detail: string;
}

export const GET: RequestHandler = async () => {
	if (!dev) error(404, 'Not found');

	const results: Result[] = [];
	const createdIds: string[] = [];
	const createdMatchIds: number[] = [];

	const makeUser = async (tag: string) => {
		const [u] = await db
			.insert(users)
			.values({ discordId: `selftest-${tag}-${crypto.randomUUID()}`, displayName: `測試-${tag}` })
			.returning();
		createdIds.push(u.id);
		return u.id;
	};

	/** 建立測試使用者並直接入帳指定金額。 */
	const makeFundedUser = async (tag: string, amount: number) => {
		const uid = await makeUser(tag);
		await db.transaction(async (tx) => {
			await lockUser(tx, uid);
			await writeLedger(tx, { userId: uid, type: 'adjust', amount, note: '測試入帳' });
		});
		return uid;
	};

	/** 建立臨時場次，供盤口測試使用。 */
	const makeMatch = async (tag: string) => {
		const [m] = await db
			.insert(matches)
			.values({ orderNo: 900, roundLabel: `測試-${tag}`, format: 'BO1' })
			.returning();
		createdMatchIds.push(m.id);
		return m.id;
	};

	try {
		// ── 1. 餘額由帳本加總 ────────────────────────────────
		{
			const uid = await makeUser('balance');
			await db.transaction(async (tx) => {
				await lockUser(tx, uid);
				await writeLedger(tx, { userId: uid, type: 'signup', amount: 1000, note: '註冊贈送' });
			});
			await db.transaction(async (tx) => {
				await lockUser(tx, uid);
				await writeLedger(tx, { userId: uid, type: 'purchase', amount: 30000, note: '周邊訂單' });
			});

			const balance = await getBalance(uid);
			results.push({
				name: '餘額由帳本加總',
				pass: balance === 31000,
				detail: `期望 31000，實得 ${balance}`
			});
		}

		// ── 2. 餘額不足時拒絕 ────────────────────────────────
		{
			const uid = await makeUser('insufficient');
			await db.transaction(async (tx) => {
				await lockUser(tx, uid);
				await writeLedger(tx, { userId: uid, type: 'signup', amount: 1000 });
			});

			let rejected = false;
			let message = '';
			try {
				await db.transaction(async (tx) => {
					await lockUser(tx, uid);
					await writeLedger(tx, { userId: uid, type: 'bet', amount: -1500 });
				});
			} catch (e) {
				rejected = e instanceof InsufficientBalanceError;
				message = (e as Error).message;
			}

			const balance = await getBalance(uid);
			results.push({
				name: '餘額不足時拒絕扣款',
				pass: rejected && balance === 1000,
				detail: rejected ? `已拒絕（${message}），餘額仍為 ${balance}` : '未被拒絕 —— 有問題'
			});
		}

		// ── 3. 併發扣款不會超扣 ──────────────────────────────
		// 餘額 1000，同時送出 10 筆各 200 的扣款。
		// 正確行為：恰好 5 筆成功、5 筆被拒，最終餘額 0。
		// 若少了 lockUser()，多筆會讀到同一個舊餘額而全部通過，造成負餘額。
		{
			const uid = await makeUser('concurrent');
			await db.transaction(async (tx) => {
				await lockUser(tx, uid);
				await writeLedger(tx, { userId: uid, type: 'signup', amount: 1000 });
			});

			const attempts = Array.from({ length: 10 }, () =>
				db
					.transaction(async (tx) => {
						await lockUser(tx, uid);
						await writeLedger(tx, { userId: uid, type: 'bet', amount: -200 });
					})
					.then(
						() => 'ok' as const,
						() => 'rejected' as const
					)
			);

			const outcomes = await Promise.all(attempts);
			const ok = outcomes.filter((o) => o === 'ok').length;
			const balance = await getBalance(uid);

			results.push({
				name: '併發扣款不會超扣',
				pass: ok === 5 && balance === 0,
				detail: `10 筆併發扣款：成功 ${ok} 筆（期望 5），最終餘額 ${balance}（期望 0，絕不可為負）`
			});
		}
		// ── 4. session 建立後可解析，登出後失效 ──────────────
		{
			const uid = await makeUser('session');
			const { jar, cookies } = stubCookies();

			await createSession(uid, cookies);
			const token = jar.get('dogking_session');

			const rows = await db.select().from(sessions).where(eq(sessions.userId, uid));
			const resolved = await resolveSession(token);

			await destroySession(token, cookies);
			const afterLogout = await resolveSession(token);

			results.push({
				name: 'session 建立後可解析，登出後失效',
				pass: rows.length === 1 && resolved?.id === uid && afterLogout === null,
				detail:
					`資料列 ${rows.length} 筆（期望 1）、` +
					`解析${resolved?.id === uid ? '成功' : '失敗'}、` +
					`登出後${afterLogout === null ? '已失效' : '仍有效 —— 有問題'}`
			});
		}

		// ── 5. 凍結帳號立即使 session 失效 ───────────────────
		// 這是選 session 而非 JWT 的理由（規格書 §10 小號防堵）。
		{
			const uid = await makeUser('frozen');
			const { jar, cookies } = stubCookies();

			await createSession(uid, cookies);
			const token = jar.get('dogking_session');
			const before = await resolveSession(token);

			await db.update(users).set({ status: 'frozen' }).where(eq(users.id, uid));
			const after = await resolveSession(token);

			results.push({
				name: '凍結帳號立即使 session 失效',
				pass: before?.id === uid && after === null,
				detail:
					`凍結前${before?.id === uid ? '有效' : '無效 —— 有問題'}、` +
					`凍結後${after === null ? '立即失效' : '仍可登入 —— 有問題'}`
			});
		}
		// ── 6. 彩池分配結算金額正確 ─────────────────────────
		// 直接照規格書 §05 的算例：藍 40,000 / 紅 60,000，紅方獲勝。
		// 押紅方 5,000 者應領回 floor(5000 × 100000 / 60000) = 8333。
		{
			const mid = await makeMatch('payout');
			const market = await openMarket(mid, 0);

			const blue = await makeFundedUser('blue', 40000);
			const redBig = await makeFundedUser('redbig', 55000);
			const redSmall = await makeFundedUser('redsmall', 5000);

			await placeBet({ userId: blue, marketId: market.id, side: 'blue', amount: 40000, idempotencyKey: crypto.randomUUID() });
			await placeBet({ userId: redBig, marketId: market.id, side: 'red', amount: 55000, idempotencyKey: crypto.randomUUID() });
			await placeBet({ userId: redSmall, marketId: market.id, side: 'red', amount: 5000, idempotencyKey: crypto.randomUUID() });

			const odds = calcOdds(40000, 60000);
			await lockMarket(market.id);
			const result = await settleMarket(market.id, 'red');

			const smallBalance = await getBalance(redSmall);
			const blueBalance = await getBalance(blue);
			const expected = calcPayout(5000, 60000, 100000); // 8333

			results.push({
				name: '彩池分配結算金額正確（規格書 §05 算例）',
				pass:
					result.totalPool === 100000 &&
					expected === 8333 &&
					smallBalance === 8333 &&
					blueBalance === 0 &&
					result.betsWon === 2 &&
					result.betsLost === 1,
				detail:
					`總池 ${result.totalPool}、` +
					`賠率 藍 ${odds.blue?.toFixed(2)} / 紅 ${odds.red?.toFixed(2)}、` +
					`押紅 5000 領回 ${smallBalance}（期望 8333）、` +
					`押藍者歸零 ${blueBalance === 0}、` +
					`贏 ${result.betsWon} 輸 ${result.betsLost}`
			});
		}

		// ── 7. 除不盡時無條件捨去，派彩不超過總池 ───────────
		{
			const mid = await makeMatch('rounding');
			const market = await openMarket(mid, 0);

			// 藍 1 / 紅 3：紅方賠率 4/3，除不盡
			const a = await makeFundedUser('r-a', 1000);
			const b = await makeFundedUser('r-b', 1000);
			const c = await makeFundedUser('r-c', 1000);
			const d = await makeFundedUser('r-d', 1000);

			await placeBet({ userId: a, marketId: market.id, side: 'blue', amount: 100, idempotencyKey: crypto.randomUUID() });
			await placeBet({ userId: b, marketId: market.id, side: 'red', amount: 100, idempotencyKey: crypto.randomUUID() });
			await placeBet({ userId: c, marketId: market.id, side: 'red', amount: 100, idempotencyKey: crypto.randomUUID() });
			await placeBet({ userId: d, marketId: market.id, side: 'red', amount: 100, idempotencyKey: crypto.randomUUID() });

			await lockMarket(market.id);
			const result = await settleMarket(market.id, 'red');

			// 每人 floor(100 × 400 / 300) = 133，三人共 399，餘 1 留在系統
			results.push({
				name: '除不盡時無條件捨去，餘數留在系統',
				pass: result.paidOut === 399 && result.remainder === 1 && result.paidOut <= result.totalPool,
				detail: `總池 ${result.totalPool}、派出 ${result.paidOut}、餘數 ${result.remainder}（派彩絕不可超過總池）`
			});
		}

		// ── 8. 贏方無人下注 → 全額退款 ──────────────────────
		{
			const mid = await makeMatch('noWinner');
			const market = await openMarket(mid, 0);
			const only = await makeFundedUser('only', 1000);

			await placeBet({ userId: only, marketId: market.id, side: 'blue', amount: 700, idempotencyKey: crypto.randomUUID() });
			await lockMarket(market.id);
			const result = await settleMarket(market.id, 'red'); // 紅方沒人押卻贏

			const balance = await getBalance(only);
			results.push({
				name: '贏方無人下注時全額退款',
				pass: result.outcome === 'refunded' && balance === 1000,
				detail: `結果 ${result.outcome}、退款 ${result.betsRefunded} 筆、餘額回到 ${balance}（期望 1000）`
			});
		}

		// ── 9. 取消盤口 → 全額退款（平局／退賽／爭議）───────
		{
			const mid = await makeMatch('void');
			const market = await openMarket(mid, 0);
			const x = await makeFundedUser('v-x', 1000);
			const y = await makeFundedUser('v-y', 1000);

			await placeBet({ userId: x, marketId: market.id, side: 'blue', amount: 300, idempotencyKey: crypto.randomUUID() });
			await placeBet({ userId: y, marketId: market.id, side: 'red', amount: 800, idempotencyKey: crypto.randomUUID() });

			const result = await voidMarket(market.id, '平局');
			const bx = await getBalance(x);
			const by = await getBalance(y);

			results.push({
				name: '取消盤口時全額退款',
				pass: result.betsRefunded === 2 && bx === 1000 && by === 1000,
				detail: `退款 ${result.betsRefunded} 筆、雙方餘額 ${bx} / ${by}（皆期望 1000）`
			});
		}

		// ── 10. 封盤後不能下注（伺服器時間為準）─────────────
		{
			const mid = await makeMatch('closed');
			const market = await openMarket(mid, 0);
			const u = await makeFundedUser('closed-u', 1000);

			await lockMarket(market.id);

			let rejected = false;
			try {
				await placeBet({ userId: u, marketId: market.id, side: 'blue', amount: 100, idempotencyKey: crypto.randomUUID() });
			} catch {
				rejected = true;
			}

			const balance = await getBalance(u);
			results.push({
				name: '封盤後不能下注',
				pass: rejected && balance === 1000,
				detail: rejected ? `已拒絕，餘額未變動（${balance}）` : '竟然下注成功 —— 有問題'
			});
		}

		// ── 11. 冪等鍵防止重複下注 ──────────────────────────
		{
			const mid = await makeMatch('idem');
			const market = await openMarket(mid, 0);
			const u = await makeFundedUser('idem-u', 1000);
			const key = crypto.randomUUID();

			const first = await placeBet({ userId: u, marketId: market.id, side: 'blue', amount: 250, idempotencyKey: key });
			const second = await placeBet({ userId: u, marketId: market.id, side: 'blue', amount: 250, idempotencyKey: key });

			const balance = await getBalance(u);
			results.push({
				name: '冪等鍵防止重複下注',
				pass: first.id === second.id && balance === 750,
				detail: `兩次呼叫回傳同一筆注（${first.id === second.id}），只扣一次款，餘額 ${balance}（期望 750）`
			});
		}

		// ── 12. 未封盤不能結算，且不能重複結算 ──────────────
		{
			const mid = await makeMatch('guard');
			const market = await openMarket(mid, 0);
			const u = await makeFundedUser('guard-u', 1000);
			await placeBet({ userId: u, marketId: market.id, side: 'blue', amount: 100, idempotencyKey: crypto.randomUUID() });

			let blockedWhileOpen = false;
			try {
				await settleMarket(market.id, 'blue');
			} catch {
				blockedWhileOpen = true;
			}

			await lockMarket(market.id);
			await settleMarket(market.id, 'blue');

			let blockedDouble = false;
			try {
				await settleMarket(market.id, 'blue');
			} catch {
				blockedDouble = true;
			}

			const balance = await getBalance(u);
			results.push({
				name: '未封盤不能結算，且不能重複結算',
				pass: blockedWhileOpen && blockedDouble && balance === 1000,
				detail:
					`開放中結算${blockedWhileOpen ? '已擋下' : '未擋 —— 有問題'}、` +
					`重複結算${blockedDouble ? '已擋下' : '未擋 —— 有問題'}、` +
					`餘額 ${balance}（只派彩一次，期望 1000）`
			});
		}
	} finally {
		// 清理順序必須順著外鍵反向走：
		//   ledger 參照 bets 與 markets，所以帳本要最先刪，
		//   否則刪 bets 會被外鍵擋下。
		if (createdIds.length) {
			await db.delete(sessions).where(inArray(sessions.userId, createdIds));
			await db.delete(ledger).where(inArray(ledger.userId, createdIds));
		}
		if (createdMatchIds.length) await deleteMarketsForMatches(createdMatchIds);
		if (createdIds.length) {
			await db.delete(users).where(inArray(users.id, createdIds));
		}
		if (createdMatchIds.length) {
			await db.delete(matches).where(inArray(matches.id, createdMatchIds));
		}
	}

	const passed = results.filter((r) => r.pass).length;
	return json({ passed, total: results.length, allPassed: passed === results.length, results });
};
