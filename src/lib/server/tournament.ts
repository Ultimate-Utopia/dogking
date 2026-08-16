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

import { eq, and, inArray, asc, lte } from 'drizzle-orm';
import { db } from './db';
import { markets, bets, matches, users, participants } from './db/schema';
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
 * 把倒數已經到期的盤口真正改成 locked。
 *
 * scheduleLock 只寫入時間戳，沒有排程器會在時間到時改狀態
 * （serverless 環境也不該假設有背景工作）。若不補這一步：
 *   - 前台的 state 還是 open，會繼續顯示下注介面
 *   - settleMarket 要求 state 必須是 locked，後台反而結算不了
 *
 * 因此在每個讀取路徑的開頭呼叫一次，讓狀態自我修正。
 * 這是一句有索引的 UPDATE，而且看板端點有 3 秒快取，成本可忽略。
 */
export async function expireLocks(): Promise<number> {
	const updated = await db
		.update(markets)
		.set({ state: 'locked', lockedAt: new Date() })
		.where(and(eq(markets.state, 'open'), lte(markets.lockAt, new Date())))
		.returning({ id: markets.id });

	return updated.length;
}

/**
 * 設定 N 秒後封盤，前台據此顯示倒數。
 *
 * 時間一到會由 expireLocks() 把狀態改成 locked。
 * 即使那之前有人搶送下注，placeBet 也會以伺服器時間擋下。
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
// 結算預覽
// ─────────────────────────────────────────────────────────

export interface SettlePreview {
	totalPool: number;
	winnerPool: number;
	/** 贏方無人下注時會轉為全額退款，而非派彩 */
	willRefund: boolean;
	reason?: string;
	totalPayout: number;
	remainder: number;
	rows: Array<{
		displayName: string;
		side: Side;
		amount: number;
		payout: number;
		result: '獲勝' | '失敗' | '退款';
	}>;
}

/**
 * 試算結算結果，不寫入任何東西。
 *
 * 派彩會直接寫進帳本且無法復原，所以後台在按下確認前
 * 必須先讓操作員看到「誰會拿到多少」。
 */
export async function previewSettle(marketId: number, winnerSide: Side): Promise<SettlePreview> {
	const [market] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
	if (!market) throw new MarketNotFoundError(marketId);

	const totalPool = market.poolBlue + market.poolRed;
	const winnerPool = winnerSide === 'blue' ? market.poolBlue : market.poolRed;

	const rows = await db
		.select({
			displayName: users.displayName,
			side: bets.side,
			amount: bets.amount
		})
		.from(bets)
		.innerJoin(users, eq(bets.userId, users.id))
		.where(and(eq(bets.marketId, marketId), eq(bets.state, 'pending')))
		.orderBy(asc(bets.id));

	const willRefund = winnerPool === 0 && rows.length > 0;

	let totalPayout = 0;
	const detailed = rows.map((r) => {
		const side = r.side as Side;
		let payout = 0;
		let result: '獲勝' | '失敗' | '退款';

		if (willRefund) {
			payout = r.amount;
			result = '退款';
		} else if (side === winnerSide) {
			payout = calcPayout(r.amount, winnerPool, totalPool);
			result = '獲勝';
		} else {
			result = '失敗';
		}

		totalPayout += payout;
		return { displayName: r.displayName, side, amount: r.amount, payout, result };
	});

	return {
		totalPool,
		winnerPool,
		willRefund,
		reason: willRefund ? '贏方無人下注，將全額退款' : undefined,
		totalPayout,
		remainder: willRefund ? 0 : totalPool - totalPayout,
		rows: detailed
	};
}

// ─────────────────────────────────────────────────────────
// 場次維護
// ─────────────────────────────────────────────────────────

