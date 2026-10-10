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
import { getBalance, lockUser, writeLedger } from './ledger';
import {
	CODE_ALPHABET,
	parseCsv,
	extractCode,
	detectFormat,
	parseMyship,
	parseEcpay,
	ecpayShops,
	ECPAY_DEFAULT_SHOP,
	parseByColumns,
	decideImportStatus,
	type ImportStatus,
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
	/** 判定在 decideImportStatus（純函式，有測試守著） */
	status: ImportStatus;
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
					// 連「當初發了多少、發給誰」一起撈出來，訂單被取消時要照原本的數字收回。
					// 不能用這次匯入算出來的金額 —— 取消後平台上的金額可能已經變了。
					.select({
						orderRef: purchaseOrders.orderRef,
						chips: purchaseOrders.chips,
						userId: purchaseOrders.userId,
						displayName: users.displayName
					})
					.from(purchaseOrders)
					.innerJoin(users, eq(purchaseOrders.userId, users.id))
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

	const creditedOf = new Map(credited.map((c) => [c.orderRef, c]));
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

		const already = creditedOf.get(o.orderRef);
		const status = decideImportStatus({
			alreadyCredited: !!already,
			block: o.block,
			voucher,
			amountOk,
			code: o.code,
			rawCode: o.rawCode,
			hasOwner: !!owner
		});

		return {
			orderRef: o.orderRef,
			amountTwd: o.amountTwd,
			totalTwd: o.totalTwd,
			rawCode: o.rawCode,
			code: o.code,
			userId: status === 'ready' ? owner!.id : status === 'revoke' ? already!.userId : null,
			displayName: status === 'revoke' ? already!.displayName : (owner?.displayName ?? null),
			// 要收回的是「當初發出去的數字」，不是這次重算的
			chips: status === 'revoke' ? already!.chips : amountOk ? o.amountTwd * CHIPS_PER_TWD : 0,
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
	hasHeader: boolean,
	shop: string = ECPAY_DEFAULT_SHOP
): Promise<{
	format: OrderFormat;
	platform: string;
	rows: ImportRow[];
	/** 綠界才有：這份檔案裡各賣場的訂單數，以及實際採用的賣場 */
	shops?: { name: string; count: number }[];
	shop?: string;
}> {
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
		return {
			format,
			platform,
			rows: await previewOrders(platform, parseEcpay(table, shop)),
			shops: ecpayShops(table),
			shop
		};
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
					note: `商品消費 ${platform} ${order.orderRef}`
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

// ─────────────────────────────────────────────────────────
// 收回誤發 / 人工扣除
// ─────────────────────────────────────────────────────────

export interface RevokeResult {
	revoked: number;
	chips: number;
	/** 收完之後餘額變成負的那些人 —— 幣已經應援出去了，要補新訂單才能再應援 */
	negative: Array<{ displayName: string; orderRef: string; chips: number; after: number }>;
	failed: number;
}

/**
 * 把預覽中狀態為 revoke 的訂單收回來。
 *
 * 會發生在：第一次匯入時訂單是「待出貨」，發了幣；
 * 後來買家取消或退款，下一次匯入就會看到同一張訂單變成「已取消」。
 *
 * ── 做法 ──────────────────────────────────────────
 *   ・寫一筆相反金額的 adjust 把幣收回（<u>不刪原本的帳目</u>）
 *   ・刪掉 purchase_orders 那一列，訂單回到「沒發過」的狀態
 *
 * 帳本是餘額的唯一來源，刪掉歷史就再也查不出「這個人為什麼少了兩萬」。
 * 收回後紀錄上看得到 +20,000 與 −20,000 兩筆，說得清楚。
 *
 * ⚠️ <strong>餘額不夠時會扣成負數</strong>（主辦方 10-10 定案）。
 * 幣可能已經應援出去了，手上剩 0；若因此不扣，等於讓人靠一張取消的訂單白賺一筆。
 * 照實扣成負的，欠多少是多少，要再應援得先補一張新訂單。
 * 餘額變負的人會列在 negative 裡，操作員看得到。
 *
 * 負餘額不會讓系統出問題：前台的金額輸入上限是 max(0, 餘額)、
 * 應援按鈕要 0 < 金額 ≤ 餘額，所以負餘額就是完全不能應援 —— 這正是我們要的。
 *
 * ⚠️ 一律以資料庫當下的數字為準重新撈一次，不信任前端送回來的預覽。
 */
export async function revokeOrders(
	platform: string,
	rows: ImportRow[],
	adminUserId: string
): Promise<RevokeResult> {
	const refs = rows.filter((r) => r.status === 'revoke').map((r) => r.orderRef);
	const out: RevokeResult = { revoked: 0, chips: 0, negative: [], failed: 0 };

	for (const ref of refs) {
		try {
			await db.transaction(async (tx) => {
				const [order] = await tx
					.select()
					.from(purchaseOrders)
					.where(and(eq(purchaseOrders.platform, platform), eq(purchaseOrders.orderRef, ref)))
					.limit(1);
				if (!order) return; // 別人剛剛收回過了

				await lockUser(tx, order.userId);
				const after = await writeLedger(tx, {
					userId: order.userId,
					type: 'adjust',
					amount: -order.chips,
					note: `訂單 ${ref} 已取消，收回商品消費贈送的狗狗幣`,
					allowNegative: true
				});

				await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, order.id));

				out.revoked++;
				out.chips += order.chips;

				if (after < 0) {
					const [u] = await tx
						.select({ displayName: users.displayName })
						.from(users)
						.where(eq(users.id, order.userId))
						.limit(1);
					out.negative.push({
						displayName: u?.displayName ?? order.userId,
						orderRef: ref,
						chips: order.chips,
						after
					});
				}
			});
		} catch {
			out.failed++;
		}
	}

	void adminUserId; // 操作紀錄由呼叫端寫，這裡只負責帳
	return out;
}

