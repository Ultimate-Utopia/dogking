/**
 * 驗證賽程骨架的晉級關係是否自洽。
 *
 *   node scripts/verify-bracket.mjs          檢查資料庫裡的賽程（完全唯讀）
 *   node scripts/verify-bracket.mjs --seed   檢查 src/lib/data/roster.js，不連資料庫
 *
 * 改賽程時先跑 --seed，確認沒問題再寫進資料庫。可以接住：
 *   ① 指向不存在或更早的場次（打錯編號、造成循環）
 *   ② 兩條晉級路線指進同一個位子（互相覆蓋）
 *   ③ 敗部或決賽有空位沒人會晉級上來（賽程斷點）
 *   ④ 種子位（沒有路線指進去、要由後台指派人的格子）數量不等於參賽人數
 *   ⑤ 勝者線往回走 —— 樹狀圖依輪次排欄位，這種線會畫成往左的箭頭
 */
import fs from 'node:fs';

const fromSeed = process.argv.includes('--seed');

let rows;
let players;

if (fromSeed) {
	const { MATCHES, ROSTER } = await import('../src/lib/data/roster.js');
	rows = MATCHES.map((m) => ({
		order_no: m.orderNo,
		round_label: m.roundLabel,
		bracket: m.bracket,
		round_no: m.roundNo,
		winner_to_match_no: m.winnerTo?.match ?? null,
		winner_to_slot: m.winnerTo?.slot ?? null,
		loser_to_match_no: m.loserTo?.match ?? null,
		loser_to_slot: m.loserTo?.slot ?? null
	}));
	players = ROSTER.filter((r) => r.role === 'player').length;
	console.log('來源：src/lib/data/roster.js');
} else {
	const { default: postgres } = await import('postgres');
	const url = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\n\r]+)/m)[1];
	const sql = postgres(url, { max: 1, prepare: false });
	rows = await sql`
		SELECT order_no, round_label, bracket, round_no,
		       winner_to_match_no, winner_to_slot, loser_to_match_no, loser_to_slot
		FROM matches ORDER BY order_no`;
	[{ players }] = await sql`SELECT COUNT(*)::int AS players FROM participants WHERE role = 'player'`;
	await sql.end();
	console.log(`來源：資料庫 ${new URL(url).host}`);
}

const byNo = new Map(rows.map((r) => [r.order_no, r]));
const problems = [];
/** "場次.側" -> 有幾條路線指進來 */
const incoming = new Map();

/** 欄位＝輪次；決賽排在所有分組之後。與 board.ts 的版面算法一致。 */
const lastRound = Math.max(0, ...rows.filter((r) => r.bracket !== 'final').map((r) => r.round_no));
const colOf = (r) => (r.bracket === 'final' ? lastRound + r.round_no - 1 : r.round_no - 1);

const edge = (from, to, slot, kind) => {
	if (to === null) return;
	const target = byNo.get(to);
	if (!target) {
		problems.push(`場次 ${from} 的${kind}指向不存在的場次 ${to}`);
		return;
	}
	if (to <= from) problems.push(`場次 ${from} 的${kind}指向較早的場次 ${to}（會造成循環）`);
	if (slot !== 'blue' && slot !== 'red') {
		problems.push(`場次 ${from} 的${kind}沒有指定有效的一側`);
		return;
	}
	if (kind === '勝者流向' && colOf(target) <= colOf(byNo.get(from))) {
		problems.push(`場次 ${from} 的勝者流向場次 ${to}，但 ${to} 的輪次沒有比較後面（樹狀圖會畫成往回指）`);
	}
	const k = `${to}.${slot}`;
	incoming.set(k, (incoming.get(k) ?? 0) + 1);
};

for (const r of rows) {
	edge(r.order_no, r.winner_to_match_no, r.winner_to_slot, '勝者流向');
	edge(r.order_no, r.loser_to_match_no, r.loser_to_slot, '敗者流向');
}

for (const [k, n] of incoming) if (n > 1) problems.push(`${k} 有 ${n} 條晉級路線指進來（互相覆蓋）`);

const seeds = [];
for (const r of rows) {
	for (const side of ['blue', 'red']) {
		if (incoming.has(`${r.order_no}.${side}`)) continue;
		const label = `M${r.order_no}${side === 'blue' ? '藍' : '紅'}`;
		// 勝部的空位是種子位，由後台指派；敗部與決賽的空位代表賽程斷了
		if (r.bracket === 'winners') seeds.push(label);
		else problems.push(`場次 ${r.order_no}（${r.round_label}）的${side === 'blue' ? '藍' : '紅'}方沒有任何晉級路線填入`);
	}
}

if (seeds.length !== players) {
	problems.push(`種子位有 ${seeds.length} 個（${seeds.join('、')}），但參賽者有 ${players} 位`);
}

console.log(`場次數：${rows.length} 場（勝部 ${rows.filter((r) => r.bracket === 'winners').length}、敗部 ${rows.filter((r) => r.bracket === 'losers').length}、決賽 ${rows.filter((r) => r.bracket === 'final').length}）`);
console.log(`種子位：${seeds.length} 個 → ${seeds.join('、')}`);
console.log(`參賽者：${players} 位`);

if (problems.length) {
	console.log('\n❌ 發現問題：');
	for (const p of problems) console.log('  ・' + p);
	process.exit(1);
}
console.log('\n✅ 晉級關係自洽：沒有斷點、沒有覆蓋、沒有循環，種子位與人數相符。');
