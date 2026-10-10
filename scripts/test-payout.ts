/**
 * 發放計算的測試 —— 特別是大數字下的精確度。不需要資料庫。
 *
 *   node scripts/test-payout.ts
 *
 * 為什麼需要：amount × poolTotal 這個中間值很容易超過 JavaScript 的安全整數上限，
 * 超過之後結果會差個一兩塊。這次活動 NT$1 = 100 狗狗幣，很容易到那個量級。
 */
import assert from 'node:assert/strict';
import { calcPayout, calcOdds } from '../src/lib/payout.ts';

let passed = 0;
const t = (name: string, fn: () => void) => {
	fn();
	passed++;
	console.log('  ✓', name);
};

console.log('發放計算');

t('一般情況：應援獲勝方的人依比例分整個獎池', () => {
	// 自己投入 100，獲勝方共 400，總池 1000 → 100/400 × 1000 = 250
	assert.equal(calcPayout(100, 400, 1000), 250);
});

t('無條件捨去，餘數留在系統', () => {
	// 100/300 × 1000 = 333.33…
	assert.equal(calcPayout(100, 300, 1000), 333);
});

t('獲勝方只有自己 → 整個獎池拿回', () => assert.equal(calcPayout(500, 500, 1800), 1800));

t('獲勝方獎池為 0 → 不分配（整池由系統回收，不退還觀眾）', () => {
	// 主辦方 2026-10-09 的規則：沒有人應援獲勝方時，這一池不分給任何人。
	// settleMarket 不需要特別處理 —— 池是 0 就代表沒有人押那一邊，
	// 每一筆都會被標成輸，這裡只確認換算本身不會算出錢來。
	assert.equal(calcPayout(100, 0, 1000), 0);
	assert.equal(calcPayout(1_000_000, 0, 1_000_000), 0);
});

t('沒有人應援另一邊 → 原額拿回，不多不少', () => assert.equal(calcPayout(700, 700, 700), 700));

console.log('大數字');

t('獲勝方只有一人、獎池上億也要整個拿回（浮點數會少 1）', () => {
	// 這三組是實際找出來、用浮點數會算錯的case
	assert.equal(calcPayout(939_109_593, 939_109_593, 1_391_788_482), 1_391_788_482);
	assert.equal(calcPayout(884_823_019, 884_823_019, 1_797_218_238), 1_797_218_238);
	assert.equal(calcPayout(374_795_569, 374_795_569, 530_117_868), 530_117_868);
});

t('與精確計算逐筆相符（隨機 5 萬組，獎池量級到十億）', () => {
	const exact = (a: number, w: number, tot: number) => Number((BigInt(a) * BigInt(tot)) / BigInt(w));
	for (let i = 0; i < 50_000; i++) {
		const w = Math.floor(Math.random() * 1e9) + 1;
		const lose = Math.floor(Math.random() * 1e9);
		const a = Math.floor(Math.random() * w) + 1;
		assert.equal(calcPayout(a, w, w + lose), exact(a, w, w + lose));
	}
});

t('派出去的總額不會超過獎池', () => {
	// 三個人應援同一邊，分完的總和必須 ≤ 總獎池
	const bets = [333_333_333, 111_111_111, 555_555_555];
	const w = bets.reduce((a, b) => a + b, 0);
	const tot = w + 987_654_321;
	const paid = bets.reduce((sum, b) => sum + calcPayout(b, w, tot), 0);
	assert.ok(paid <= tot, `派出 ${paid} 超過獎池 ${tot}`);
	// 捨去造成的餘數不該大於人數
	assert.ok(tot - paid < bets.length, `餘數 ${tot - paid} 太大`);
});

console.log('分配倍率顯示');

t('某一邊沒有人應援時不顯示分配倍率', () => {
	const odds = calcOdds(0, 500);
	assert.equal(odds.blue, null);
	assert.equal(odds.red, 1);
	assert.equal(odds.total, 500);
});

console.log('小額應援');

t('押中的人永遠至少拿回本金 —— 1 枚也不會變成 0', () => {
	// 主辦方 10-10 問：只投入 1 枚、猜對了，有沒有可能分到 0？
	// 不可能。總獎池 ≥ 獲勝方獎池，所以 1 × 總池 ÷ 贏方池 ≥ 1，無條件捨去後仍 ≥ 1。
	assert.equal(calcPayout(1, 300, 301), 1); // 輸方只有 1 枚 → 只拿回本金，沒賺
	assert.equal(calcPayout(1, 1, 2), 2); // 兩邊各 1 枚 → 拿回 2
	assert.equal(calcPayout(1, 100, 10_000), 100);
	assert.equal(calcPayout(1, 1, 1), 1); // 沒有人押另一邊
});

t('無條件捨去只會吃掉「賺的部分」，不會吃掉本金', () => {
	// 隨機抽一萬組，確認派發金額永遠 ≥ 投入金額
	let worst = Infinity;
	for (let i = 0; i < 10_000; i++) {
		const amount = 1 + Math.floor(Math.random() * 50);
		const winner = amount + Math.floor(Math.random() * 100_000);
		const total = winner + Math.floor(Math.random() * 100_000);
		const payout = calcPayout(amount, winner, total);
		assert.ok(payout >= amount, `投入 ${amount} 卻只拿回 ${payout}`);
		worst = Math.min(worst, payout - amount);
	}
	// 最糟的情況就是不賺不賠，不會倒賠
	assert.equal(worst, 0);
});

console.log(`\n${passed} 項全部通過`);
