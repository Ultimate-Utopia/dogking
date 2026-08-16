/**
 * 賽程、盤口與彩池結算 —— 對應規格書 §05、§06
 *
 * ─────────────────────────────────────────────────────────
 * 鎖定順序（非常重要，動這個檔案前先讀）
 *
 *   一律先鎖 market，再鎖 user。
 *
 * 下注與結算都會同時碰到「盤口」和「使用者」兩種資料列。
 * 若兩邊的鎖定順序相反，高併發下就會死結。結算時還會依 user_id
 * 排序後再逐筆鎖定，確保多個結算之間也是同一個順序。
 * ─────────────────────────────────────────────────────────
 */

import { eq, and, inArray, asc } from 'drizzle-orm';
import { db } from './db';
import { markets, bets, matches } from './db/schema';
import { lockUser, writeLedger } from './ledger';
import type { Side } from './db/schema';

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MarketNotFoundError extends Error {
	constructor(id: number) {
		super(`找不到盤口 ${id}`);
		this.name = 'MarketNotFoundError';
	}
}

export class MarketStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MarketStateError';
	}
}

// ─────────────────────────────────────────────────────────
// 賠率
// ─────────────────────────────────────────────────────────

/**
 * 彩池分配制賠率：總彩池 ÷ 該方彩池。
 *
 * 某方彩池為 0 時賠率無意義（沒有人押就沒有人能領），回傳 null。
 * 前台顯示時應標示「預估賠率，最終依封盤後彩池計算」。
 */
export function calcOdds(poolBlue: number, poolRed: number) {
	const total = poolBlue + poolRed;
	return {
		blue: poolBlue > 0 ? total / poolBlue : null,
		red: poolRed > 0 ? total / poolRed : null,
		total
	};
}

/** 單筆下注在指定彩池下的派彩金額。無條件捨去，餘數留在系統。 */
export function calcPayout(amount: number, poolWinner: number, poolTotal: number): number {
	if (poolWinner <= 0) return 0;
	return Math.floor((amount * poolTotal) / poolWinner);
}

// ─────────────────────────────────────────────────────────
// 盤口生命週期： pending → open → locked → settled / void
// ─────────────────────────────────────────────────────────

