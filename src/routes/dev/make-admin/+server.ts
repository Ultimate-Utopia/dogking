/**
 * 把目前登入的使用者設為管理員 —— 僅開發模式可用。
 *
 * 正式環境的管理員應該由資料庫直接指定，不提供這種自助途徑。
 */

import { json, error } from '@sveltejs/kit';
import { requireLocalDev } from '$lib/server/dev-guard';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';

export const GET: RequestHandler = async ({ locals }) => {
	requireLocalDev();
	if (!locals.user) error(401, '請先登入再呼叫這個端點');

	const [updated] = await db
		.update(users)
		.set({ isAdmin: true })
		.where(eq(users.id, locals.user.id))
		.returning();

	return json({
		ok: true,
		displayName: updated.displayName,
		isAdmin: updated.isAdmin,
		next: '重新整理頁面後即可進入 /admin'
	});
};
