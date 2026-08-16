/**
 * 一鍵準備測試場景 —— 僅開發模式可用。
 *
 * 手動測試時每次都要「設對戰 → 開盤 → 找人下注」很麻煩，
 * 而且只有一個帳號的話彩池是自己對自己，賠率看不出變化。
 * 這裡用示範帳號製造有對手的盤面。
 *
 *   /dev/demo          建立場景
 *   /dev/demo?reset=1  清空所有下注與盤口，回到乾淨狀態
 *
 * 練習賽直播的彩排也可以用這個先跑一遍。
 */

import { json, error } from '@sveltejs/kit';
import { requireLocalDev } from '$lib/server/dev-guard';
import { eq, inArray, asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { users, ledger, bets, markets, matches, participants } from '$lib/server/db/schema';
import { lockUser, writeLedger, getBalance } from '$lib/server/ledger';
import { openMarket, placeBet, scheduleLock, setMatchParticipants } from '$lib/server/tournament';

const DEMO_PREFIX = 'demo-';
const DEMO_ACCOUNTS = [
	{ key: 'demo-1', name: '示範觀眾A', funds: 50000 },
	{ key: 'demo-2', name: '示範觀眾B', funds: 50000 },
	{ key: 'demo-3', name: '示範觀眾C', funds: 50000 }
];

/** 讓登入者有足夠的錢可以測試，不夠才補到這個數。 */
const PLAY_MONEY = 20000;

async function reset() {
	// 先把示範帳號的所有痕跡清掉
	const demo = await db.select().from(users);
	const demoIds = demo.filter((u) => u.discordId.startsWith(DEMO_PREFIX)).map((u) => u.id);

	// 帳本參照 bets 與 markets，必須最先刪
	await db.delete(ledger).where(inArray(ledger.type, ['bet', 'payout', 'refund']));
	if (demoIds.length) await db.delete(ledger).where(inArray(ledger.userId, demoIds));

	await db.delete(bets);
	await db.delete(markets);

	if (demoIds.length) {
		await db.delete(users).where(inArray(users.id, demoIds));
	}

	await db.update(matches).set({
		blueParticipantId: null,
		redParticipantId: null,
		scoreBlue: 0,
		scoreRed: 0,
		state: 'pending',
		winnerSide: null
	});

	return { reset: true, note: '所有盤口與下注已清除，帳本只留註冊贈送與人工調整' };
}

async function ensureDemoUser(key: string, name: string, funds: number) {
	const [existing] = await db.select().from(users).where(eq(users.discordId, key)).limit(1);

	const id =
		existing?.id ??
		(await db.insert(users).values({ discordId: key, displayName: name }).returning())[0].id;

	const balance = await getBalance(id);
	if (balance < funds) {
		await db.transaction(async (tx) => {
			await lockUser(tx, id);
			await writeLedger(tx, {
				userId: id,
				type: 'adjust',
				amount: funds - balance,
				note: '示範帳號補幣'
			});
		});
	}
	return id;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	requireLocalDev();

	if (url.searchParams.get('reset')) {
		return json(await reset());
	}

	// 從乾淨狀態開始，避免疊加上次的殘留
	await reset();

	const all = await db.select().from(participants).orderBy(asc(participants.orderNo));
	if (all.length < 2) error(400, '參賽者資料不足，請先呼叫 /dev/seed');

	const [match] = await db.select().from(matches).orderBy(asc(matches.orderNo)).limit(1);
	if (!match) error(400, '沒有場次資料，請先呼叫 /dev/seed');

	await setMatchParticipants(match.id, all[0].id, all[1].id);

	const demoIds = [];
	for (const a of DEMO_ACCOUNTS) {
		demoIds.push(await ensureDemoUser(a.key, a.name, a.funds));
	}

	// 整場盤：兩邊都有錢，賠率才有得看
	const main = await openMarket(match.id, 0);
	await placeBet({ userId: demoIds[0], marketId: main.id, side: 'blue', amount: 8000, idempotencyKey: crypto.randomUUID() });
	await placeBet({ userId: demoIds[1], marketId: main.id, side: 'red', amount: 5000, idempotencyKey: crypto.randomUUID() });
	await placeBet({ userId: demoIds[2], marketId: main.id, side: 'red', amount: 3000, idempotencyKey: crypto.randomUUID() });

	// 第 1 局：設 3 分鐘倒數，方便看計時器
	const game1 = await openMarket(match.id, 1);
	await placeBet({ userId: demoIds[0], marketId: game1.id, side: 'red', amount: 2000, idempotencyKey: crypto.randomUUID() });
	await placeBet({ userId: demoIds[1], marketId: game1.id, side: 'blue', amount: 1500, idempotencyKey: crypto.randomUUID() });
	await scheduleLock(game1.id, 180);

	// 讓登入者有錢可以玩
	let yourBalance: number | null = null;
	if (locals.user) {
		const balance = await getBalance(locals.user.id);
		if (balance < PLAY_MONEY) {
			await db.transaction(async (tx) => {
				await lockUser(tx, locals.user!.id);
				await writeLedger(tx, {
					userId: locals.user!.id,
					type: 'adjust',
					amount: PLAY_MONEY - balance,
					note: '測試補幣'
				});
			});
		}
		yourBalance = await getBalance(locals.user.id);
	}

	return json({
		ok: true,
		對戰: `${all[0].name}（藍） vs ${all[1].name}（紅）`,
		整場盤: '已開放，彩池 藍 8,000 / 紅 8,000',
		第一局盤: '已開放，彩池 藍 1,500 / 紅 2,000，180 秒後封盤',
		你的餘額: yourBalance ?? '（未登入）',
		下一步: '回首頁即可下注。清空請用 /dev/demo?reset=1'
	});
};
