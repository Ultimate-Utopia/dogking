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
	parseByColumns,
	type ParsedOrder,
	type OrderFormat
} from './order-formats';

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
	status:
		| 'ready'
		| 'no-code'
		| 'unknown-code'
		| 'already-credited'
		| 'bad-amount'
		| 'not-paid'
		| 'cancelled'
		| 'merged';
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
export async function previewOrders(platform: string, orders: ParsedOrder[]): Promise<ImportRow[]> {
	const refs = [...new Set(orders.map((o) => o.orderRef))];
	const codes = [...new Set(orders.map((o) => o.code).filter((c): c is string => !!c))];

	const [credited, owners] = await Promise.all([
		refs.length
			? db
					.select({ orderRef: purchaseOrders.orderRef })
					.from(purchaseOrders)
					.where(and(eq(purchaseOrders.platform, platform), inArray(purchaseOrders.orderRef, refs)))
			: Promise.resolve([]),
		codes.length
			? db
					.select({ id: users.id, displayName: users.displayName, publicCode: users.publicCode })
					.from(users)
					.where(inArray(users.publicCode, codes))
			: Promise.resolve([])
	]);

	const creditedSet = new Set(credited.map((c) => c.orderRef));
	const ownerOf = new Map(owners.map((u) => [u.publicCode, u]));

	return orders.map((o) => {
		const amountOk = Number.isFinite(o.amountTwd) && o.amountTwd > 0;
		const owner = o.code ? ownerOf.get(o.code) : undefined;

		// 順序有意義：已發過的一律先標出來，重匯同一份檔案時操作員才看得懂
		let status: ImportRow['status'];
		if (creditedSet.has(o.orderRef)) status = 'already-credited';
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

	if (format === 'myship') {
		const platform = '賣貨便';
		return { format, platform, rows: await previewOrders(platform, parseMyship(table)) };
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
