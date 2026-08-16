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
import { users, ledger, sessions } from '$lib/server/db/schema';
import {
	getBalance,
	writeLedger,
	lockUser,
	InsufficientBalanceError
} from '$lib/server/ledger';
import { createSession, resolveSession, destroySession } from '$lib/server/auth';

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

	const makeUser = async (tag: string) => {
		const [u] = await db
			.insert(users)
			.values({ discordId: `selftest-${tag}-${crypto.randomUUID()}`, displayName: `測試-${tag}` })
			.returning();
		createdIds.push(u.id);
		return u.id;
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
	} finally {
		// 清理：先刪帳本與 session 再刪使用者（外鍵順序）
		if (createdIds.length) {
			await db.delete(sessions).where(inArray(sessions.userId, createdIds));
			await db.delete(ledger).where(inArray(ledger.userId, createdIds));
			await db.delete(users).where(inArray(users.id, createdIds));
		}
	}

	const passed = results.filter((r) => r.pass).length;
	return json({ passed, total: results.length, allPassed: passed === results.length, results });
};
