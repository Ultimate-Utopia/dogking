/**
 * 清除下注資料，回到「還沒開始下注」的狀態。
 *
 * 主要用途：練習賽彩排完，要把正式站清乾淨再開始真正的活動。
 *
 *   node scripts/reset.mjs                    先看會刪什麼（預設不動資料）
 *   node scripts/reset.mjs --apply            實際執行，執行前自動備份
 *   node scripts/reset.mjs --apply --keep-matches   保留對戰組合與比分
 *   node scripts/reset.mjs --url "postgres://..."   指定資料庫
 *
 * ── 會刪除 ──────────────────────────────────────────────
 *   markets           所有盤口
 *   bets              所有注單
 *   ledger            只刪 bet / payout / refund 三種
 *   matches 的比分與對戰組合（除非加 --keep-matches）
 *
 * ── 不會動 ──────────────────────────────────────────────
 *   使用者帳號與 sessions（不會把大家踢下線）
 *   ledger 的 signup / purchase / adjust
 *     ⚠️ purchase 是買周邊換來的，背後有真實金錢，絕對不能刪
 *   participants、purchase_orders、redeem_codes、admin_logs
 *
 * 結果是每個人的餘額回到「註冊贈送 + 周邊訂單 + 人工調整」的總和。
 */

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

// ── 參數 ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = has('--apply');
const KEEP_MATCHES = has('--keep-matches');
const NO_BACKUP = has('--no-backup');

let url = argOf('--url');
if (!url) {
	// 從 .env 讀生效中的那一行，避免把連線字串留在 shell 歷史裡
	const envPath = path.join(process.cwd(), '.env');
	if (fs.existsSync(envPath)) {
		url = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL="([^"]+)"/m)?.[1];
	}
}
url ??= process.env.DATABASE_URL;

if (!url) {
	console.error('找不到連線字串。請用 --url，或在 .env 設定 DATABASE_URL。');
	process.exit(1);
}

const host = (() => {
	try {
		return new URL(url).hostname;
	} catch {
		return '(無法解析)';
	}
})();

const fmt = (n) => Number(n).toLocaleString('zh-TW');

console.log('');
console.log(`  資料庫  ${host}`);
console.log(`  模式    ${APPLY ? '⚠️  實際執行' : '預覽（不會修改任何資料）'}`);
if (KEEP_MATCHES) console.log('  選項    保留對戰組合與比分');
console.log('');

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

try {
	// ── 盤點 ───────────────────────────────────────────────
	const [before] = await sql`
		SELECT
			(SELECT COUNT(*) FROM markets) AS markets,
			(SELECT COUNT(*) FROM bets) AS bets,
			(SELECT COUNT(*) FROM ledger WHERE type IN ('bet','payout','refund')) AS ledger_bet,
			(SELECT COUNT(*) FROM ledger WHERE type IN ('signup','purchase','adjust')) AS ledger_keep,
			(SELECT COUNT(*) FROM matches WHERE blue_participant_id IS NOT NULL
			                              OR score_blue <> 0 OR score_red <> 0
			                              OR state <> 'pending') AS matches_dirty,
			(SELECT COUNT(*) FROM users) AS users`;

	console.log('  ── 將清除 ──');
	console.log(`    盤口              ${fmt(before.markets)}`);
	console.log(`    注單              ${fmt(before.bets)}`);
	console.log(`    帳本（下注相關）  ${fmt(before.ledger_bet)}`);
	if (!KEEP_MATCHES) console.log(`    場次的比分與對戰  ${fmt(before.matches_dirty)} 場`);
	console.log('');
	console.log('  ── 保留 ──');
	console.log(`    使用者            ${fmt(before.users)}`);
	console.log(`    帳本（贈送／周邊／調整） ${fmt(before.ledger_keep)}`);
	console.log('');

	// 清除後每個人的餘額（只算保留的那幾種）
	const after = await sql`
		SELECT u.display_name,
		       COALESCE(SUM(l.amount) FILTER (WHERE l.type IN ('signup','purchase','adjust')), 0) AS balance
		FROM users u LEFT JOIN ledger l ON l.user_id = u.id
		GROUP BY u.id, u.display_name
		ORDER BY balance DESC
		LIMIT 10`;

	console.log('  ── 清除後的餘額（前 10 名）──');
	for (const r of after) console.log(`    ${r.display_name}　${fmt(r.balance)}`);
	if (!after.length) console.log('    （沒有使用者）');
	console.log('');

	if (!APPLY) {
		console.log('  這只是預覽。確認無誤後加上 --apply 才會實際執行。');
		console.log('');
		process.exit(0);
	}

	// ── 備份 ───────────────────────────────────────────────
	// 誤刪的話至少還救得回來。這是正式資料，不留退路太危險。
	if (!NO_BACKUP) {
		const dir = path.join(process.cwd(), 'backups');
		fs.mkdirSync(dir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const file = path.join(dir, `reset-${stamp}.json`);

		const dump = {
			備份時間: new Date().toISOString(),
			資料庫: host,
			markets: await sql`SELECT * FROM markets`,
			bets: await sql`SELECT * FROM bets`,
			ledger: await sql`SELECT * FROM ledger WHERE type IN ('bet','payout','refund')`,
			matches: await sql`SELECT * FROM matches`
		};
		fs.writeFileSync(file, JSON.stringify(dump, null, 2), 'utf8');
		console.log(`  已備份 → ${path.relative(process.cwd(), file)}`);
	}

	// ── 清除 ───────────────────────────────────────────────
	// 順序必須順著外鍵反向走：ledger 參照 bets 與 markets
	await sql.begin(async (tx) => {
		await tx`DELETE FROM ledger WHERE type IN ('bet','payout','refund')`;
		await tx`DELETE FROM bets`;
		await tx`DELETE FROM markets`;

		if (!KEEP_MATCHES) {
			await tx`
				UPDATE matches SET
					blue_participant_id = NULL,
					red_participant_id = NULL,
					score_blue = 0,
					score_red = 0,
					state = 'pending',
					winner_side = NULL`;
		}
	});

	const [now] = await sql`
		SELECT (SELECT COUNT(*) FROM markets) AS markets,
		       (SELECT COUNT(*) FROM bets) AS bets,
		       (SELECT COUNT(*) FROM ledger WHERE type IN ('bet','payout','refund')) AS ledger_bet`;

	console.log('');
	console.log('  ── 完成 ──');
	console.log(`    盤口 ${now.markets}　注單 ${now.bets}　下注帳本 ${now.ledger_bet}`);
	console.log('');
} finally {
	await sql.end({ timeout: 5 });
}
