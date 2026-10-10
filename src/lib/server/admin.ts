/**
 * 後台權限與操作紀錄 —— 對應規格書 §04
 *
 * 每一個會改變狀態的後台動作都必須寫入 admin_logs。
 * 活動當天若有爭議，這是唯一能還原「誰在幾點對哪個應援場做了什麼」的依據。
 */

import { error } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { adminLogs, users } from './db/schema';
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
 * 直播最後要從猜中最多次的人裡抽一位，所以全部列出來，不截斷。
 *
 * ── 一場算一次，不是一筆算一次 ─────────────────────
 * ⚠️ 這裡的單位是<strong>場次</strong>，不是注單。觀眾常常分好幾次加碼，
 * 同一場押三筆、押中了，<u>那是猜中一場，不是猜中三場</u>。
 * 所以先把 bets 依 (使用者, 應援場) 收攏，再來數。
 *
 * ── 兩邊都押的整場不算 ─────────────────────────────
 * 主辦方 10-10 定案：同一場兩邊都押，等於穩贏，<strong>即使猜對也不列入</strong>。
 * 不只不算猜中，連分母都不算 —— 否則兩邊都押會變成「故意拉低自己命中率」的
 * 怪行為，而且那一場本來就沒有預測可言。
 *
 * ── 只算已結算的 ───────────────────────────────────
 *   ・pending 還沒有結果，算進去會讓剛應援的人看起來很準
 *   ・refunded 是整場取消（平局、退賽），不是猜錯，不該拉低命中率
 *
 * 排序只看猜中場次，次數相同即為並列（rank 會重複）。
 * 主辦方 10-10：不論投入多少、什麼時候應援，猜中一次就是一次。
 *
 * ⚠️ 金額欄位是 bigint，postgres.js 會以字串回傳，一定要 Number()。
 */
export async function predictionLeaderboard() {
	const rows = (await db.execute(sql`
		WITH per_market AS (
			SELECT
				b.user_id,
				b.market_id,
				COUNT(DISTINCT b.side) AS sides,
				BOOL_OR(b.state = 'won') AS won,
				COALESCE(SUM(b.amount), 0) AS staked,
				COALESCE(SUM(b.payout), 0) AS returned
			FROM bets b
			WHERE b.state IN ('won', 'lost')
			GROUP BY b.user_id, b.market_id
		)
		SELECT
			u.display_name,
			COUNT(*) FILTER (WHERE m.sides = 1 AND m.won)::int AS won_markets,
			COUNT(*) FILTER (WHERE m.sides = 1)::int          AS counted_markets,
			COUNT(*) FILTER (WHERE m.sides > 1)::int          AS both_sides,
			COALESCE(SUM(m.staked), 0)::bigint                AS staked,
			COALESCE(SUM(m.returned), 0)::bigint              AS returned
		FROM per_market m
		JOIN users u ON u.id = m.user_id
		GROUP BY u.id, u.display_name
		ORDER BY won_markets DESC, u.display_name ASC
	`)) as unknown as Array<{
		display_name: string;
		won_markets: number;
		counted_markets: number;
		both_sides: number;
		staked: string | number;
		returned: string | number;
	}>;

	let lastWon = -1;
	let lastRank = 0;

	return rows.map((r, i) => {
		const won = Number(r.won_markets);
		const counted = Number(r.counted_markets);
		const staked = Number(r.staked);
		const returned = Number(r.returned);

		// 並列名次：猜中場次一樣就給同一個名次（1、2、2、4…）
		if (won !== lastWon) {
			lastRank = i + 1;
			lastWon = won;
		}

		return {
			rank: lastRank,
			displayName: r.display_name,
			/** 猜中的場次數。同一場加碼多次只算一次。 */
			won,
			/** 列入計算的場次數（排除兩邊都押的）。命中率的分母。 */
			counted,
			/** 兩邊都押、因此整場不列入的場次數。列出來才查得到為什麼數字對不上。 */
			bothSides: Number(r.both_sides),
			/** 命中率，百分比整數。沒有列入的場次時為 0。 */
			rate: counted > 0 ? Math.round((won / counted) * 100) : 0,
			/** 投入與領回含兩邊都押的那些 —— 那是帳，不是戰績。 */
			staked,
			returned,
			/** 淨損益。發放金額含本金，所以直接相減就是賺賠。 */
			net: returned - staked
		};
	});
}
