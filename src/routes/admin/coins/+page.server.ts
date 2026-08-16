import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { requireAdmin, logAdmin } from '$lib/server/admin';
import {
	parseCsv,
	previewImport,
	commitImport,
	createRedeemCodes,
	backfillPublicCodes,
	recentOrders,
	codeStats,
	unusedCodes,
	PurchaseError,
	CHIPS_PER_TWD,
	type ImportRow
} from '$lib/server/purchase';

export const load: PageServerLoad = async () => {
	const [orders, stats, codes] = await Promise.all([recentOrders(20), codeStats(), unusedCodes(30)]);
	return { orders, stats, codes, rate: CHIPS_PER_TWD };
};

export const actions: Actions = {
	/** 解析 CSV 並試算，不寫入任何東西。 */
	preview: async ({ request, locals }) => {
		requireAdmin(locals.user);
		const form = await request.formData();

		const platform = String(form.get('platform') ?? '賣貨便');
		const csv = String(form.get('csv') ?? '');
		const hasHeader = form.get('hasHeader') === 'on';
		const cols = {
			orderRef: Number(form.get('colOrderRef') ?? 0),
			amount: Number(form.get('colAmount') ?? 1),
			note: Number(form.get('colNote') ?? 2)
		};

		if (!csv.trim()) return fail(400, { error: '請先貼上 CSV 內容' });

		const rows = parseCsv(csv);
		if (!rows.length) return fail(400, { error: 'CSV 看起來是空的' });

		try {
			// 包成單一物件，前端只要檢查 form?.imported 就能安全取用全部欄位
			const preview = await previewImport(platform, rows, cols, hasHeader);
			return { imported: { preview, platform, csv, hasHeader, cols } };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : '解析失敗' });
		}
	},

	/**
	 * 真的發出去。
	 *
	 * 刻意用原始 CSV 在伺服器端重新推導一次，而不是信任前端送回來的預覽結果 ——
	 * 預覽到按下確認之間可能已經有別的管理員匯入同一批訂單，
	 * 或使用者的代碼有變動。以送出當下的資料庫狀態為準才安全。
	 */
	commit: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();

		const platform = String(form.get('platform') ?? '賣貨便');
		const csv = String(form.get('csv') ?? '');
		const hasHeader = form.get('hasHeader') === 'on';
		const cols = {
			orderRef: Number(form.get('colOrderRef') ?? 0),
			amount: Number(form.get('colAmount') ?? 1),
			note: Number(form.get('colNote') ?? 2)
		};

		if (!csv.trim()) return fail(400, { error: '資料遺失，請重新預覽' });

		const rows: ImportRow[] = await previewImport(platform, parseCsv(csv), cols, hasHeader);
		const result = await commitImport(platform, rows, admin.id);
		await logAdmin(admin.id, '匯入訂單發幣', platform, result);

		return {
			success:
				`已發放 ${result.credited} 筆，共 ${result.chips.toLocaleString('zh-TW')} 狗狗幣` +
				(result.skipped ? `（略過重複 ${result.skipped} 筆）` : '')
		};
	},

	makeCodes: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();

		const count = Number(form.get('count') ?? 1);
		const amount = Number(form.get('amount') ?? 0);
		const orderRef = String(form.get('orderRef') ?? '').trim();

		try {
			const codes = await createRedeemCodes(count, amount, orderRef || undefined);
			await logAdmin(admin.id, '產生兌換碼', `${count} 組 × ${amount}`, { orderRef });
			return { codes, success: `已產生 ${codes.length} 組兌換碼` };
		} catch (e) {
			if (e instanceof PurchaseError) return fail(400, { error: e.message });
			return fail(400, { error: '產生失敗' });
		}
	},

	/** 補發公開代碼給還沒有的帳號。 */
	backfill: async ({ locals }) => {
		const admin = requireAdmin(locals.user);
		const n = await backfillPublicCodes();
		await logAdmin(admin.id, '補發公開代碼', `${n} 個帳號`);
		return { success: n > 0 ? `已補發 ${n} 個帳號的代碼` : '所有帳號都已經有代碼了' };
	}
};
