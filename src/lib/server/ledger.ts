/**
 * 狗狗幣帳本 —— 對應規格書 §05、§07
 *
 * 所有幣的增減都必須走這裡。不要在別的地方直接寫 ledger 表，
 * 否則餘額檢查與併發保護就形同虛設。
 */

import { sql, eq, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from './db';
import { ledger, users, markets, matches, bets, participants, type LedgerType } from './db/schema';

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
 * 這是防止併發扣款的關鍵。應援流程必須先呼叫這個，
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

/** 帳本類型對觀眾的說法。資料庫存英文，畫面不該露出來。 */
const TYPE_LABEL: Record<string, string> = {
	signup: '註冊贈幣',
	// 用詞依主辦方要求：面對觀眾一律講「應援」「贈幣」，不用「發幣」「下注」等字眼
	purchase: '商品消費贈幣',
	bet: '應援',
	payout: '應援獲勝發放',
	refund: '退還',
	adjust: '人工調整'
};

export interface CoinHistoryRow {
	id: number;
	type: string;
	/** 中文類型名稱 */
	label: string;
	/** 有號數。應援扣款為負，發放為正。 */
	amount: number;
	balanceAfter: number;
	note: string | null;
	createdAt: string;
	/** 應援與發放才有。用來讓觀眾知道是哪一場。 */
	matchOrderNo: number | null;
	roundLabel: string | null;
	gameNo: number | null;
	/** 這一筆應援押的是哪一邊。blue | red | null（非應援類的帳目沒有） */
	side: string | null;
	/** 該側的選手名字。對手未定時為 null，畫面只寫「藍方」。 */
	sideName: string | null;
}

/**
 * 「狗狗幣從哪來、到哪去」—— 企劃書 §一要求要能給觀眾看。
 *
 * 應援與發放帶上場次、應援場、陣營與選手名字，否則列表上會是一連串
 * 分不出來的「應援 −500」，觀眾根本對不上賬。主辦方 10-10 的回饋是
 * 「會有失憶觀眾」—— 隔了幾小時回來看，要能看出自己押的是哪一邊。
 *
 * 帳本只存 ref_market_id 與 ref_bet_id，所以陣營要從 bets 取，
 * 選手名字要照陣營從 matches 的藍／紅方各自 join 回 participants。
 * 發放只會發給押中的人，因此發放那一筆的 side 就是獲勝方。
 */
export async function getCoinHistory(userId: string, limit = 60): Promise<CoinHistoryRow[]> {
	const blueP = alias(participants, 'blue_p');
	const redP = alias(participants, 'red_p');

	const rows = await db
		.select({
			id: ledger.id,
			type: ledger.type,
			amount: ledger.amount,
			balanceAfter: ledger.balanceAfter,
			note: ledger.note,
			createdAt: ledger.createdAt,
			gameNo: markets.gameNo,
			matchOrderNo: matches.orderNo,
			roundLabel: matches.roundLabel,
			side: bets.side,
			blueName: blueP.name,
			redName: redP.name
		})
		.from(ledger)
		.leftJoin(markets, eq(ledger.refMarketId, markets.id))
		.leftJoin(matches, eq(markets.matchId, matches.id))
		.leftJoin(bets, eq(ledger.refBetId, bets.id))
		.leftJoin(blueP, eq(matches.blueParticipantId, blueP.id))
		.leftJoin(redP, eq(matches.redParticipantId, redP.id))
		.where(eq(ledger.userId, userId))
		.orderBy(desc(ledger.id))
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		type: r.type,
		label: TYPE_LABEL[r.type] ?? r.type,
		amount: r.amount,
		balanceAfter: r.balanceAfter,
		note: r.note,
		createdAt: r.createdAt.toISOString(),
		matchOrderNo: r.matchOrderNo ?? null,
		roundLabel: r.roundLabel ?? null,
		gameNo: r.gameNo ?? null,
		side: r.side ?? null,
		sideName: (r.side === 'blue' ? r.blueName : r.side === 'red' ? r.redName : null) ?? null
	}));
}
