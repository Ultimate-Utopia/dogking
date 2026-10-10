import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { requireAdmin, logAdmin } from '$lib/server/admin';
import {
	previewCsv,
	commitImport,
	revokeOrders,
	deductByPublicCode,
	issueVoucherForOrder,
	createRedeemCodes,
	backfillPublicCodes,
	recentOrders,
	codeStats,
	unusedCodes,
	PurchaseError,
	CHIPS_PER_TWD
} from '$lib/server/purchase';
import { ECPAY_DEFAULT_SHOP } from '$lib/order-formats';

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
		const shop = String(form.get('shop') ?? ECPAY_DEFAULT_SHOP).trim();
		const cols = {
			orderRef: Number(form.get('colOrderRef') ?? 0),
			amount: Number(form.get('colAmount') ?? 1),
			note: Number(form.get('colNote') ?? 2)
		};

		if (!csv.trim()) return fail(400, { error: '請先選擇匯出檔，或貼上 CSV 內容' });

		try {
			const result = await previewCsv(platform, csv, cols, hasHeader, shop);
			if (!result.rows.length) {
				// 綠界匯出會連同一個帳號的其他賣場一起下載，濾不到時要講清楚檔案裡有什麼
				if (result.shops?.length) {
					const list = result.shops.map((s) => `${s.name}（${s.count} 筆）`).join('、');
					return fail(400, {
						error: `這份檔案裡沒有賣場名稱含「${shop}」的訂單。檔案裡有：${list}。` +
							'請確認匯出的是賽事賣場的訂單，或到下方「手動指定欄位」改賣場名稱。'
					});
				}
				return fail(400, { error: '檔案裡找不到任何訂單。若不是賣貨便的匯出檔，請確認欄位位置設定。' });
			}
			// 包成單一物件，前端只要檢查 form?.imported 就能安全取用全部欄位。
			// platform 用辨識後的結果，不是下拉選單的值（見 previewCsv 的說明）
			return {
				imported: {
					preview: result.rows,
					format: result.format,
					platform: result.platform,
					csv,
					hasHeader,
					cols,
					shop: result.shop ?? '',
					shops: result.shops ?? [],
					// 與 issueCode 的回傳形狀保持一致，前端才不用處理兩種形狀
					issued: null as { orderRef: string; code: string; amount: number; reused: boolean } | null
				}
			};
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

		// 重新辨識一次；平台名稱與賣場過濾都要與預覽時一致
		const again = await previewCsv(platform, csv, cols, hasHeader, String(form.get('shop') ?? ECPAY_DEFAULT_SHOP).trim());
		const result = await commitImport(again.platform, again.rows, admin.id);
		await logAdmin(admin.id, '匯入訂單發幣', again.platform, { ...result, format: again.format });

		return {
			success:
				`已發放 ${result.credited} 筆，共 ${result.chips.toLocaleString('zh-TW')} 狗狗幣` +
				(result.skipped ? `（略過重複 ${result.skipped} 筆）` : '')
		};
	},

	/**
	 * 把「已發幣但後來被取消」的訂單收回來。
	 *
	 * 和 commit 一樣用原始 CSV 在伺服器端重新推導，不信任前端送回來的預覽 ——
	 * 預覽到按下收回之間，別的管理員可能已經處理過了。
	 */
	revoke: async ({ request, locals }) => {
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

		const again = await previewCsv(platform, csv, cols, hasHeader, String(form.get('shop') ?? ECPAY_DEFAULT_SHOP).trim());
		const result = await revokeOrders(again.platform, again.rows, admin.id);
		await logAdmin(admin.id, '收回已取消訂單的狗狗幣', again.platform, result);

		if (result.revoked === 0) {
			return { success: '沒有需要收回的訂單（可能已經處理過了）' };
		}

		const parts = [`已收回 ${result.revoked} 筆訂單，共 ${result.chips.toLocaleString('zh-TW')} 狗狗幣`];
		if (result.short.length) {
			// 餘額不夠的要寫出來 —— 幣已經應援出去了，差額收不回來
			const list = result.short
				.map((s) => `${s.displayName}（訂單 ${s.orderRef} 應收 ${s.wanted.toLocaleString('zh-TW')}、實收 ${s.taken.toLocaleString('zh-TW')}）`)
				.join('、');
			parts.push(`其中 ${result.short.length} 筆餘額不足，只收回部分：${list}`);
		}
		if (result.failed) parts.push(`${result.failed} 筆失敗，請重新預覽確認`);
		return { success: parts.join('。') };
	},

	/**
	 * 指定訂單備註碼人工扣除。
	 *
	 * 給系統判斷不到的狀況用：平台上沒標成取消但實際退款了、重複下單、違規等等。
	 * 理由必填，會原封不動寫進帳本 —— 事後有爭議時那一行就是唯一依據。
	 */
	deduct: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();

		const code = String(form.get('code') ?? '');
		const amount = Number(form.get('amount') ?? 0);
		const reason = String(form.get('reason') ?? '');

		try {
			const r = await deductByPublicCode(code, amount, reason, admin.id);
			await logAdmin(admin.id, '人工扣除狗狗幣', `${r.publicCode} −${amount}`, { reason, after: r.after });
			return {
				success:
					`已從 ${r.displayName}（${r.publicCode}）扣除 ${amount.toLocaleString('zh-TW')} 狗狗幣：` +
					`${r.before.toLocaleString('zh-TW')} → ${r.after.toLocaleString('zh-TW')}`
			};
		} catch (e) {
			if (e instanceof PurchaseError) return fail(400, { error: e.message });
			return fail(400, { error: '扣除失敗，請再試一次' });
		}
	},

	/**
	 * 針對預覽表格裡某一張訂單開兌換券，開完回到同一份預覽。
	 *
	 * 刻意把 csv 一起帶回來重新比對：開完券之後那一列就會變成「已開兌換券」，
	 * 操作員馬上看得到結果，下次重匯同一份檔案也一樣看得到。
	 */
	issueCode: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();

		const orderRef = String(form.get('orderRef') ?? '');
		const amountTwd = Number(form.get('amountTwd') ?? 0);
		const platform = String(form.get('platform') ?? '');
		const csv = String(form.get('csv') ?? '');
		const hasHeader = form.get('hasHeader') === 'on';
		const shop = String(form.get('shop') ?? ECPAY_DEFAULT_SHOP).trim();
		const cols = {
			orderRef: Number(form.get('colOrderRef') ?? 0),
			amount: Number(form.get('colAmount') ?? 1),
			note: Number(form.get('colNote') ?? 2)
		};

		try {
			const voucher = await issueVoucherForOrder(orderRef, amountTwd);
			if (!voucher.reused) {
				await logAdmin(admin.id, '為訂單開兌換券', orderRef, { amount: voucher.amount });
			}

			const result = await previewCsv(platform, csv, cols, hasHeader, shop);
			return {
				imported: {
					preview: result.rows,
					format: result.format,
					platform: result.platform,
					csv,
					hasHeader,
					cols,
					shop: result.shop ?? '',
					shops: result.shops ?? [],
					issued: {
						orderRef,
						code: voucher.code,
						amount: voucher.amount,
						reused: voucher.reused
					}
				}
			};
		} catch (e) {
			if (e instanceof PurchaseError) return fail(400, { error: e.message });
			return fail(400, { error: '開券失敗，請再試一次' });
		}
	},

	makeCodes: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();

		const count = Number(form.get('count') ?? 1);
		const amount = Number(form.get('amount') ?? 0);
		const orderRef = String(form.get('orderRef') ?? '').trim();

		try {
			const codes = await createRedeemCodes(count, amount, orderRef || undefined);
			await logAdmin(admin.id, '產生兌換券', `${count} 組 × ${amount}`, { orderRef });
			return { codes, success: `已產生 ${codes.length} 組兌換券` };
		} catch (e) {
			if (e instanceof PurchaseError) return fail(400, { error: e.message });
			return fail(400, { error: '產生失敗' });
		}
	},

	/** 補發訂單備註碼給還沒有的帳號。 */
	backfill: async ({ locals }) => {
		const admin = requireAdmin(locals.user);
		const n = await backfillPublicCodes();
		await logAdmin(admin.id, '補發訂單備註碼', `${n} 個帳號`);
		return { success: n > 0 ? `已補發 ${n} 個帳號的代碼` : '所有帳號都已經有代碼了' };
	}
};
