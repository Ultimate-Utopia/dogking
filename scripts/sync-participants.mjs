/**
 * 把 src/lib/data/roster.js 的「人」的資料同步到資料庫。
 *
 *   node scripts/sync-participants.mjs          先試算（預設不動資料）
 *   node scripts/sync-participants.mjs --apply  實際更新
 *
 * 只動 participants 的顯示欄位（職稱、頻道連結、DORO 檔名），
 * 不碰場次、不碰帳本、不碰任何金額 —— 所以場上已經有應援也能安全執行。
 *
 * ⚠️ 為什麼需要這支：職稱之類的字串是<u>存在資料庫</u>的，
 *    roster.js 只是建立當下的來源。改了 roster.js 不重跑這支，網站上不會變。
 *    （例如 10-09 把「賭盤副台」改成「應援副台」就是這個情況。）
 *
 * 要整個重建場次請用 scripts/seed.mjs；那支在已經有人應援時會拒絕執行。
 */

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { ROSTER } from '../src/lib/data/roster.js';

const APPLY = process.argv.includes('--apply');

let url = process.env.DATABASE_URL;
if (!url) {
	const envPath = path.join(process.cwd(), '.env');
	if (fs.existsSync(envPath)) {
		const m = /^DATABASE_URL\s*=\s*"?([^"\n\r]+)/m.exec(fs.readFileSync(envPath, 'utf8'));
		if (m) url = m[1];
	}
}
if (!url) {
	console.error('找不到連線字串。請設定 DATABASE_URL，或在 .env 裡填好。');
	process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
const host = (() => {
	try {
		return new URL(url).host;
	} catch {
		return '(無法解析)';
	}
})();

try {
	console.log(`連線至 ${host}`);
	console.log(APPLY ? '模式：實際更新\n' : '模式：試算（不會變更任何資料）\n');

	const rows = await sql`SELECT id, name, role_label, channel_url, doro_slug FROM participants`;
	const byName = new Map(rows.map((r) => [r.name, r]));

	/** @type {Array<{id:number,name:string,changes:string[],next:Record<string,unknown>}>} */
	const todo = [];

	for (const p of ROSTER) {
		const cur = byName.get(p.name);
		if (!cur) {
			console.log(`  ⚠ 資料庫裡沒有「${p.name}」，略過（要新增請用 scripts/seed.mjs）`);
			continue;
		}
		const next = {
			role_label: p.roleLabel ?? null,
			channel_url: p.channelUrl ?? null,
			doro_slug: p.doroSlug ?? null
		};
		const changes = Object.entries(next)
			.filter(([k, v]) => (cur[k] ?? null) !== v)
			.map(([k, v]) => `${k}：${cur[k] ?? '(空)'} → ${v ?? '(空)'}`);
		if (changes.length) todo.push({ id: cur.id, name: p.name, changes, next });
	}

	if (!todo.length) {
		console.log('資料庫已經和 roster.js 一致，沒有要改的。');
	} else {
		for (const t of todo) {
			console.log(`  ${t.name}`);
			for (const c of t.changes) console.log(`      ${c}`);
		}
	}

	if (!APPLY) {
		if (todo.length) console.log('\n以上只是試算。確認無誤後加上 --apply 實際執行。');
		process.exit(0);
	}

	for (const t of todo) {
		await sql`
			UPDATE participants
			SET role_label = ${t.next.role_label},
			    channel_url = ${t.next.channel_url},
			    doro_slug = ${t.next.doro_slug}
			WHERE id = ${t.id}`;
	}
	console.log(`\n完成：更新 ${todo.length} 位。`);
} finally {
	await sql.end();
}
