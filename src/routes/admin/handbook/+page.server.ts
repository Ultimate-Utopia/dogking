import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import { CHIPS_PER_TWD } from '$lib/server/purchase';

/**
 * 周邊發幣作業手冊。純說明頁，不動任何資料。
 *
 * 寫成網頁而不是另外發一份文件，是因為負責發幣的人就是在後台裡做這件事 ——
 * 手冊放在旁邊一個連結就能開，比翻聊天記錄裡的檔案可靠得多。
 */
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.user);
	return { rate: CHIPS_PER_TWD };
};