/** 設定對戰組合。雙敗淘汰下，賽程推進後才由後台填入。 */
export async function setMatchParticipants(
	matchId: number,
	blueParticipantId: number | null,
	redParticipantId: number | null
) {
	if (
		blueParticipantId !== null &&
		redParticipantId !== null &&
		blueParticipantId === redParticipantId
	) {
		throw new MarketStateError('對戰雙方不能是同一位參賽者');
	}

	const [updated] = await db
		.update(matches)
		.set({ blueParticipantId, redParticipantId })
		.where(eq(matches.id, matchId))
		.returning();

	return updated;
}

/**
 * 更新場次的賽制資訊（輪次名稱、賽制、是否輸者淘汰）。
 *
 * 企劃書的賽程表有無法自洽的地方（見規格書 §06），
 * 所以這些欄位必須讓後台隨時能改，不能寫死在 seed 裡。
 */
export async function updateMatchMeta(
	matchId: number,
	roundLabel: string,
	format: string,
	isElimination: boolean
) {
	if (!roundLabel.trim()) throw new MarketStateError('輪次名稱不能空白');
	if (!['BO1', 'BO3', 'BO5'].includes(format)) throw new MarketStateError('賽制必須是 BO1／BO3／BO5');

	const [updated] = await db
		.update(matches)
		.set({ roundLabel: roundLabel.trim(), format, isElimination })
		.where(eq(matches.id, matchId))
		.returning();

	return updated;
}

/** 新增場次。用於賽程比預期長（例如需要補勝部決賽）的情況。 */
export async function createMatch(orderNo: number, roundLabel: string, format: string) {
	if (!roundLabel.trim()) throw new MarketStateError('輪次名稱不能空白');
	if (!['BO1', 'BO3', 'BO5'].includes(format)) throw new MarketStateError('賽制必須是 BO1／BO3／BO5');

	const [created] = await db
		.insert(matches)
		.values({ orderNo, roundLabel: roundLabel.trim(), format })
		.returning();

	return created;
}

/**
 * 刪除場次。
 *
 * 只要盤口已經有人下注就拒絕 —— 那代表有真實的錢在裡面，
 * 應該用「取消並退款」而不是直接刪掉。
 */
export async function deleteMatch(matchId: number) {
	const own = await db.select().from(markets).where(eq(markets.matchId, matchId));

	if (own.length) {
		const ids = own.map((m) => m.id);
		const [placed] = await db
			.select({ id: bets.id })
			.from(bets)
			.where(inArray(bets.marketId, ids))
			.limit(1);

		if (placed) {
			throw new MarketStateError('這個場次已經有人下注，不能刪除。請改用「取消並退款」。');
		}

		await db.delete(markets).where(eq(markets.matchId, matchId));
	}

	await db.delete(matches).where(eq(matches.id, matchId));
}

/** 更新比分與賽事狀態。 */
export async function updateMatchScore(
	matchId: number,
	scoreBlue: number,
	scoreRed: number,
	state: string,
	winnerSide: Side | null
) {
	const [updated] = await db
		.update(matches)
		.set({ scoreBlue, scoreRed, state, winnerSide })
		.where(eq(matches.id, matchId))
		.returning();

	return updated;
}

// ─────────────────────────────────────────────────────────
// 查詢
// ─────────────────────────────────────────────────────────

/** 場次總覽，供後台列表使用。 */
export async function listMatches() {
	const rows = await db.select().from(matches).orderBy(asc(matches.orderNo));
	const allParticipants = await db.select().from(participants);
	const allMarkets = await db.select().from(markets);

	const nameOf = (id: number | null) =>
		id === null ? null : (allParticipants.find((p) => p.id === id)?.name ?? null);

	return rows.map((m) => {
		const own = allMarkets.filter((mk) => mk.matchId === m.id);
		return {
			...m,
			blueName: nameOf(m.blueParticipantId),
			redName: nameOf(m.redParticipantId),
			marketCount: own.length,
			openCount: own.filter((mk) => mk.state === 'open').length,
			lockedCount: own.filter((mk) => mk.state === 'locked').length,
			pooled: own.reduce((sum, mk) => sum + mk.poolBlue + mk.poolRed, 0)
		};
	});
}

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
