/**
 * 周邊訂單發幣與兌換券 —— 對應規格書 §08
 *
 * 兩條路徑：
 *   主線  買家在訂單備註填自己的訂單備註碼 → 後台匯入 CSV → 比對 → 一鍵發幣
 *   補救  買家忘了填 → 後台產生兌換券 → 客服用訂單留言發給他 → 自行輸入
 *
 * 補救路徑刻意不需要知道買家是誰，所以連個資都不用碰。
 */

import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import { db } from './db';
import { users, ledger, purchaseOrders, redeemCodes } from './db/schema';
import { lockUser, writeLedger } from './ledger';
import {
	CODE_ALPHABET,
	parseCsv,
	extractCode,
	detectFormat,
	parseMyship,
	parseEcpay,
	parseByColumns,
	type ParsedOrder,
	type OrderFormat
} from '../order-formats';

// 解析函式搬到 order-formats.ts（純函式、可不連資料庫測試），這裡照舊匯出，呼叫端不必改
export { parseCsv, extractCode };

/** 換算比例：NT$1 = 100 狗狗幣（企劃書明訂） */
export const CHIPS_PER_TWD = 100;

const ALPHABET = CODE_ALPHABET;

function randomCode(len: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(len));
	return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export class PurchaseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PurchaseError';
	}
}

// ─────────────────────────────────────────────────────────
// 訂單備註碼
// ─────────────────────────────────────────────────────────

/** Drizzle 交易物件，或頂層 db。 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 產生一組沒被用過的訂單備註碼。碰撞就重試。
 *
 * ⚠️ 在交易裡呼叫時務必把 tx 傳進來。
 * 用頂層的 db 會另外向連線池要一條連線，而外層交易正握著一條 ——
 * 連線池滿的時候（serverless 的 max 設得很小）就會互相等待而卡死。
 */
export async function generatePublicCode(tx: Executor = db): Promise<string> {
	for (let i = 0; i < 20; i++) {
		const code = randomCode(6);
		const [taken] = await tx.select().from(users).where(eq(users.publicCode, code)).limit(1);
		if (!taken) return code;
	}
	throw new PurchaseError('無法產生訂單備註碼，請再試一次');
}

/** 補發代碼給還沒有的帳號（例如這個欄位新增之前就註冊的人）。 */
export async function backfillPublicCodes(): Promise<number> {
	const missing = await db.select().from(users).where(isNull(users.publicCode));
	for (const u of missing) {
		await db.update(users).set({ publicCode: await generatePublicCode() }).where(eq(users.id, u.id));
	}
	return missing.length;
}

// ─────────────────────────────────────────────────────────
// 訂單匯入
// ─────────────────────────────────────────────────────────

export interface ImportRow {
	orderRef: string;
	/** 計幣金額 */
	amountTwd: number;
	/** 買家實付總額（賣貨便含運費），給操作員對照用 */
	totalTwd: number;
	rawCode: string;
	/** 從備註裡抓出來、正規化過的代碼 */
	code: string | null;
	userId: string | null;
	displayName: string | null;
	chips: number;
	/** 平台上的訂單狀態原文，例如「付款完成」 */
	statusText: string;
	/**
	 * 這張訂單開過的兌換券。
	 *
	 * 匯出檔永遠只是「平台上的訂單」，不會知道我們私下開過券、
	 * 觀眾兌換了沒。每次重匯都會再看到同一批沒填代碼的訂單，
	 * 操作員光看檔案分不出哪些已經處理過 —— 所以這個狀態由我們自己的
	 * redeem_codes.order_ref 補上。
	 */
	voucher: { code: string; used: boolean; usedAt: string | null } | null;
	status:
		| 'ready'
		| 'no-code'
		| 'unknown-code'
		| 'already-credited'
		| 'bad-amount'
		| 'not-paid'
		| 'cancelled'
		| 'merged'
		| 'voucher-issued'
		| 'voucher-used';
}

/**
 * 試算匯入結果，不寫入任何東西。
 *
 * 後台必須先讓操作員看到「誰會拿到多少、哪幾筆對不到」才動手，
 * 因為發幣之後要收回很麻煩。
 *
 * 查重複與對帳號各只打一次資料庫。原本是每張訂單查兩次，
 * 一份一百多張的匯出檔在正式站就是兩百多次往返，會逼近函式逾時。
 */
