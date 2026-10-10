/**
 * 應援金額輸入規則的測試。不需要資料庫。
 *
 *   node scripts/test-bet-amount.ts
 */
import assert from 'node:assert/strict';
import { sanitizeStake } from '../src/lib/bet-amount.ts';

let passed = 0;
const t = (name: string, fn: () => void) => {
	fn();
	passed++;
	console.log('  ✓', name);
};

const B = 10000; // 持有 10,000 狗狗幣

console.log('應援金額輸入');

t('一般數字', () => assert.deepEqual(sanitizeStake('1234', B), { text: '1234', value: 1234, clamped: false }));

t('空白視為未輸入，不能應援', () => assert.deepEqual(sanitizeStake('', B), { text: '', value: 0, clamped: false }));

t('小數點不合規則，只取數字', () => assert.equal(sanitizeStake('12.5', B).value, 125));

t('負號會被丟掉，不會出現負數', () => assert.equal(sanitizeStake('-500', B).value, 500));

t('千分位逗號可以貼上', () => assert.equal(sanitizeStake('1,234', B).value, 1234));

t('全形數字也能用（手機中文輸入法）', () => assert.equal(sanitizeStake('１２３４', B).value, 1234));

t('文字與符號一律忽略', () => assert.deepEqual(sanitizeStake('abc', B), { text: '', value: 0, clamped: false }));

t('超過持有量就壓到持有量', () => assert.deepEqual(sanitizeStake('99999', B), { text: '10000', value: 10000, clamped: true }));

t('剛好等於持有量不算被壓', () => assert.deepEqual(sanitizeStake('10000', B), { text: '10000', value: 10000, clamped: false }));

t('開頭多餘的 0 會去掉', () => assert.deepEqual(sanitizeStake('007', B), { text: '7', value: 7, clamped: false }));

t('只打 0 就是 0，不能應援', () => assert.deepEqual(sanitizeStake('0', B), { text: '0', value: 0, clamped: false }));

t('餘額為 0 時打什麼都是 0', () => assert.deepEqual(sanitizeStake('500', 0), { text: '0', value: 0, clamped: true }));

t('長到爆掉的數字不會變成科學記號', () => {
	const r = sanitizeStake('9'.repeat(25), B);
	assert.equal(r.value, B);
	assert.equal(r.text, '10000');
});

t('餘額有小數時以無條件捨去為上限', () => assert.equal(sanitizeStake('99999', 1234.9).value, 1234));

t('餘額是負數時一律 0 —— 訂單取消被收回後會出現這種狀態', () => {
	// 主辦方 10-10：收回與人工扣除可以把餘額扣成負的。
	// 那種帳號完全不能應援，所以輸入什麼都要壓成 0，而且不能回填成 "-5000"。
	const r = sanitizeStake('100', -5000);
	assert.equal(r.value, 0);
	assert.equal(r.text, '0');
	assert.equal(r.clamped, true);
	assert.equal(sanitizeStake('999999', -1).value, 0);
});

console.log(`\n${passed} 項全部通過`);
