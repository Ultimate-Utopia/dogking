/**
 * 後台權限與操作紀錄 —— 對應規格書 §04
 *
 * 每一個會改變狀態的後台動作都必須寫入 admin_logs。
 * 活動當天若有爭議，這是唯一能還原「誰在幾點對哪個應援場做了什麼」的依據。
 */

import { error } from '@sveltejs/kit';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { adminLogs, bets, users } from './db/schema';
import type { SessionUser } from './auth';

/** 未登入回 401，非管理員回 403。 */
export function requireAdmin(user: SessionUser | null): SessionUser {
	if (!user) error(401, '請先登入');
	if (!user.isAdmin) error(403, '需要管理員權限');
	return user;
}

export async function logAdmin(
	adminUserId: string,
	action: string,
	target: string,
	payload?: unknown
) {
	await db.insert(adminLogs).values({
		adminUserId,
		action,
		target,
		payload: payload === undefined ? null : (payload as object)
	});
}

/** 近期操作紀錄，後台首頁顯示。 */
export async function recentAdminLogs(limit = 30) {
	return db
		.select({
			id: adminLogs.id,
			action: adminLogs.action,
			target: adminLogs.target,
			payload: adminLogs.payload,
			createdAt: adminLogs.createdAt,
			adminName: users.displayName
		})
		.from(adminLogs)
		.innerJoin(users, eq(adminLogs.adminUserId, users.id))
		.orderBy(desc(adminLogs.id))
		.limit(limit);
}

/**
 * 預測戰績 —— 誰猜中的場次最多。
 *
 * 主持群想在台上點名「今天猜最準的是誰」，所以要能排出來。
 *
 * 只算「已結算」的應援：
 *   ・pending 還沒有結果，算進去會讓剛下注的人看起來很準
 *   ・refunded 是整場取消（平局、退賽），不是猜錯，不該拉低命中率
 *
 * 排序以猜中次數為主，同樣次數時投入多的在前 —— 一次就猜中的人
 * 和猜中十次的人排在一起沒有意義，而次數一樣時「押得更重」更值得講。
 *
 * ⚠️ amount／payout 是 bigint，postgres.js 會以字串回傳，一定要 Number()，
 *    否則相加會變成字串相接。
 */
export async function predictionLeaderboard(limit = 10) {
	const wonCount = sql<number>`count(*) filter (where ${bets.state} = 'won')`;
	const stakedSum = sql<number>`coalesce(sum(${bets.amount}), 0)`;

	const rows = await db
		.select({
			displayName: users.displayName,
			won: wonCount,
			total: sql<number>`count(*)`,
			staked: stakedSum,
			returned: sql<number>`coalesce(sum(${bets.payout}), 0)`
		})
		.from(bets)
		.innerJoin(users, eq(bets.userId, users.id))
		.where(inArray(bets.state, ['won', 'lost']))
		.groupBy(users.id, users.displayName)
		.orderBy(desc(wonCount), desc(stakedSum))
		.limit(limit);

	return rows.map((r) => {
		const won = Number(r.won);
		const total = Number(r.total);
		const staked = Number(r.staked);
		const returned = Number(r.returned);
		return {
			displayName: r.displayName,
			won,
			total,
			/** 命中率，百分比整數。沒有已結算的應援時為 0。 */
			rate: total > 0 ? Math.round((won / total) * 100) : 0,
			staked,
			returned,
			/** 淨損益。發放金額含本金，所以直接相減就是賺賠。 */
			net: returned - staked
		};
	});
}