/**
 * 指定訂單備註碼，人工扣除狗狗幣。
 *
 * 給系統自動判斷不到的狀況用：訂單在平台上沒有變成「已取消」但實際退款了、
 * 重複下單、誤發、違規等等。理由是必填的 —— 事後有爭議時，
 * 帳本上那一行就是唯一的依據。
 *
 * ⚠️ 餘額不足時<strong>會扣成負數</strong>（主辦方 10-10 定案）。
 * 幣可能已經應援出去了，手上剩 0；若因此不扣，等於讓人白賺一筆。
 * 負餘額的人完全不能再應援，要補一張新訂單把餘額拉回正的才行。
 */
export async function deductByPublicCode(
	rawCode: string,
	amount: number,
	reason: string,
	adminUserId: string
): Promise<{ displayName: string; publicCode: string; before: number; after: number }> {
	const code = extractCode(rawCode) ?? rawCode.trim().toUpperCase();
	if (!code) throw new PurchaseError('請填訂單備註碼');
	if (!Number.isInteger(amount) || amount <= 0) throw new PurchaseError('扣除數量必須是正整數');
	if (!reason.trim()) throw new PurchaseError('請填扣除理由 —— 事後有爭議時這是唯一依據');

	return db.transaction(async (tx) => {
		const [user] = await tx
			.select({ id: users.id, displayName: users.displayName, publicCode: users.publicCode })
			.from(users)
			.where(eq(users.publicCode, code))
			.limit(1);
		if (!user) throw new PurchaseError(`查無備註碼「${code}」的帳號`);

		await lockUser(tx, user.id);
		const before = await getBalance(user.id, tx);
		const after = await writeLedger(tx, {
			userId: user.id,
			type: 'adjust',
			amount: -amount,
			note: `管理員扣除：${reason.trim()}`,
			allowNegative: true
		});

		void adminUserId;
		return { displayName: user.displayName, publicCode: user.publicCode ?? code, before, after };
	});
}
