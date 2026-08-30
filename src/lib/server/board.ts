/**
 * 前台看板資料 —— 對應規格書 §04、§09
 *
 * ─────────────────────────────────────────────────────────
 * 這裡的資料「對所有人都一樣」，因此可以被 CDN 快取。
 *
 * ⚠️ 絕對不要把使用者餘額、個人下注紀錄放進來。
 * 這份回應會被 CDN 快取後送給所有人，混進個人資料
 * 就等於把甲的餘額送給乙。個人資料一律走 /api/me（不快取）。
 * ─────────────────────────────────────────────────────────
 */

import { eq, desc, asc, sql } from 'drizzle-orm';
import { db } from './db';
import { matches, markets, participants, bets, users, ledger } from './db/schema';
import { calcOdds, expireLocks } from './tournament';

export interface BoardMarket {
	id: number;
	gameNo: number;
	label: string;
	state: string;
	poolBlue: number;
	poolRed: number;
	total: number;
	oddsBlue: number | null;
	oddsRed: number | null;
	/** ISO 字串。有值時前台顯示倒數。 */
	lockAt: string | null;
	winnerSide: string | null;
}

export interface BoardMatch {
	id: number;
	orderNo: number;
	roundLabel: string;
	format: string;
	isElimination: boolean;
	blueName: string | null;
	redName: string | null;
	/** DORO 立繪的 slug，前端組成 /participants/{slug}-lg.webp */
	blueDoro: string | null;
	redDoro: string | null;
	scoreBlue: number;
	scoreRed: number;
	state: string;
	winnerSide: string | null;
}

function marketLabel(gameNo: number) {
	return gameNo === 0 ? '整場勝負' : `第 ${gameNo} 局`;
}

function toBoardMatch(
	m: typeof matches.$inferSelect,
	people: (typeof participants.$inferSelect)[]
): BoardMatch {
	const find = (id: number | null) => (id === null ? null : (people.find((p) => p.id === id) ?? null));
	const blue = find(m.blueParticipantId);
	const red = find(m.redParticipantId);

	return {
		id: m.id,
		orderNo: m.orderNo,
		roundLabel: m.roundLabel,
		format: m.format,
		isElimination: m.isElimination,
		blueName: blue?.name ?? null,
		redName: red?.name ?? null,
		blueDoro: blue?.doroSlug ?? null,
		redDoro: red?.doroSlug ?? null,
		scoreBlue: m.scoreBlue,
		scoreRed: m.scoreRed,
		state: m.state,
		winnerSide: m.winnerSide
	};
}

/**
 * 看板資料。
 *
 * ⚠️ 這裡刻意「一次抓完再用記憶體算」，不要改回逐項查詢。
 *
 * 原本的寫法有 9 次序列查詢（挑當前場次、抓盤口、抓參賽者名字、
 * 找上一場、找下一場、再各抓一次名字…）。本機對著 Docker 跑
 * 每次往返不到 1ms，完全看不出問題；但正式站的 Function 在 us-east-1、
 * 資料庫在別的洲，每次往返 200ms 以上，9 次就是 2 秒起跳，首頁直接超時。
 *
 * 全部資料量都很小（13 場次、數十個盤口、12 位成員），
 * 一次抓回來在記憶體裡挑，比精準查詢快得多。
 */
export async function getBoardState() {
	// 先把倒數到期的盤口改成 locked，否則前台會繼續顯示下注介面
	await expireLocks();

	const [allMatches, allMarkets, allPeople] = await Promise.all([
		db.select().from(matches).orderBy(asc(matches.orderNo)),
		db.select().from(markets),
		db.select().from(participants)
	]);

	if (!allMatches.length) {
		return { now: new Date().toISOString(), current: null, markets: [], previous: null, next: null };
	}

	// 當前場次：優先有開放中的盤口，其次待結算，再其次下一個未完成的
	const hasState = (matchId: number, state: string) =>
		allMarkets.some((mk) => mk.matchId === matchId && mk.state === state);

	const current =
		allMatches.find((m) => hasState(m.id, 'open')) ??
		allMatches.find((m) => hasState(m.id, 'locked')) ??
		allMatches.find((m) => m.state !== 'done' && m.state !== 'void') ??
		allMatches[allMatches.length - 1];

	const boardMarkets: BoardMarket[] = allMarkets
		.filter((mk) => mk.matchId === current.id)
		.sort((a, b) => a.gameNo - b.gameNo)
		.map((mk) => {
			const odds = calcOdds(mk.poolBlue, mk.poolRed);
			return {
				id: mk.id,
				gameNo: mk.gameNo,
				label: marketLabel(mk.gameNo),
				state: mk.state,
				poolBlue: mk.poolBlue,
				poolRed: mk.poolRed,
				total: odds.total,
				oddsBlue: odds.blue,
				oddsRed: odds.red,
				lockAt: mk.lockAt ? mk.lockAt.toISOString() : null,
				winnerSide: mk.winnerSide
			};
		});

	const prevRow = [...allMatches]
		.reverse()
		.find((m) => m.orderNo < current.orderNo && m.state === 'done');

	const nextRow = allMatches.find((m) => m.orderNo > current.orderNo && m.state !== 'void');

	return {
		now: new Date().toISOString(),
		current: toBoardMatch(current, allPeople),
		markets: boardMarkets,
		previous: prevRow ? toBoardMatch(prevRow, allPeople) : null,
		next: nextRow ? toBoardMatch(nextRow, allPeople) : null
	};
}

