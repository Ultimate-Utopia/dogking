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

/**
 * 前台「所有場次」列表的一列。
 *
 * 這次的玩法是所有場次一開場就開放下注，連還沒確定對手的場次也能押，
 * 所以每一列都要能自己交代「你押的是誰」—— 對手未定時顯示晉級來源（M1 勝者）。
 */
export interface BoardBar {
	matchId: number;
	orderNo: number;
	roundLabel: string;
	format: string;
	matchState: string;
	/** 場次的勝方，已比完才有 */
	matchWinnerSide: string | null;
	blueName: string | null;
	redName: string | null;
	blueDoro: string | null;
	redDoro: string | null;
	/** 對手未定時的說明文字，例如「M1 勝者」；種子位為 null */
	blueFrom: string | null;
	redFrom: string | null;
	/** 整場盤。還沒開盤時為 null。 */
	market: BoardMarket | null;
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

/**
 * 誰把人送進 (場次, 那一側)。沒人送就是種子位。
 * 賽程樹與場次列表都要用：還沒確定對手時要顯示「M1 勝者」而不是一片空白。
 */
function feederOf(all: (typeof matches.$inferSelect)[], matchNo: number, slot: string) {
	for (const m of all) {
		if (m.winnerToMatchNo === matchNo && m.winnerToSlot === slot) {
			return { matchNo: m.orderNo, kind: 'win' as const };
		}
		if (m.loserToMatchNo === matchNo && m.loserToSlot === slot) {
			return { matchNo: m.orderNo, kind: 'lose' as const };
		}
	}
	return null;
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
		return {
			now: new Date().toISOString(),
			current: null,
			markets: [],
			bars: [],
			previous: null,
			next: null
		};
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

	/** 所有場次的整場盤，給前台的提前下注列表 */
	const bars: BoardBar[] = allMatches
		.filter((m) => m.state !== 'void')
		.map((m) => {
			const blue = allPeople.find((p) => p.id === m.blueParticipantId) ?? null;
			const red = allPeople.find((p) => p.id === m.redParticipantId) ?? null;
			const mk = allMarkets.find((x) => x.matchId === m.id && x.gameNo === 0) ?? null;
			const from = (slot: 'blue' | 'red') => {
				const f = feederOf(allMatches, m.orderNo, slot);
				return f ? `M${f.matchNo} ${f.kind === 'win' ? '勝者' : '敗者'}` : null;
			};

			let market: BoardMarket | null = null;
			if (mk) {
				const odds = calcOdds(mk.poolBlue, mk.poolRed);
				market = {
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
			}

			return {
				matchId: m.id,
				orderNo: m.orderNo,
				roundLabel: m.roundLabel,
				format: m.format,
				matchState: m.state,
				matchWinnerSide: m.winnerSide,
				blueName: blue?.name ?? null,
				redName: red?.name ?? null,
				blueDoro: blue?.doroSlug ?? null,
				redDoro: red?.doroSlug ?? null,
				blueFrom: from('blue'),
				redFrom: from('red'),
				market
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
		bars,
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
	/** 畫在第幾欄＝輪次。見 layoutBracket。 */
	col: number;
	/** 在自己那一排裡的垂直位置，單位是「一格場次的高度」，可以是 0.5 這種半格。 */
	y: number;
	winnerTo: { matchNo: number; slot: string } | null;
	/** 空位要顯示什麼：「M2 勝者」「M1 敗者」，或 null 代表種子位（待定） */
	blueFrom: { matchNo: number; kind: 'win' | 'lose' } | null;
	redFrom: { matchNo: number; kind: 'win' | 'lose' } | null;
}

export interface BracketView {
	nodes: BracketNode[];
	/** 總決賽所在欄；冠軍在它右邊一欄 */
	finalCol: number;
	/** 勝部與敗部各自佔幾格高（決定兩排的高度） */
	laneRows: { winners: number; losers: number };
	champion: { name: string; doro: string | null } | null;
}

type MatchRow = typeof matches.$inferSelect;

/**
 * 樹狀圖的版面：每一場的欄位與垂直位置。
 *
 * 欄位＝輪次（決賽排在最後），和主辦方賽程圖的排法一致，
 * 觀眾拿兩張圖對照時場次位置才對得上。
 *
 * 垂直位置照一般賽程表的做法：
 *   ・場次最多的那一欄當基準，由上而下一格一格排
 *   ・右邊的場次放在「送人進來的那幾場」的正中間（M9 夾在 M2、M3 之間）
 *   ・左邊的場次放在它要去的那一格旁邊，送藍方就偏上半格、送紅方就偏下半格
 *     （M1 送進 M2 藍方，所以 M1 比 M2 高半格）
 *
 * 只看同一排內的勝者線。敗者從勝部掉到敗部是跨排的，
 * 樹狀圖上不畫線，改在空位上寫「M1 敗者」—— 也是賽程圖本身的標法。
 */
function layoutLane(lane: MatchRow[]): Map<number, number> {
	const y = new Map<number, number>();
	if (!lane.length) return y;

	const byCol = new Map<number, MatchRow[]>();
	for (const m of [...lane].sort((a, b) => a.orderNo - b.orderNo)) {
		const list = byCol.get(m.roundNo);
		if (list) list.push(m);
		else byCol.set(m.roundNo, [m]);
	}
	const cols = [...byCol.keys()].sort((a, b) => a - b);
	const anchor = cols.reduce((best, c) => (byCol.get(c)!.length > byCol.get(best)!.length ? c : best));
	const inLane = new Set(lane.map((m) => m.orderNo));

	/** 同一欄裡不能疊在一起：比上一場近於一格就往下推 */
	const place = (col: MatchRow[], want: (m: MatchRow, prev: number | null) => number) => {
		let prev: number | null = null;
		for (const m of col) {
			let v = want(m, prev);
			if (prev !== null && v < prev + 1) v = prev + 1;
			y.set(m.orderNo, v);
			prev = v;
		}
	};

	place(byCol.get(anchor)!, (_m, prev) => (prev === null ? 0 : prev + 1));

	for (const c of cols.filter((c) => c > anchor)) {
		place(byCol.get(c)!, (m, prev) => {
			const feeders = lane.filter((f) => f.winnerToMatchNo === m.orderNo && y.has(f.orderNo));
			if (!feeders.length) return prev === null ? 0 : prev + 1;
			return feeders.reduce((s, f) => s + y.get(f.orderNo)!, 0) / feeders.length;
		});
	}

	for (const c of cols.filter((c) => c < anchor).reverse()) {
		place(byCol.get(c)!, (m, prev) => {
			const target = m.winnerToMatchNo;
			if (target === null || !inLane.has(target) || !y.has(target)) return prev === null ? 0 : prev + 1;
			return y.get(target)! + (m.winnerToSlot === 'blue' ? -0.5 : 0.5);
		});
	}

	// 往左推的時候可能出現負值，整排平移回從 0 開始
	const min = Math.min(...y.values());
	for (const [k, v] of y) y.set(k, v - min);
	return y;
}

/**
 * 賽程樹。回傳所有場次、版面位置、空位的來源，前台照著畫。
 */
export async function getBracket(): Promise<BracketView> {
	const [allMatches, allPeople, allMarkets] = await Promise.all([
		db.select().from(matches).orderBy(asc(matches.orderNo)),
		db.select().from(participants),
		db.select().from(markets)
	]);

	const winners = allMatches.filter((m) => m.bracket === 'winners');
	const losers = allMatches.filter((m) => m.bracket === 'losers');
	const yOf = new Map([...layoutLane(winners), ...layoutLane(losers)]);

	const lastRound = Math.max(0, ...winners.map((m) => m.roundNo), ...losers.map((m) => m.roundNo));
	const colOf = (m: MatchRow) => (m.bracket === 'final' ? lastRound + m.roundNo - 1 : m.roundNo - 1);

	/** 誰把人送進 (場次, 那一側)。沒人送就是種子位。 */
	const fromOf = (matchNo: number, slot: string): BracketNode['blueFrom'] => {
		for (const m of allMatches) {
			if (m.winnerToMatchNo === matchNo && m.winnerToSlot === slot) return { matchNo: m.orderNo, kind: 'win' };
			if (m.loserToMatchNo === matchNo && m.loserToSlot === slot) return { matchNo: m.orderNo, kind: 'lose' };
		}
		return null;
	};

	const personOf = (id: number | null) =>
		id === null ? null : (allPeople.find((p) => p.id === id) ?? null);

	const nodes: BracketNode[] = allMatches.map((m) => {
		const blue = personOf(m.blueParticipantId);
		const red = personOf(m.redParticipantId);
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
			hasOpenMarket: allMarkets.some((mk) => mk.matchId === m.id && mk.state === 'open'),
			col: colOf(m),
			y: yOf.get(m.orderNo) ?? 0,
			winnerTo:
				m.winnerToMatchNo !== null && m.winnerToSlot
					? { matchNo: m.winnerToMatchNo, slot: m.winnerToSlot }
					: null,
			blueFrom: fromOf(m.orderNo, 'blue'),
			redFrom: fromOf(m.orderNo, 'red')
		};
	});

	const rowsOf = (lane: string) => {
		const ys = nodes.filter((n) => n.bracket === lane).map((n) => n.y);
		return ys.length ? Math.max(...ys) + 1 : 0;
	};

	/**
	 * 冠軍＝最後一場決賽的勝者。
	 *
	 * 主辦方的賽程沒有「敗部冠軍贏了總決賽要再加賽」，總決賽打完就定冠軍。
	 * 若日後改成有加賽，這裡要改成回頭看勝方是不是從敗部上來的。
	 */
	const finals = nodes.filter((n) => n.bracket === 'final').sort((a, b) => b.orderNo - a.orderNo);
	const last = finals[0] ?? null;
	const champion =
		last && last.winnerSide
			? {
					name: (last.winnerSide === 'blue' ? last.blueName : last.redName) ?? '',
					doro: (last.winnerSide === 'blue' ? last.blueDoro : last.redDoro) ?? null
				}
			: null;

	return {
		nodes,
		finalCol: last ? last.col : lastRound,
		laneRows: { winners: rowsOf('winners'), losers: rowsOf('losers') },
		champion
	};
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
