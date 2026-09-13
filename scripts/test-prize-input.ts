/**
 * 獎品表單與圖片檢查的測試。不需要資料庫。
 *
 *   node scripts/test-prize-input.ts
 */
import assert from 'node:assert/strict';
import {
	decodeImageDataUrl,
	parsePrizeInput,
	sniffImageType,
	PrizeInputError,
	MAX_IMAGE_BYTES
} from '../src/lib/server/prize-image.ts';

let passed = 0;
const t = (name: string, fn: () => void) => {
	fn();
	passed++;
	console.log('  ✓', name);
};
const dataUrl = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

// 各格式的檔頭（後面補一些內容）
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

console.log('圖片');

t('認得 PNG／JPEG／WebP 的檔頭', () => {
	assert.equal(sniffImageType(PNG), 'image/png');
	assert.equal(sniffImageType(JPEG), 'image/jpeg');
	assert.equal(sniffImageType(WEBP), 'image/webp');
});

t('SVG 一律拒絕', () => assert.throws(() => decodeImageDataUrl(dataUrl('image/svg+xml', SVG)), PrizeInputError));

t('宣稱是 PNG 但內容是 SVG → 拒絕（看內容不看宣稱）', () =>
	assert.throws(() => decodeImageDataUrl(dataUrl('image/png', SVG)), PrizeInputError));

t('宣稱類型與內容不同時，以內容為準', () => assert.equal(decodeImageDataUrl(dataUrl('image/png', JPEG)).type, 'image/jpeg'));

t('超過大小上限 → 拒絕', () => {
	const big = new Uint8Array(MAX_IMAGE_BYTES + 1024);
	big.set(PNG);
	assert.throws(() => decodeImageDataUrl(dataUrl('image/png', big)), /太大/);
});

t('不是 data URL → 拒絕', () => assert.throws(() => decodeImageDataUrl('https://example.com/a.png'), PrizeInputError));

t('同一張圖版本號相同，換圖版本號不同', () => {
	const a = decodeImageDataUrl(dataUrl('image/png', PNG)).version;
	assert.equal(decodeImageDataUrl(dataUrl('image/png', PNG)).version, a);
	assert.notEqual(decodeImageDataUrl(dataUrl('image/jpeg', JPEG)).version, a);
});

console.log('表單');

t('特色一行一項，空行與前後空白略過', () => {
	const p = parsePrizeInput({ name: ' 愛心水晶王座 ', ranksLabel: '持有狗狗幣前三名', sortOrder: '1', features: '可指定印刷的狗狗\r\n\r\n  含親簽 \n客製化 ID\n' });
	assert.deepEqual(p, { name: '愛心水晶王座', ranksLabel: '持有狗狗幣前三名', sortOrder: 1, features: ['可指定印刷的狗狗', '含親簽', '客製化 ID'] });
});

t('品名與名次必填', () => {
	assert.throws(() => parsePrizeInput({ name: '', ranksLabel: '第 1 名' }), /品名/);
	assert.throws(() => parsePrizeInput({ name: '王座', ranksLabel: '  ' }), /適用名次/);
});

t('顯示順序空白視為 0，非整數拒絕', () => {
	assert.equal(parsePrizeInput({ name: '王座', ranksLabel: '第 1 名', sortOrder: '' }).sortOrder, 0);
	assert.throws(() => parsePrizeInput({ name: '王座', ranksLabel: '第 1 名', sortOrder: '1.5' }), /整數/);
});

t('特色超過 8 項或單項太長 → 拒絕', () => {
	assert.throws(() => parsePrizeInput({ name: '王座', ranksLabel: '第 1 名', features: Array(9).fill('x').join('\n') }), /8 項/);
	assert.throws(() => parsePrizeInput({ name: '王座', ranksLabel: '第 1 名', features: 'x'.repeat(31) }), /30 字/);
});

console.log(`\n${passed} 項全部通過`);