/** 建立盤口（若尚未存在）並開放下注。gameNo 0 = 整場盤，1 以上 = 第 N 小局。 */
export async function openMarket(matchId: number, gameNo = 0) {
	const [existing] = await db
		.select()
		.from(markets)
		.where(and(eq(markets.matchId, matchId), eq(markets.gameNo, gameNo)))
		.limit(1);

	if (existing) {
		if (existing.state === 'settled' || existing.state === 'void') {
			throw new MarketStateError('已結算或已取消的盤口不能重新開盤');
		}
		const [updated] = await db
			.update(markets)
			.set({ state: 'open', openedAt: existing.openedAt ?? new Date(), lockAt: null })
			.where(eq(markets.id, existing.id))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(markets)
		.values({
			matchId,
			type: gameNo === 0 ? 'match' : 'game',
			gameNo,
			state: 'open',
			openedAt: new Date()
		})
		.returning();

	return created;
}

/** 立即封盤。 */
export async function lockMarket(marketId: number) {
	const [updated] = await db
		.update(markets)
		.set({ state: 'locked', lockedAt: new Date() })
		.where(and(eq(markets.id, marketId), eq(markets.state, 'open')))
		.returning();

	if (!updated) throw new MarketStateError('只有開放中的盤口能封盤');
	return updated;
}

/**
 * 設定 N 秒後封盤，前台據此顯示倒數。
 *
 * 注意：這只是「預定時間」。實際擋下注的是 placeBet 裡的伺服器時間檢查，
 * 所以就算沒有排程器把 state 改成 locked，時間一到也下不了注。
 */
export async function scheduleLock(marketId: number, seconds: number) {
	const lockAt = new Date(Date.now() + seconds * 1000);
	const [updated] = await db
		.update(markets)
		.set({ lockAt })
		.where(and(eq(markets.id, marketId), eq(markets.state, 'open')))
		.returning();

	if (!updated) throw new MarketStateError('只有開放中的盤口能設定倒數');
	return updated;
}

// ─────────────────────────────────────────────────────────
// 下注
// ─────────────────────────────────────────────────────────

export interface PlaceBetInput {
	userId: string;
	marketId: number;
	side: Side;
	amount: number;
	/** 冪等鍵。同一把重複送出只會成立一筆。 */
	idempotencyKey: string;
}

export async function placeBet(input: PlaceBetInput) {
	const { userId, marketId, side, amount, idempotencyKey } = input;

	if (!Number.isInteger(amount) || amount <= 0) {
		throw new MarketStateError('下注金額必須是正整數');
	}

	// 冪等：同一個鍵已經成立過就直接回傳，不重複扣款
	const [dup] = await db
		.select()
		.from(bets)
		.where(eq(bets.idempotencyKey, idempotencyKey))
		.limit(1);
	if (dup) return dup;

	return db.transaction(async (tx) => {
		// 鎖定順序：market → user
		const [market] = await tx
			.select()
			.from(markets)
			.where(eq(markets.id, marketId))
			.for('update')
			.limit(1);

		if (!market) throw new MarketNotFoundError(marketId);
		if (market.state !== 'open') throw new MarketStateError('此盤口已封盤或尚未開放');

		// 封盤判定以伺服器時間為準，前台倒數僅供參考（規格書 §05）
		if (market.lockAt && market.lockAt.getTime() <= Date.now()) {
			throw new MarketStateError('此盤口已封盤');
		}

		await lockUser(tx, userId);

		const [bet] = await tx
			.insert(bets)
			.values({ userId, marketId, side, amount, idempotencyKey })
			.returning();

		// 餘額不足時 writeLedger 會丟 InsufficientBalanceError，整筆交易回滾
		await writeLedger(tx, {
			userId,
			type: 'bet',
			amount: -amount,
			refMarketId: marketId,
			refBetId: bet.id,
			note: `下注 ${side === 'blue' ? '藍方' : '紅方'}`
		});

		await tx
			.update(markets)
			.set(
				side === 'blue'
					? { poolBlue: market.poolBlue + amount }
					: { poolRed: market.poolRed + amount }
			)
			.where(eq(markets.id, marketId));

		return bet;
	});
}

// ─────────────────────────────────────────────────────────
// 結算與退款
// ─────────────────────────────────────────────────────────

export interface SettleResult {
	marketId: number;
	outcome: 'settled' | 'refunded';
	winnerSide: Side | null;
	totalPool: number;
	winnerPool: number;
	paidOut: number;
	/** 除不盡而留在系統的餘數 */
	remainder: number;
	betsWon: number;
	betsLost: number;
	betsRefunded: number;
	note?: string;
}

/**
 * 結算盤口。
 *
 * 邊界情況（規格書 §05）：贏方無人下注時全額退款，
 * 否則輸方的錢會沒有人可以分。
 */
export async function settleMarket(marketId: number, winnerSide: Side): Promise<SettleResult> {
	return db.transaction(async (tx) => {
		const [market] = await tx
			.select()
			.from(markets)
			.where(eq(markets.id, marketId))
			.for('update')
			.limit(1);

		if (!market) throw new MarketNotFoundError(marketId);
		if (market.state !== 'locked') {
			throw new MarketStateError(`只有已封盤的盤口能結算（目前狀態：${market.state}）`);
		}

		const totalPool = market.poolBlue + market.poolRed;
		const winnerPool = winnerSide === 'blue' ? market.poolBlue : market.poolRed;

		if (winnerPool === 0) {
			const refund = await refundAll(tx, marketId, '贏方無人下注，全額退款');
			await tx
				.update(markets)
				.set({ state: 'void', winnerSide, settledAt: new Date() })
				.where(eq(markets.id, marketId));

			return {
				marketId,
				outcome: 'refunded',
				winnerSide,
				totalPool,
				winnerPool,
				paidOut: refund.total,
				remainder: 0,
				betsWon: 0,
				betsLost: 0,
				betsRefunded: refund.count,
				note: '贏方無人下注，全額退款'
			};
		}

		// 依 user_id 排序後逐筆處理，讓多個結算之間的鎖定順序一致
		const pending = await tx
			.select()
			.from(bets)
			.where(and(eq(bets.marketId, marketId), eq(bets.state, 'pending')))
			.orderBy(asc(bets.userId), asc(bets.id));

		let paidOut = 0;
		let betsWon = 0;
		let betsLost = 0;

		for (const bet of pending) {
			if (bet.side === winnerSide) {
				const payout = calcPayout(bet.amount, winnerPool, totalPool);
				await lockUser(tx, bet.userId);
				await writeLedger(tx, {
					userId: bet.userId,
					type: 'payout',
					amount: payout,
					refMarketId: marketId,
					refBetId: bet.id,
					note: '派彩'
				});
				await tx.update(bets).set({ state: 'won', payout }).where(eq(bets.id, bet.id));
				paidOut += payout;
				betsWon++;
			} else {
				await tx.update(bets).set({ state: 'lost', payout: 0 }).where(eq(bets.id, bet.id));
				betsLost++;
			}
		}

		await tx
			.update(markets)
			.set({ state: 'settled', winnerSide, settledAt: new Date() })
			.where(eq(markets.id, marketId));

		return {
			marketId,
			outcome: 'settled',
			winnerSide,
			totalPool,
			winnerPool,
			paidOut,
			remainder: totalPool - paidOut,
			betsWon,
			betsLost,
			betsRefunded: 0
		};
	});
}

/**
 * 取消盤口並全額退款。
 * 用於平局、選手退賽、判定爭議、比賽取消（規格書 §05）。
 */
export async function voidMarket(marketId: number, reason: string): Promise<SettleResult> {
	return db.transaction(async (tx) => {
		const [market] = await tx
			.select()
			.from(markets)
			.where(eq(markets.id, marketId))
			.for('update')
			.limit(1);

		if (!market) throw new MarketNotFoundError(marketId);
		if (market.state === 'settled' || market.state === 'void') {
			throw new MarketStateError('此盤口已經結算或取消過了');
		}

		const refund = await refundAll(tx, marketId, reason);

		await tx
			.update(markets)
			.set({ state: 'void', settledAt: new Date() })
			.where(eq(markets.id, marketId));

		return {
			marketId,
			outcome: 'refunded',
			winnerSide: null,
			totalPool: market.poolBlue + market.poolRed,
			winnerPool: 0,
			paidOut: refund.total,
			remainder: 0,
			betsWon: 0,
			betsLost: 0,
			betsRefunded: refund.count,
			note: reason
		};
	});
}

/** 把某盤口所有未結算的注全額退回。 */
async function refundAll(tx: Executor, marketId: number, reason: string) {
	const pending = await tx
		.select()
		.from(bets)
		.where(and(eq(bets.marketId, marketId), eq(bets.state, 'pending')))
		.orderBy(asc(bets.userId), asc(bets.id));

	let total = 0;
	for (const bet of pending) {
		await lockUser(tx, bet.userId);
		await writeLedger(tx, {
			userId: bet.userId,
			type: 'refund',
			amount: bet.amount,
			refMarketId: marketId,
			refBetId: bet.id,
			note: reason
		});
		await tx.update(bets).set({ state: 'refunded', payout: bet.amount }).where(eq(bets.id, bet.id));
		total += bet.amount;
	}

	return { count: pending.length, total };
}

// ─────────────────────────────────────────────────────────
// 查詢
// ─────────────────────────────────────────────────────────

/** 取得場次與其所有盤口，供看板與後台使用。 */
export async function getMatchWithMarkets(matchId: number) {
	const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
	if (!match) return null;

	const marketRows = await db
		.select()
		.from(markets)
		.where(eq(markets.matchId, matchId))
		.orderBy(asc(markets.gameNo));

	return {
		match,
		markets: marketRows.map((m) => ({ ...m, odds: calcOdds(m.poolBlue, m.poolRed) }))
	};
}

/** 刪除多個場次的所有盤口與下注（僅供測試清理使用）。 */
export async function deleteMarketsForMatches(matchIds: number[]) {
	if (!matchIds.length) return;
	const rows = await db
		.select({ id: markets.id })
		.from(markets)
		.where(inArray(markets.matchId, matchIds));
	const ids = rows.map((r) => r.id);
	if (ids.length) await db.delete(bets).where(inArray(bets.marketId, ids));
	await db.delete(markets).where(inArray(markets.matchId, matchIds));
}
