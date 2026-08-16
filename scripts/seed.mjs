/**
 * 建立賽事初始資料，可對任何資料庫執行（包含正式站）。
 *
 *   node scripts/seed.mjs                          用 .env 的 DATABASE_URL
 *   node scripts/seed.mjs --url "postgres://..."   指定連線字串
 *   node scripts/seed.mjs --admin <discord_id>     順便把某人設為管理員
 *
 * 為什麼需要這支腳本：/dev/seed 與 /dev/make-admin 在正式環境會回 404
 * （那是刻意的，那些端點能清空資料）。所以正式站上線後，
 * 得有另一條路建立參賽者、場次，以及指定第一位管理員。
 *
 * 可重複執行：已存在的資料只會被更新，不會重複建立。
 */

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { ROSTER, MATCHES } from '../src/lib/data/roster.js';

// ── 參數 ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const argOf = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

let url = argOf('--url');
if (!url) {
	// 從 .env 撈，避免把連線字串打在指令列上（會留在 shell 歷史裡）
	const envPath = path.join(process.cwd(), '.env');
	if (fs.existsSync(envPath)) {
		const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m);
		if (m) url = m[1];
	}
}
url ??= process.env.DATABASE_URL;

if (!url) {
	console.error('找不到連線字串。請用 --url，或在 .env 設定 DATABASE_URL。');
	process.exit(1);
}

const adminDiscordId = argOf('--admin');

// 只顯示主機名，不要把密碼印到終端機或 CI 記錄裡
const host = (() => {
	try {
		return new URL(url).host;
	} catch {
		return '(無法解析)';
	}
})();
console.log(`連線至 ${host}`);

const sql = postgres(url, { max: 1, prepare: false });

try {
	// ── 參賽者與主持群 ─────────────────────────────────
	let added = 0;
	let updated = 0;

	for (const [i, m] of ROSTER.entries()) {
		const [existing] = await sql`SELECT id FROM participants WHERE name = ${m.name} LIMIT 1`;

		if (existing) {
			await sql`
				UPDATE participants SET
					role = ${m.role},
					role_label = ${m.roleLabel ?? null},
					doro_slug = ${m.doroSlug},
					channel_url = ${m.channelUrl}
				WHERE id = ${existing.id}`;
			updated++;
		} else {
			await sql`
				INSERT INTO participants (name, role, role_label, doro_slug, channel_url, order_no)
				VALUES (${m.name}, ${m.role}, ${m.roleLabel ?? null}, ${m.doroSlug}, ${m.channelUrl}, ${i + 1})`;
			added++;
		}
	}
	console.log(`參賽者與主持群：新增 ${added}、更新 ${updated}`);

	// ── 場次骨架 ───────────────────────────────────────
	// 只在完全沒有場次時建立。已經開始跑的賽程不該被腳本覆蓋。
	const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM matches`;
	if (count === 0) {
		for (const m of MATCHES) {
			await sql`
				INSERT INTO matches (order_no, round_label, format, is_elimination)
				VALUES (${m.orderNo}, ${m.roundLabel}, ${m.format}, ${m.isElimination})`;
		}
		console.log(`場次：建立 ${MATCHES.length} 場`);
	} else {
		console.log(`場次：已有 ${count} 場，略過（不覆蓋進行中的賽程）`);
	}

	// ── 管理員 ─────────────────────────────────────────
	if (adminDiscordId) {
		const rows = await sql`
			UPDATE users SET is_admin = true
			WHERE discord_id = ${adminDiscordId}
			RETURNING display_name`;

		if (rows.length) {
			console.log(`管理員：${rows[0].display_name} 已設為管理員`);
		} else {
			console.log(`管理員：找不到 discord_id = ${adminDiscordId} 的帳號`);
			console.log('         請該帳號先用 Discord 登入一次，再重跑這個指令。');
		}
	}

	console.log('完成。');
} finally {
	await sql.end();
}
