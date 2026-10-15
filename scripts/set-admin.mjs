/**
 * 開／收後台權限。
 *
 *   node scripts/set-admin.mjs --name 薯薯            先找人（預設不動資料）
 *   node scripts/set-admin.mjs --name 薯薯 --apply    開權限
 *   node scripts/set-admin.mjs --name 薯薯 --revoke --apply   收回權限
 *   node scripts/set-admin.mjs --list                 列出目前的管理員
 *
 * --name 是暱稱的一部分，不分大小寫。<strong>找到不只一個人就拒絕執行</strong> ——
 * 後台能發幣、能扣幣、能判定勝負，開錯人比漏開嚴重得多。
 *
 * ⚠️ 不會讓你收掉最後一個管理員。收完沒人能進後台，活動當天就沒救了。
 */

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = has('--apply');
const REVOKE = has('--revoke');
const LIST = has('--list');
const NAME = (argOf('--name') ?? '').trim();

if (!LIST && !NAME) {
	console.error('請用 --name 指定暱稱的一部分，或用 --list 看目前有誰。');
	process.exit(1);
}

let url = argOf('--url');
if (!url) {
	const envPath = path.join(process.cwd(), '.env');
	if (fs.existsSync(envPath)) {
		const m = /^DATABASE_URL\s*=\s*"?([^"\n\r]+)/m.exec(fs.readFileSync(envPath, 'utf8'));
		if (m) url = m[1];
	}
}
url ??= process.env.DATABASE_URL;
if (!url) {
	console.error('找不到連線字串。請用 --url，或在 .env 設定 DATABASE_URL。');
	process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

const showAdmins = async () => {
	const rows = await sql`SELECT display_name FROM users WHERE is_admin ORDER BY display_name`;
	console.log(`\n目前的管理員（${rows.length} 位）`);
	for (const r of rows) console.log(`  ${r.display_name}`);
	return rows.length;
};

try {
	const host = (() => {
		try {
			return new URL(url).host;
		} catch {
			return '(無法解析)';
		}
	})();
	console.log(`連線至 ${host}`);

	if (LIST) {
		await showAdmins();
		process.exit(0);
	}

	console.log(APPLY ? '模式：實際執行' : '模式：試算（不會變更任何資料）');

	const found = await sql`
		SELECT id, display_name, is_admin FROM users
		WHERE display_name ILIKE ${'%' + NAME + '%'}
		ORDER BY display_name`;

	if (!found.length) {
		console.error(`\n找不到暱稱含「${NAME}」的帳號。對方要先用 Discord 登入過一次才會有帳號。`);
		process.exit(1);
	}
	if (found.length > 1) {
		console.error(`\n找到 ${found.length} 個帳號，不確定是哪一位，拒絕執行：`);
		for (const r of found) console.error(`  ${r.display_name}`);
		console.error('請把 --name 寫得更精確一點。');
		process.exit(1);
	}

	const [user] = found;
	const want = !REVOKE;
	console.log(`\n  ${user.display_name}　管理員 ${user.is_admin} → ${want}`);

	if (user.is_admin === want) {
		console.log(want ? '已經是管理員了，不用改。' : '本來就不是管理員，不用改。');
		await showAdmins();
		process.exit(0);
	}

	if (REVOKE) {
		const [c] = await sql`SELECT COUNT(*)::int AS n FROM users WHERE is_admin`;
		if (c.n <= 1) {
			console.error('\n這是最後一個管理員，收掉就沒有人能進後台了，拒絕執行。');
			process.exit(1);
		}
	}

	if (!APPLY) {
		console.log('\n以上只是試算。確認無誤後加上 --apply 實際執行。');
		await showAdmins();
		process.exit(0);
	}

	await sql`UPDATE users SET is_admin = ${want} WHERE id = ${user.id}`;
	console.log(`\n完成：${user.display_name} ${want ? '已開通後台權限' : '已收回後台權限'}。`);
	await showAdmins();
} finally {
	await sql.end();
}
