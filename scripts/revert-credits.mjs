/**
 * 收回誤發的狗狗幣 —— 針對特定訂單或兌換券。
 *
 *   node scripts/revert-credits.mjs --orders 123,456            先試算（預設不動資料）
 *   node scripts/revert-credits.mjs --orders 123,456 --apply    實際執行，執行前自動備份
 *   node scripts/revert-credits.mjs --codes AAAA-BBBB-CCCC --apply
 *   node scripts/revert-credits.mjs --orders 123 --codes XX --apply --reason "測試資料"
 *
 * 用途：測試期間誤發的幣、來源判定錯誤的訂單（例如把贊助當成周邊購買）。
 *
 * ── 做法 ────────────────────────────────────────────────
 *   訂單：寫一筆相反金額的 adjust 帳目把幣收回，然後刪掉 purchase_orders 那列
 *   兌換券：已兌換的同樣寫 adjust 收回；未兌換的直接刪掉券
 *
 * ⚠️ 刻意「寫一筆相反的帳」而不是刪掉原本的帳目。
 *    帳本是餘額的唯一來源，刪掉歷史就再也查不出「這個人為什麼少了 20,000」。
 *    收回之後紀錄上會看到 +20,000 與 −20,000 兩筆，說得清楚。
 *
 * ⚠️ 餘額不足時會拒絕執行那一筆（幣可能已經被應援出去了），並列出來讓人處理。
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
const ORDERS = (argOf('--orders') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const CODES = (argOf('--codes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const REASON = argOf('--reason') ?? '測試資料，收回誤發的狗狗幣';

if (!ORDERS.length && !CODES.length) {
	console.error('請用 --orders 或 --codes 指定要收回哪些。');
	console.error('例：node scripts/revert-credits.mjs --orders 20260912225824138,20260912225824150');
	process.exit(1);
}

let url = argOf('--url');
if (!url) {
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

const host = (() => {
	try {
		return new URL(url).host;
	} catch {
		return '(無法解析)';
	}
})();

const sql = postgres(url, { max: 1, prepare: false });
const fmt = (n) => Number(n).toLocaleString('en-US');

try {
	console.log(`連線至 ${host}`);
	console.log(APPLY ? '模式：實際執行\n' : '模式：試算（不會變更任何資料）\n');

	const orders = ORDERS.length
		? await sql`SELECT * FROM purchase_orders WHERE order_ref = ANY(${ORDERS})`
		: [];
	const codes = CODES.length ? await sql`SELECT * FROM redeem_codes WHERE code = ANY(${CODES})` : [];

	for (const ref of ORDERS) {
		if (!orders.some((o) => o.order_ref === ref)) console.log(`  ⚠ 找不到訂單 ${ref}`);
	}
	for (const c of CODES) {
		if (!codes.some((x) => x.code === c)) console.log(`  ⚠ 找不到兌換券 ${c}`);
	}

	/** userId → 要扣回的總額 */
	const deduct = new Map();
	const add = (userId, amount, what) => {
		const cur = deduct.get(userId) ?? { amount: 0, items: [] };
		// ⚠️ 一定要 Number()：postgres.js 把 bigint 欄位當字串回傳，
		// 直接相加會變成字串相接（1000 + 20000 → "100020000"），金額會大到離譜
		cur.amount += Number(amount);
		cur.items.push(what);
		deduct.set(userId, cur);
	};

	console.log('訂單');
	for (const o of orders) {
		console.log(`  ${o.platform} ${o.order_ref}　${fmt(o.chips)} 狗狗幣　→ 收回並刪除紀錄`);
		add(o.user_id, o.chips, `訂單 ${o.order_ref}`);
	}
	if (!orders.length) console.log('  （無）');

	console.log('兌換券');
	for (const c of codes) {
		if (c.used_by_user_id) {
			console.log(`  ${c.code}　${fmt(c.amount)} 狗狗幣　已兌換 → 收回並刪除券`);
			add(c.used_by_user_id, c.amount, `兌換券 ${c.code}`);
		} else {
			console.log(`  ${c.code}　${fmt(c.amount)} 狗狗幣　未兌換 → 直接刪除券`);
		}
	}
	if (!codes.length) console.log('  （無）');

	console.log('\n帳號餘額');
	const blocked = [];
	for (const [userId, info] of deduct) {
		const [u] = await sql`SELECT display_name FROM users WHERE id = ${userId}`;
		const [b] = await sql`SELECT COALESCE(SUM(amount),0)::bigint AS bal FROM ledger WHERE user_id = ${userId}`;
		const before = Number(b.bal);
		const after = before - info.amount;
		const ok = after >= 0;
		if (!ok) blocked.push({ userId, name: u?.display_name, before, amount: info.amount });
		console.log(
			`  ${u?.display_name ?? userId}　${fmt(before)} → ${fmt(after)}　(−${fmt(info.amount)}：${info.items.join('、')})` +
				(ok ? '' : '　❌ 餘額不足，跳過')
		);
	}
	if (!deduct.size) console.log('  （沒有需要扣回的）');

	if (!APPLY) {
		console.log('\n以上只是試算。確認無誤後加上 --apply 實際執行。');
		process.exit(0);
	}

	// ── 備份 ────────────────────────────────────────────
	const dir = path.join(process.cwd(), 'backups');
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `revert-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
	fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), host, reason: REASON, orders, codes }, null, 2));
	console.log(`\n已備份到 ${path.relative(process.cwd(), file)}`);

	const skip = new Set(blocked.map((b) => b.userId));
	let reverted = 0;
	let removed = 0;

	await sql.begin(async (tx) => {
		for (const [userId, info] of deduct) {
			if (skip.has(userId)) continue;
			// 先鎖使用者那一列（和 placeBet 一樣的鎖定順序），再算餘額。
			// SUM 這類聚合不能直接加 FOR UPDATE，Postgres 會拒絕。
			await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
			const [b] = await tx`SELECT COALESCE(SUM(amount),0)::bigint AS bal FROM ledger WHERE user_id = ${userId}`;
			const after = Number(b.bal) - info.amount;
			await tx`
				INSERT INTO ledger (user_id, type, amount, balance_after, note)
				VALUES (${userId}, 'adjust', ${-info.amount}, ${after}, ${`${REASON}（${info.items.join('、')}）`})`;
			reverted++;
		}

		for (const o of orders) {
			if (skip.has(o.user_id)) continue;
			await tx`DELETE FROM purchase_orders WHERE id = ${o.id}`;
			removed++;
		}
		for (const c of codes) {
			if (c.used_by_user_id && skip.has(c.used_by_user_id)) continue;
			await tx`DELETE FROM redeem_codes WHERE code = ${c.code}`;
			removed++;
		}
	});

	console.log(`完成：寫入 ${reverted} 筆收回帳目、刪除 ${removed} 筆紀錄。`);
	if (blocked.length) {
		console.log('\n下列帳號餘額不足，沒有處理（幣可能已經被應援出去）：');
		for (const b of blocked) console.log(`  ${b.name}　餘額 ${fmt(b.before)}　需扣 ${fmt(b.amount)}`);
	}
} finally {
	await sql.end();
}
