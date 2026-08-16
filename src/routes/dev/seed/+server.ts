/**
 * 賽事初始資料 —— 僅開發模式可用，可重複執行（已存在就更新）。
 *
 * 資料來自 src/lib/data/roster.js，與 scripts/seed.mjs 共用同一份。
 * 正式站因為這個端點會回 404，請改用該腳本。
 */

import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { asc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { participants, matches } from '$lib/server/db/schema';
import { ROSTER, MATCHES } from '$lib/data/roster.js';

export const GET: RequestHandler = async () => {
	if (!dev) error(404, 'Not found');

	const existingP = await db.select().from(participants);
	const existingM = await db.select().from(matches);

	let addedParticipants = 0;
	let addedMatches = 0;

	// 逐筆比對名稱：已存在就更新，不存在就新增。
	// 用 upsert 而非「全空才建立」，新成員或新交件的立繪才補得進來。
	for (const [i, p] of ROSTER.entries()) {
		const found = existingP.find((e) => e.name === p.name);
		if (found) {
			await db
				.update(participants)
				.set({
					role: p.role,
					roleLabel: p.roleLabel ?? null,
					doroSlug: p.doroSlug,
					channelUrl: p.channelUrl
				})
				.where(eq(participants.id, found.id));
		} else {
			await db.insert(participants).values({ ...p, orderNo: i + 1 });
			addedParticipants++;
		}
	}

	// 場次只在完全沒有時建立，不覆蓋進行中的賽程
	if (existingM.length === 0) {
		await db.insert(matches).values(MATCHES);
		addedMatches = MATCHES.length;
	}

	const finalP = await db.select().from(participants).orderBy(asc(participants.orderNo));
	const finalM = await db.select().from(matches).orderBy(asc(matches.orderNo));

	return json({
		新增參賽者: addedParticipants,
		新增場次: addedMatches,
		參賽者: finalP.filter((p) => p.role === 'player').map((p) => `${p.name}（${p.doroSlug}）`),
		主持群: finalP.filter((p) => p.role === 'host').map((p) => `${p.roleLabel} ${p.name}`),
		場次: finalM.map((m) => `${m.orderNo}. ${m.roundLabel} ${m.format}${m.isElimination ? '・淘汰' : ''}`)
	});
};
