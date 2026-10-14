/**
 * 整個資料庫的 JSON 快照。只讀，不會動到任何資料。
 *
 *   node scripts/backup.mjs
 *   node scripts/backup.mjs --url "<連線字串>"
 *
 * 寫到 backups/full-<時間>.json。改資料表結構（migration）或做任何
 * 大範圍操作之前先跑一次 —— reset.mjs 與 revert-credits.mjs 只備份
 * 自己會動到的那幾張表，這支是全部。
 *
 * ⚠️ 檔案裡有使用者的 Discord 暱稱與頭像網址，還原得出誰是誰。
 *    backups/ 已經在 .gitignore 裡，不要提交、不要外流。
 */

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const args = process.argv.slice(2);
const argOf = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

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

try {
	const host = (() => {
		try {
			return new URL(url).host;
		} catch {
			return '(無法解析)';
		}
	})();
	console.log(`連線至 ${host}`);

	// 問資料庫有哪些表，而不是寫死清單 —— 之後加了新表才不會漏備份
	const tables = await sql`
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		ORDER BY table_name`;

	const dump = { at: new Date().toISOString(), host, tables: {} };
	for (const { table_name: name } of tables) {
		if (name === '__drizzle_migrations') continue;
		const rows = await sql`SELECT * FROM ${sql(name)}`;
		dump.tables[name] = rows;
		console.log(`  ${name.padEnd(18)} ${rows.length} 列`);
	}

	const dir = path.join(process.cwd(), 'backups');
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `full-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
	fs.writeFileSync(file, JSON.stringify(dump, null, 2));

	const kb = Math.round(fs.statSync(file).size / 1024);
	console.log(`\n已備份到 ${path.relative(process.cwd(), file)}（${kb} KB）`);
} finally {
	await sql.end();
}
