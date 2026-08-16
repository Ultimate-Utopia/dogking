/**
 * 後台權限與操作紀錄 —— 對應規格書 §04
 *
 * 每一個會改變狀態的後台動作都必須寫入 admin_logs。
 * 活動當天若有爭議，這是唯一能還原「誰在幾點對哪個盤口做了什麼」的依據。
 */

import { error } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
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
