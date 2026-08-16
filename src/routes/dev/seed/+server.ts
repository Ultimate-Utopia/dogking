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
 * 賽制與「輸者淘汰」是企劃書明確記載的：
 *   BO1 → 場次 1、2、3、4、7、8
 *   BO3 → 場次 5、6、9、10、11
 *   BO5 → 場次 12（總決賽）、13（加賽）
 *   輸者淘汰 → 場次 7～11
 *
 * 場次 9～11 的輪次名稱從企劃書文字推不出來（需對照賽程圖），
 * 先標為待確認，後台可直接改。
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
	{ orderNo: 9, roundLabel: '待確認（對照賽程圖）', format: 'BO3', isElimination: true },
	{ orderNo: 10, roundLabel: '待確認（對照賽程圖）', format: 'BO3', isElimination: true },
	{ orderNo: 11, roundLabel: '待確認（對照賽程圖）', format: 'BO3', isElimination: true },
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