/**
 * 籌碼排行榜。
 *
 * 每次都要把整張帳本加總，比看板貴得多，所以快取時間拉長到 60 秒
 * （企劃書的 DEMO 圖也寫「每分鐘更新一次」）。
 */
export async function getLeaderboard(limit = 5) {
	const rows = await db
		.select({
			displayName: users.displayName,
			avatarUrl: users.avatarUrl,
			balance: sql<number>`COALESCE(SUM(${ledger.amount}), 0)::bigint`
		})
		.from(users)
		.leftJoin(ledger, eq(ledger.userId, users.id))
		.where(eq(users.status, 'active'))
		.groupBy(users.id, users.displayName, users.avatarUrl)
		.orderBy(desc(sql`COALESCE(SUM(${ledger.amount}), 0)`))
		.limit(limit);

	return rows.map((r, i) => ({ rank: i + 1, ...r, balance: Number(r.balance) }));
}

export interface BracketNode {
	orderNo: number;
	roundLabel: string;
	format: string;
	state: string;
	bracket: string;
	roundNo: number;
	blueName: string | null;
	redName: string | null;
	blueDoro: string | null;
	redDoro: string | null;
	scoreBlue: number;
	scoreRed: number;
	winnerSide: string | null;
	/** 這一場有沒有正在開放的盤口，前台用來標「可下注」 */
	hasOpenMarket: boolean;
}

/**
 * 賽程樹。回傳依 bracket 與輪次分組的場次，供前台畫樹狀圖。
 *
 * 加賽（final R2）只有在真的觸發時才回傳 —— 沒發生的話畫出來會讓觀眾誤會
 * 一定會打到那一場。判斷方式是總決賽已經有對戰組合且加賽也被指派了人。
 */
export async function getBracket() {
	const [allMatches, allPeople, allMarkets] = await Promise.all([
		db.select().from(matches).orderBy(asc(matches.orderNo)),
		db.select().from(participants),
		db.select().from(markets)
	]);

	const nameOf = (id: number | null) =>
		id === null ? null : (allPeople.find((p) => p.id === id) ?? null);

	const nodes: BracketNode[] = allMatches
		.filter((m) => {
			// 加賽未觸發就不顯示
			if (m.bracket === 'final' && m.roundNo === 2) {
				return m.blueParticipantId !== null || m.redParticipantId !== null;
			}
			return true;
		})
		.map((m) => {
			const blue = nameOf(m.blueParticipantId);
			const red = nameOf(m.redParticipantId);
			return {
				orderNo: m.orderNo,
				roundLabel: m.roundLabel,
				format: m.format,
				state: m.state,
				bracket: m.bracket,
				roundNo: m.roundNo,
				blueName: blue?.name ?? null,
				redName: red?.name ?? null,
				blueDoro: blue?.doroSlug ?? null,
				redDoro: red?.doroSlug ?? null,
				scoreBlue: m.scoreBlue,
				scoreRed: m.scoreRed,
				winnerSide: m.winnerSide,
				hasOpenMarket: allMarkets.some((mk) => mk.matchId === m.id && mk.state === 'open')
			};
		});

	/** 依 bracket 分組，每組再依輪次切成一欄一欄 */
	const group = (name: string) => {
		const inBracket = nodes.filter((n) => n.bracket === name);
		const rounds = [...new Set(inBracket.map((n) => n.roundNo))].sort((a, b) => a - b);
		return rounds.map((r) => ({
			roundNo: r,
			label: inBracket.find((n) => n.roundNo === r)?.roundLabel ?? '',
			matches: inBracket.filter((n) => n.roundNo === r)
		}));
	};

	return { winners: group('winners'), losers: group('losers'), final: group('final') };
}

/** 賽況資訊區用：參賽者與主持群，含立繪與頻道連結。 */
export async function getRoster() {
	const rows = await db.select().from(participants).orderBy(asc(participants.orderNo));
	return {
		players: rows.filter((p) => p.role === 'player'),
		hosts: rows.filter((p) => p.role === 'host')
	};
}

/** 使用者在指定盤口上已下的注，用於前台顯示「你已押 X」。 */
export async function getMyBets(userId: string, limit = 30) {
	const rows = await db
		.select({
			id: bets.id,
			side: bets.side,
			amount: bets.amount,
			state: bets.state,
			payout: bets.payout,
			createdAt: bets.createdAt,
			marketId: markets.id,
			gameNo: markets.gameNo,
			marketState: markets.state,
			matchOrderNo: matches.orderNo,
			roundLabel: matches.roundLabel
		})
		.from(bets)
		.innerJoin(markets, eq(bets.marketId, markets.id))
		.innerJoin(matches, eq(markets.matchId, matches.id))
		.where(eq(bets.userId, userId))
		.orderBy(desc(bets.id))
		.limit(limit);

	return rows.map((r) => ({
		...r,
		label: marketLabel(r.gameNo),
		/** 淨盈虧：已結算才有意義 */
		net: r.state === 'won' ? r.payout - r.amount : r.state === 'lost' ? -r.amount : 0
	}));
}