export async function previewOrders(
	platform: string,
	orders: ParsedOrder[],
	tx: Executor = db
): Promise<ImportRow[]> {
	const refs = [...new Set(orders.map((o) => o.orderRef))];
	const codes = [...new Set(orders.map((o) => o.code).filter((c): c is string => !!c))];

	const [credited, owners, vouchers] = await Promise.all([
		refs.length
			? tx
					.select({ orderRef: purchaseOrders.orderRef })
					.from(purchaseOrders)
					.where(and(eq(purchaseOrders.platform, platform), inArray(purchaseOrders.orderRef, refs)))
			: Promise.resolve([]),
		codes.length
			? tx
					.select({ id: users.id, displayName: users.displayName, publicCode: users.publicCode })
					.from(users)
					.where(inArray(users.publicCode, codes))
			: Promise.resolve([]),
		refs.length
			? tx
					.select({
						code: redeemCodes.code,
						orderRef: redeemCodes.orderRef,
						usedByUserId: redeemCodes.usedByUserId,
						usedAt: redeemCodes.usedAt
					})
					.from(redeemCodes)
					.where(inArray(redeemCodes.orderRef, refs))
			: Promise.resolve([])
	]);

	const creditedSet = new Set(credited.map((c) => c.orderRef));
	const ownerOf = new Map(owners.map((u) => [u.publicCode, u]));

	// 同一張訂單若開過多張券，以「已被兌換的那張」為準 —— 那代表這筆已經發出去了
	const voucherOf = new Map<string, ImportRow['voucher']>();
	for (const v of vouchers) {
		if (!v.orderRef) continue;
		const used = v.usedByUserId !== null;
		const prev = voucherOf.get(v.orderRef);
		if (!prev || (used && !prev.used)) {
			voucherOf.set(v.orderRef, {
				code: v.code,
				used,
				usedAt: v.usedAt ? v.usedAt.toISOString() : null
			});
		}
	}

	return orders.map((o) => {
		const amountOk = Number.isFinite(o.amountTwd) && o.amountTwd > 0;
		const owner = o.code ? ownerOf.get(o.code) : undefined;

		const voucher = voucherOf.get(o.orderRef) ?? null;

		/**
		 * 順序有意義：已發過的一律先標出來，重匯同一份檔案時操作員才看得懂。
		 *
		 * ⚠️ 兌換券的判斷一定要排在 ready 前面。否則同一張訂單先開了券，
		 * 觀眾後來又把代碼補填進平台的留言欄，這裡就會再自動發一次 —— 變成雙倍。
		 */
		let status: ImportRow['status'];
		if (creditedSet.has(o.orderRef)) status = 'already-credited';
		else if (voucher?.used) status = 'voucher-used';
		else if (voucher) status = 'voucher-issued';
		else if (o.block) status = o.block;
		else if (!amountOk) status = 'bad-amount';
		else if (!o.code) status = 'no-code';
		else if (!owner) status = 'unknown-code';
		else status = 'ready';

		return {
			orderRef: o.orderRef,
			amountTwd: o.amountTwd,
			totalTwd: o.totalTwd,
			rawCode: o.rawCode,
			code: o.code,
			userId: status === 'ready' ? owner!.id : null,
			displayName: owner?.displayName ?? null,
			chips: amountOk ? o.amountTwd * CHIPS_PER_TWD : 0,
			statusText: o.statusText,
			voucher,
			status
		};
	});
}

/** 手動指定欄位的舊入口，自我測試仍在用。 */
export async function previewImport(
	platform: string,
	rows: string[][],
	cols: { orderRef: number; amount: number; note: number },
	hasHeader: boolean
): Promise<ImportRow[]> {
	return previewOrders(platform, parseByColumns(rows, cols, hasHeader));
}

/**
 * 後台匯入的入口：自動辨識格式。
 *
 * 認出是賣貨便時，平台名稱強制寫成「賣貨便」，不理會操作員選的下拉選單。
 * 防重複是看「平台 + 訂單編號」—— 若同一份檔案一次選賣貨便、一次誤選綠界，
 * 兩次會被當成不同訂單而重複發幣。
 */
export async function previewCsv(
	selectedPlatform: string,
	csv: string,
	cols: { orderRef: number; amount: number; note: number },
	hasHeader: boolean
): Promise<{ format: OrderFormat; platform: string; rows: ImportRow[] }> {
	const table = parseCsv(csv);
	const format = detectFormat(table);

	if (format === 'ecpay-donation') {
		throw new PurchaseError(
			'這是綠界「贊助頁」的匯出檔，不是周邊商店的訂單，不能用來發幣。' +
				'請到綠界商店後台匯出「訂單明細」（Excel）再上傳。'
		);
	}

	if (format === 'myship') {
		const platform = '賣貨便';
		return { format, platform, rows: await previewOrders(platform, parseMyship(table)) };
	}
	if (format === 'ecpay') {
		const platform = '綠界';
		return { format, platform, rows: await previewOrders(platform, parseEcpay(table)) };
	}
	return {
		format,
		platform: selectedPlatform,
		rows: await previewOrders(selectedPlatform, parseByColumns(table, cols, hasHeader))
	};
}

/** 把預覽中狀態為 ready 的那些真的發出去。 */
export async function commitImport(platform: string, rows: ImportRow[], adminUserId: string) {
	const ready = rows.filter((r) => r.status === 'ready' && r.userId);
	let credited = 0;
	let skipped = 0;
	let chips = 0;

	for (const r of ready) {
		try {
			await db.transaction(async (tx) => {
				// 唯一索引會擋下重複的訂單編號，整筆交易一起回滾
				const [order] = await tx
					.insert(purchaseOrders)
					.values({
						platform,
						orderRef: r.orderRef,
						amountTwd: r.amountTwd,
						chips: r.chips,
						userId: r.userId!,
						publicCode: r.code,
						adminUserId
					})
					.returning();

				await lockUser(tx, r.userId!);
				await writeLedger(tx, {
					userId: r.userId!,
					type: 'purchase',
					amount: r.chips,
					note: `周邊訂單 ${platform} ${order.orderRef}`
				});
			});
			credited++;
			chips += r.chips;
		} catch {
			// 多半是唯一索引擋下的重複訂單，跳過即可
			skipped++;
		}
	}

	return { credited, skipped, chips };
}

