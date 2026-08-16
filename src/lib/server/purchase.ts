/**
 * 周邊訂單發幣與兌換碼 —— 對應規格書 §08
 *
 * 兩條路徑：
 *   主線  買家在訂單備註填自己的公開代碼 → 後台匯入 CSV → 比對 → 一鍵發幣
 *   補救  買家忘了填 → 後台產生兌換碼 → 客服用訂單留言發給他 → 自行輸入
 *
 * 補救路徑刻意不需要知道買家是誰，所以連個資都不用碰。
 */

import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import { db } from './db';
import { users, ledger, purchaseOrders, redeemCodes } from './db/schema';
import { lockUser, writeLedger } from './ledger';

/** 換算比例：NT$1 = 100 狗狗幣（企劃書明訂） */
export const CHIPS_PER_TWD = 100;

/** 排除 0/O/1/I/L —— 手寫或口述時最容易看錯的幾個。 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

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
// 公開代碼
// ─────────────────────────────────────────────────────────

/** 產生一組沒被用過的公開代碼。碰撞就重試。 */
export async function generatePublicCode(): Promise<string> {
	for (let i = 0; i < 20; i++) {
		const code = randomCode(6);
		const [taken] = await db.select().from(users).where(eq(users.publicCode, code)).limit(1);
		if (!taken) return code;
	}
	throw new PurchaseError('無法產生公開代碼，請再試一次');
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
// CSV
// ─────────────────────────────────────────────────────────

/**
 * 極簡 CSV 解析：支援雙引號包住的欄位、欄位內的逗號與換行、跳脫的雙引號。
 *
 * 刻意自己寫而不裝套件 —— 只有後台一個地方用得到，
 * 而且賣貨便與綠界匯出的格式都很單純。
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	// 去掉 Excel 匯出常見的 BOM
	const src = text.replace(/^﻿/, '');

	for (let i = 0; i < src.length; i++) {
		const ch = src[i];

		if (inQuotes) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
			continue;
		}

		if (ch === '"') inQuotes = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (ch !== '\r') {
			field += ch;
		}
	}

	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}

	return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ImportRow {
	orderRef: string;
	amountTwd: number;
	rawCode: string;
	/** 從備註裡抓出來、正規化過的代碼 */
	code: string | null;
	userId: string | null;
	displayName: string | null;
	chips: number;
	status: 'ready' | 'no-code' | 'unknown-code' | 'already-credited' | 'bad-amount';
}

/**
 * 從備註欄抓出公開代碼。
 *
 * 買家不會乖乖只填代碼，實際會出現「代碼:K7M2QX」「我的ID K7M2QX 謝謝」
 * 這類寫法，所以抓連續 6 個合法字元就好。
 */
export function extractCode(note: string): string | null {
	const cleaned = note.toUpperCase().replace(/[^0-9A-Z]/g, ' ');
	const m = cleaned.match(new RegExp(`\\b[${ALPHABET}]{6}\\b`));
	return m ? m[0] : null;
}

/**
 * 試算匯入結果，不寫入任何東西。
 *
 * 後台必須先讓操作員看到「誰會拿到多少、哪幾筆對不到」才動手，
 * 因為發幣之後要收回很麻煩。
 */
export async function previewImport(
	platform: string,
	rows: string[][],
	cols: { orderRef: number; amount: number; note: number },
	hasHeader: boolean
): Promise<ImportRow[]> {
	const body = hasHeader ? rows.slice(1) : rows;
	const out: ImportRow[] = [];

	for (const r of body) {
		const orderRef = (r[cols.orderRef] ?? '').trim();
		const amountRaw = (r[cols.amount] ?? '').replace(/[^0-9.-]/g, '');
		const amountTwd = Math.floor(Number(amountRaw));
		const rawCode = (r[cols.note] ?? '').trim();

		if (!orderRef) continue;

		const code = extractCode(rawCode);
		const chips = Number.isFinite(amountTwd) && amountTwd > 0 ? amountTwd * CHIPS_PER_TWD : 0;

		let userId: string | null = null;
		let displayName: string | null = null;
		let status: ImportRow['status'];

		const [dup] = await db
			.select()
			.from(purchaseOrders)
			.where(and(eq(purchaseOrders.platform, platform), eq(purchaseOrders.orderRef, orderRef)))
			.limit(1);

		if (dup) {
			status = 'already-credited';
		} else if (!Number.isFinite(amountTwd) || amountTwd <= 0) {
			status = 'bad-amount';
		} else if (!code) {
			status = 'no-code';
		} else {
			const [u] = await db.select().from(users).where(eq(users.publicCode, code)).limit(1);
			if (u) {
				userId = u.id;
				displayName = u.displayName;
				status = 'ready';
			} else {
				status = 'unknown-code';
			}
		}

		out.push({ orderRef, amountTwd, rawCode, code, userId, displayName, chips, status });
	}

	return out;
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
// 兌換碼
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
		// 兌換碼比公開代碼長，因為它等同於現金
		const code = `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
		await db.insert(redeemCodes).values({ code, amount, orderRef: orderRef || null });
		created.push(code);
	}
	return created;
}

/** 兌換。已使用或不存在都回同一種錯誤訊息，避免被拿來猜碼。 */
export async function redeem(userId: string, rawCode: string) {
	const code = rawCode.trim().toUpperCase().replace(/\s/g, '');
	if (!code) throw new PurchaseError('請輸入兌換碼');

	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(redeemCodes)
			.where(eq(redeemCodes.code, code))
			.for('update')
			.limit(1);

		if (!row || row.usedByUserId) {
			throw new PurchaseError('兌換碼無效或已被使用');
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
			note: `兌換碼 ${code}`
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
