/**
 * 狗狗幣帳本 —— 對應規格書 §05、§07
 *
 * 所有幣的增減都必須走這裡。不要在別的地方直接寫 ledger 表，
 * 否則餘額檢查與併發保護就形同虛設。
 */

import { sql, eq, desc } from 'drizzle-orm';
import { db } from './db';
import { ledger, users, type LedgerType } from './db/schema';

/** Drizzle 交易物件，或頂層 db。讓這些函式能被包在更大的交易裡重用。 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 讀取餘額 —— 一律由 ledger 加總得出。
 * users 表沒有餘額欄位，所以不存在「餘額和帳本對不上」這種狀況。
 */
export async function getBalance(userId: string, tx: Executor = db): Promise<number> {
	const [row] = await tx
		.select({ balance: sql<number>`COALESCE(SUM(${ledger.amount}), 0)::bigint` })
		.from(ledger)
		.where(eq(ledger.userId, userId));

	return Number(row?.balance ?? 0);
}

export interface LedgerEntry {
	userId: string;
	type: LedgerType;
	/** 有號數。扣款請傳負數。 */
	amount: number;
	refMarketId?: number;
	refBetId?: number;
	note?: string;
}

/**
 * 寫入一筆帳本紀錄，並回傳寫入後的餘額。
 *
 * 呼叫端必須自己開交易並先鎖定使用者資料列（見 lockUser），
 * 否則兩筆同時進來的扣款可能都通過餘額檢查，造成負餘額。
 */
export async function writeLedger(tx: Executor, entry: LedgerEntry): Promise<number> {
	const current = await getBalance(entry.userId, tx);
	const next = current + entry.amount;

	if (next < 0) {
		throw new InsufficientBalanceError(current, Math.abs(entry.amount));
	}

	await tx.insert(ledger).values({
		userId: entry.userId,
		type: entry.type,
		amount: entry.amount,
		balanceAfter: next,
		refMarketId: entry.refMarketId,
		refBetId: entry.refBetId,
		note: entry.note
	});

	return next;
}

/**
 * 鎖定使用者資料列，直到交易結束。
 *
 * 這是防止併發扣款的關鍵。下注流程必須先呼叫這個，
 * 同一使用者的第二筆請求會排隊等待，讀到的餘額才是正確的。
 */
export async function lockUser(tx: Executor, userId: string): Promise<void> {
	await tx.execute(sql`SELECT id FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`);
}

export class InsufficientBalanceError extends Error {
	constructor(
		public readonly balance: number,
		public readonly required: number
	) {
		super(`餘額不足：目前 ${balance}，需要 ${required}`);
		this.name = 'InsufficientBalanceError';
	}
}

/** 取得使用者的帳本紀錄，新到舊。 */
export async function getHistory(userId: string, limit = 50) {
	return db
		.select()
		.from(ledger)
		.where(eq(ledger.userId, userId))
		.orderBy(desc(ledger.id))
		.limit(limit);
}