// ─────────────────────────────────────────────────────────
// 兌換券
// ─────────────────────────────────────────────────────────

export async function createRedeemCodes(count: number, amount: number, orderRef?: string) {
	if (!Number.isInteger(count) || count < 1 || count > 200) {
		throw new PurchaseError('一次最多產生 200 組');
	}
	if (!Number.isInteger(amount) || amount <= 0) {
		throw new PurchaseError('面額必須是正整數');
	}

	const created: string[] = [];
	for (let i = 0; i < count; i++) {
		// 兌換券比訂單備註碼長，因為它等同於現金
		const code = `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
		await db.insert(redeemCodes).values({ code, amount, orderRef: orderRef || null });
		created.push(code);
	}
	return created;
}

/**
 * 為某一張訂單開兌換券，給「已付款但沒填代碼」的買家。
 *
 * 同一張訂單刻意不重複開券：
 *   ・已經開過但還沒被兌換 → 直接把原來那張回傳給操作員（多半是券碼弄丟了）
 *   ・已經被兌換 → 拒絕。再開一張就是同一筆訂單發兩次幣
 *
 * orderRef 一定會寫進券裡，下次重匯同一份檔案時，那一列就會顯示「已開兌換券」。
 */
export async function issueVoucherForOrder(orderRef: string, amountTwd: number, tx: Executor = db) {
	const ref = orderRef.trim();
	if (!ref) throw new PurchaseError('缺少訂單編號');
	if (!Number.isInteger(amountTwd) || amountTwd <= 0) {
		throw new PurchaseError('這張訂單的金額無法判斷，請改用下方「產生兌換券」手動開券');
	}

	const existing = await tx.select().from(redeemCodes).where(eq(redeemCodes.orderRef, ref));
	const used = existing.find((c) => c.usedByUserId !== null);
	if (used) {
		throw new PurchaseError(`這張訂單的兌換券已經被兌換過了（${used.code}），不會再開一張`);
	}

	const unused = existing.find((c) => c.usedByUserId === null);
	if (unused) return { code: unused.code, amount: unused.amount, reused: true };

	const amount = amountTwd * CHIPS_PER_TWD;
	const code = `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
	await tx.insert(redeemCodes).values({ code, amount, orderRef: ref });
	return { code, amount, reused: false };
}

/** 兌換。已使用或不存在都回同一種錯誤訊息，避免被拿來猜碼。 */
export async function redeem(userId: string, rawCode: string) {
	const code = rawCode.trim().toUpperCase().replace(/\s/g, '');
	if (!code) throw new PurchaseError('請輸入兌換券碼');

	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(redeemCodes)
			.where(eq(redeemCodes.code, code))
			.for('update')
			.limit(1);

		if (!row || row.usedByUserId) {
			throw new PurchaseError('兌換券碼無效或已被使用');
		}

		await tx
			.update(redeemCodes)
			.set({ usedByUserId: userId, usedAt: new Date() })
			.where(eq(redeemCodes.code, code));

		await lockUser(tx, userId);
		await writeLedger(tx, {
			userId,
			type: 'purchase',
			amount: row.amount,
			note: `兌換券 ${code}`
		});

		return row.amount;
	});
}

// ─────────────────────────────────────────────────────────
// 查詢
// ─────────────────────────────────────────────────────────

export async function recentOrders(limit = 30) {
	return db
		.select({
			id: purchaseOrders.id,
			platform: purchaseOrders.platform,
			orderRef: purchaseOrders.orderRef,
			amountTwd: purchaseOrders.amountTwd,
			chips: purchaseOrders.chips,
			publicCode: purchaseOrders.publicCode,
			createdAt: purchaseOrders.createdAt,
			displayName: users.displayName
		})
		.from(purchaseOrders)
		.innerJoin(users, eq(purchaseOrders.userId, users.id))
		.orderBy(desc(purchaseOrders.id))
		.limit(limit);
}

export async function codeStats() {
	const [row] = await db
		.select({
			total: sql<number>`COUNT(*)::int`,
			used: sql<number>`COUNT(${redeemCodes.usedByUserId})::int`,
			unusedValue: sql<number>`COALESCE(SUM(CASE WHEN ${redeemCodes.usedByUserId} IS NULL THEN ${redeemCodes.amount} ELSE 0 END), 0)::bigint`
		})
		.from(redeemCodes);

	return {
		total: Number(row?.total ?? 0),
		used: Number(row?.used ?? 0),
		unusedValue: Number(row?.unusedValue ?? 0)
	};
}

export async function unusedCodes(limit = 50) {
	return db
		.select()
		.from(redeemCodes)
		.where(isNull(redeemCodes.usedByUserId))
		.orderBy(desc(redeemCodes.createdAt))
		.limit(limit);
}
