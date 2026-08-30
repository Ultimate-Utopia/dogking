/**
 * 驗證賽程骨架的晉級關係是否自洽。
 *
 *   node scripts/verify-bracket.mjs
 *
 * 完全唯讀，對正式資料庫跑也安全。
 * 改過賽程（MATCHES 或後台）之後跑一次，可以接住三種錯：
 *   ① 指向不存在或更早的場次（打錯編號、造成循環）
 *   ② 兩條晉級路線指進同一個位子（互相覆蓋）
 *   ③ 某場的某一側沒人會晉級上來（賽程斷點）
 */
import fs from 'node:fs';
import postgres from 'postgres';

const url = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\n\r]+)/m)[1];
const sql = postgres(url, { max: 1, prepare: false });

const rows = await sql`
  SELECT order_no, round_label, bracket, round_no,
         winner_to_match_no, winner_to_slot, loser_to_match_no, loser_to_slot
  FROM matches ORDER BY order_no`;
await sql.end();

const byNo = new Map(rows.map((r) => [r.order_no, r]));
const problems = [];
/** slotKey -> 有幾條邊指進來 */
const incoming = new Map();

const edge = (from, to, slot, kind) => {
  if (to === null) return;
  if (!byNo.has(to)) { problems.push(`場次 ${from} 的${kind}指向不存在的場次 ${to}`); return; }
  if (to <= from) problems.push(`場次 ${from} 的${kind}指向較早的場次 ${to}（會造成循環）`);
  if (slot !== 'blue' && slot !== 'red') { problems.push(`場次 ${from} 的${kind}沒有指定有效的一側`); return; }
  const k = `${to}.${slot}`;
  incoming.set(k, (incoming.get(k) ?? 0) + 1);
};

for (const r of rows) {
  edge(r.order_no, r.winner_to_match_no, r.winner_to_slot, '勝者流向');
  edge(r.order_no, r.loser_to_match_no, r.loser_to_slot, '敗者流向');
}

for (const [k, n] of incoming) if (n > 1) problems.push(`${k} 有 ${n} 條晉級路線指進來（互相覆蓋）`);

// 除了勝部第一輪與加賽以外，每一場的兩側都該正好有一條路線指進來
for (const r of rows) {
  const firstRound = r.bracket === 'winners' && r.round_no === 1;
  const extra = r.bracket === 'final' && r.round_no === 2;
  if (firstRound || extra) continue;
  for (const side of ['blue', 'red']) {
    if (!incoming.has(`${r.order_no}.${side}`))
      problems.push(`場次 ${r.order_no}（${r.round_label}）的${side === 'blue' ? '藍' : '紅'}方沒有任何晉級路線填入`);
  }
}

// 雙敗淘汰：每人要輸兩次。14 場 = 14 敗，8 人中 7 人被淘汰(14敗)、冠軍最多輸 0 或 1
const main = rows.filter((r) => !(r.bracket === 'final' && r.round_no === 2));
console.log(`場次數：${main.length} 場（+ ${rows.length - main.length} 場條件加賽）`);
console.log(`勝部 ${main.filter(r=>r.bracket==='winners').length}、敗部 ${main.filter(r=>r.bracket==='losers').length}、決賽 ${main.filter(r=>r.bracket==='final').length}`);

if (problems.length) {
  console.log('\n❌ 發現問題：');
  for (const p of problems) console.log('  ・' + p);
  process.exit(1);
}
console.log('\n✅ 晉級關係自洽：沒有斷點、沒有覆蓋、沒有循環。');
