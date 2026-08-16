/**
 * 賽事初始資料 —— 僅開發模式可用，可重複執行（已存在就跳過）。
 *
 * 建立 9 位參賽主播與 13 個場次骨架。
 *
 * 對戰組合刻意留空：雙敗淘汰下，場次 5 的對手要等場次 1、2 打完才確定，
 * 因此由後台在賽程推進時填入（規格書 §06）。
 */

import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { participants, matches } from '$lib/server/db/schema';

/** 參賽主播。頻道連結與立繪待補。 */
const PARTICIPANTS = [
	'呦呦',
	'希亞',
	'咩嚕',
	'雪寶',
	'渡渡',
	'悠妮',
	'阿翼',
	'姆莉',
	'愛紗'
];

/**
 * 場次骨架。
 *
 * 企劃書明確記載的部分：
 *   BO1 → 場次 1、2、3、4、7、8
 *   BO3 → 場次 5、6、9、10、11
 *   BO5 → 場次 12（總決賽）、13（加賽）
 *   輸者淘汰 → 場次 7～11
 *   「複賽階段（勝部四強至決賽、敗部後續輪次）採 BO3」
 *
 * 輪次名稱由上述推得：既然 BO3 涵蓋「勝部四強**至決賽**」，
 * 代表 5、6、9、10、11 之中必有一場是勝部決賽。依照打序，
 * 勝部決賽排在敗部第一輪（7、8）之後最合理，故定為場次 9。
 *
 * ⚠️ 一處與企劃書不符：企劃書把場次 9 列為「輸者淘汰」，
 * 但勝部決賽的敗者依定義是掉到敗部、不是淘汰，否則就不是雙敗淘汰了。
 * 這裡採結構上正確的版本（isElimination = false）。
 *
 * ⚠️ 更根本的問題：9 人雙敗淘汰需要 16 場才能決出冠軍
 * （要淘汰 8 人 × 每人 2 敗 = 16 敗，每場產生 1 敗），企劃書只列 12 場。
 * 詳見規格書 §06。這些欄位全部可在後台修改，也可新增場次。
 */
const MATCHES: Array<{
	orderNo: number;
	roundLabel: string;
	format: 'BO1' | 'BO3' | 'BO5';
	isElimination: boolean;
}> = [
	{ orderNo: 1, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 2, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 3, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 4, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 5, roundLabel: '勝部四強', format: 'BO3', isElimination: false },
	{ orderNo: 6, roundLabel: '勝部四強', format: 'BO3', isElimination: false },
	{ orderNo: 7, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true },
	{ orderNo: 8, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true },
	// 勝部決賽：敗者掉到敗部而非淘汰，故 isElimination = false（與企劃書註記不同）
	{ orderNo: 9, roundLabel: '勝部決賽', format: 'BO3', isElimination: false },
	{ orderNo: 10, roundLabel: '敗部第二輪', format: 'BO3', isElimination: true },
	{ orderNo: 11, roundLabel: '敗部決賽', format: 'BO3', isElimination: true },
	{ orderNo: 12, roundLabel: '總決賽', format: 'BO5', isElimination: true },
	{ orderNo: 13, roundLabel: '加賽（敗部冠軍勝出時觸發）', format: 'BO5', isElimination: true }
];

export const GET: RequestHandler = async () => {
	if (!dev) error(404, 'Not found');

	const existingP = await db.select().from(participants);
	const existingM = await db.select().from(matches);

	let addedParticipants = 0;
	let addedMatches = 0;

	if (existingP.length === 0) {
		await db
			.insert(participants)
			.values(PARTICIPANTS.map((name, i) => ({ name, orderNo: i + 1 })));
		addedParticipants = PARTICIPANTS.length;
	}

	if (existingM.length === 0) {
		await db.insert(matches).values(MATCHES);
		addedMatches = MATCHES.length;
	}

	const finalP = await db.select().from(participants).orderBy(asc(participants.orderNo));
	const finalM = await db.select().from(matches).orderBy(asc(matches.orderNo));

	return json({
		addedParticipants,
		addedMatches,
		skipped: addedParticipants === 0 && addedMatches === 0 ? '資料已存在，未重複建立' : undefined,
		participants: finalP.map((p) => p.name),
		matches: finalM.map((m) => ({
			場次: m.orderNo,
			輪次: m.roundLabel,
			賽制: m.format,
			輸者淘汰: m.isElimination,
			對戰: m.blueParticipantId && m.redParticipantId ? '已定' : '待賽程推進'
		}))
	});
};
