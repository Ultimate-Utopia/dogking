/**
 * 訂單匯出檔解析的測試。不需要資料庫。
 *
 *   node scripts/test-order-formats.ts
 *   node scripts/test-order-formats.ts <匯出檔.csv 或 .xlsx>   另外對一份真實檔案跑一次，只印統計、不印內容
 *
 * 測試資料是依真實賣貨便匯出檔的「結構」捏造的，裡面沒有任何真實個資。
 * 真實檔案含買家姓名與取件門市，不要放進版控。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readXlsx } from '../src/lib/xlsx.ts';
import {
	parseCsv,
	extractCode,
	detectFormat,
	parseMyship,
	parseEcpay,
	parseByColumns,
	stripUnusedColumns
} from '../src/lib/order-formats.ts';

// ── 依賣貨便匯出檔的欄位結構做一份假資料 ─────────────────
const HEADER = [
	'賣場類型', '賣場名稱', '溫層', '訂購日期', '訂單編號', '狀態', '已取件日期時間', '收件人姓名',
	'配送單編號', '付款方式', '配送方式', '取件地址', '商品名稱\n(品名/規格)', '單價', '優惠價', '數量',
	'小計\n(A)', '運費\n(B)', '使用賣家折價券抵扣(C)', '使用平台運費券折抵(D)', '使用平台折價券折抵(E)',
	'商品總額\n(A+B-C-D-E)', '配送數量', '回饋資訊1', '回饋資訊2', '回饋資訊3', '回饋資訊4', '回饋資訊5', '訂單備註'
];

type Order = {
	ref: string;
	status: string;
	pay: string;
	items: number[];
	ship?: number;
	shipCoupon?: number;
	feedback?: string[];
	note?: string;
};

function makeCsv(orders: Order[]): string {
	const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
	const lines = [
		// 第 1 列是篩選條件，不是標題
		['訂購日期：2026/09/01~2026/09/30', '', '賣場類型：一般賣場'].concat(Array(26).fill('')).map(q).join(','),
		HEADER.map(q).join(',')
	];
	for (const o of orders) {
		const ship = o.ship ?? 60;
		const coupon = o.shipCoupon ?? 0;
		const total = o.items.reduce((a, b) => a + b, 0) + ship - coupon;
		o.items.forEach((price, idx) => {
			const cells = Array(29).fill('');
			cells[12] = `測試商品${idx + 1}`;
			cells[13] = price;
			cells[14] = price;
			cells[15] = 1;
			cells[16] = price.toLocaleString('en-US');
			if (idx === 0) {
				cells[0] = '一般賣場';
				cells[4] = o.ref;
				cells[5] = o.status;
				cells[9] = o.pay;
				cells[17] = ship;
				cells[18] = 0;
				cells[19] = coupon;
				cells[20] = 0;
				cells[21] = total.toLocaleString('en-US');
				(o.feedback ?? []).forEach((f, k) => (cells[23 + k] = f));
				cells[28] = o.note ?? '';
			}
			lines.push(cells.map(q).join(','));
		});
	}
	return lines.join('\r\n');
}

const orders: Order[] = [
	// 信用卡已付款，備註碼填在回饋資訊的專屬問題裡
	{ ref: 'CM0000000000001', status: '付款完成\n(09/10 20:31)', pay: '信用卡', items: [890, 390], feedback: ['聊天室名稱：小明', '狗狗幣備註碼：k7m2qx'] },
	// 取貨付款已取件，備註碼寫在訂單備註（沒有專屬問題時的退路）
	{ ref: 'CM0000000000002', status: '已取件\n(09/12 15:56)', pay: '取貨付款', items: [1200], note: '我的代碼 P4TR9N 謝謝' },
	// 已送達但還沒取件付款 → 不能發
	{ ref: 'CM0000000000003', status: '已送達\n(09/12 07:03)', pay: '取貨付款\n(尚未付款)', items: [500], note: 'H8WQ3Z' },
	// 訂單成立、取貨付款未付 → 不能發
	{ ref: 'CM0000000000004', status: '訂單成立\n(09/11 12:40)', pay: '取貨付款\n(尚未付款)', items: [300] },
	// 被合併進別張訂單 → 不能發（金額算在合併後的那張）
	{ ref: 'CM0000000000005', status: '已合併\n(09/11 12:40)\n併入：CM0000000000009', pay: '取貨付款\n(尚未付款)', items: [300], note: 'R5TY7U' },
	// 取消 → 不能發
	{ ref: 'CM0000000000006', status: '取消訂單\n(09/11 10:36)', pay: '信用卡\n(尚未付款)', items: [300] },
	// 暱稱剛好是 6 個合法字母，而且沒有專屬問題 → 不能被當成備註碼
	{ ref: 'CM0000000000007', status: '付款完成\n(09/13 03:22)', pay: '信用卡', items: [450], feedback: ['聊天室名稱：MYNAME'] },
	// 平台運費券折抵運費：計幣金額仍應是商品金額
	{ ref: 'CM0000000000008', status: '付款完成\n(09/13 06:40)', pay: '信用卡', items: [2000], ship: 60, shipCoupon: 60, feedback: ['狗狗幣備註碼：W2E3R4'] }
];

const rows = parseCsv(makeCsv(orders));
let passed = 0;
const t = (name: string, fn: () => void) => {
	fn();
	passed++;
	console.log('  ✓', name);
};

console.log('賣貨便格式');

t('認得出賣貨便格式（標題在第 2 列）', () => assert.equal(detectFormat(rows), 'myship'));

const parsed = parseMyship(rows);
const by = (ref: string) => parsed.find((p) => p.orderRef === ref)!;

t('一張訂單佔多列時只算一次', () => assert.equal(parsed.length, orders.length));

t('計幣金額不含運費、多個商品要加總', () => {
	assert.equal(by('CM0000000000001').amountTwd, 1280);
	assert.equal(by('CM0000000000001').totalTwd, 1340);
});

t('平台運費券抵掉的是運費，不影響計幣金額', () => {
	assert.equal(by('CM0000000000008').totalTwd, 2000);
	assert.equal(by('CM0000000000008').amountTwd, 2000);
});

t('已付款的訂單可以發', () => {
	assert.equal(by('CM0000000000001').block, null);
	assert.equal(by('CM0000000000002').block, null);
});

t('「已送達」但付款方式標尚未付款 → 不能發', () => assert.equal(by('CM0000000000003').block, 'not-paid'));
t('訂單成立未付款 → 不能發', () => assert.equal(by('CM0000000000004').block, 'not-paid'));
t('已合併 → 不能發（避免重複）', () => assert.equal(by('CM0000000000005').block, 'merged'));
t('取消訂單 → 不能發', () => assert.equal(by('CM0000000000006').block, 'cancelled'));

t('備註碼從回饋資訊的專屬問題抓，大小寫不拘', () => assert.equal(by('CM0000000000001').code, 'K7M2QX'));
t('沒有專屬問題時退回訂單備註', () => assert.equal(by('CM0000000000002').code, 'P4TR9N'));
t('暱稱欄位裡長得像備註碼的字不會被抓走', () => assert.equal(by('CM0000000000007').code, null));
t('狀態只留第一行', () => assert.equal(by('CM0000000000005').statusText, '已合併'));

console.log('綠界格式（商店訂單明細）');

// 依 09-21 主辦方提供的綠界商店「訂單明細」結構捏造，個資欄位一律用假值
const ECPAY_HEADER = ['訂單編號', '訂單日期', '訂單狀態', '賣場名稱', '付款方式', '虛擬帳號', '付款日期', '運費', '訂單總金額', '付款人姓名', '付款人手機', '付款人Email', '買家備註', '收件人姓名', '收件人手機', '收件人Email', '收件人地址'];
const ecpayRow = (ref: string, status: string, pay: string, paidAt: string, ship: string, total: string, note: string) =>
	[ref, '2026-09-21 20:00:00', status, '狗王周邊-測試', pay, '', paidAt, ship, total, '測試甲', '0900000000', 'a@example.com', note, '測試乙', '0900000001', 'b@example.com', '100 測試地址'];

const ecpayRows = [
	ECPAY_HEADER,
	// 超商取貨付款、待出貨、沒有付款日期 → 還沒付錢（真實檔案三張都是這樣）
	ecpayRow('10000001', '待出貨', '7-ELEVEN超商取貨付款', '', '65', '1415', 'K7M2QX'),
	// 信用卡已付款：有付款日期
	ecpayRow('10000002', '待出貨', '信用卡', '2026-09-21 20:05:00', '65', '1265', '我的代碼 P4TR9N 謝謝'),
	// 取貨付款、買家已取件付款
	ecpayRow('10000003', '已完成', '全家超商取貨付款', '2026-09-23 18:00:00', '65', '1215', ''),
	// 已取消（即使有付款日期也不發）
	ecpayRow('10000004', '已取消', '信用卡', '2026-09-21 20:10:00', '65', '565', 'W2E3R4'),
	// 退貨
	ecpayRow('10000005', '退貨完成', '信用卡', '2026-09-21 20:10:00', '65', '565', 'H8WQ3Z')
];

const ecpay = parseEcpay(ecpayRows);
const eBy = (ref: string) => ecpay.find((p) => p.orderRef === ref)!;

t('認得出綠界商店格式', () => assert.equal(detectFormat(ecpayRows), 'ecpay'));
t('一張訂單一列', () => assert.equal(ecpay.length, 5));
t('狗狗幣金額要扣掉運費', () => {
	assert.equal(eBy('10000001').totalTwd, 1415);
	assert.equal(eBy('10000001').amountTwd, 1350);
});
t('沒有付款日期 → 尚未付款（即使狀態是「待出貨」）', () => assert.equal(eBy('10000001').block, 'not-paid'));
t('有付款日期 → 可以發', () => {
	assert.equal(eBy('10000002').block, null);
	assert.equal(eBy('10000003').block, null);
});
t('已取消、退貨 → 不能發，即使有付款日期', () => {
	assert.equal(eBy('10000004').block, 'cancelled');
	assert.equal(eBy('10000005').block, 'cancelled');
});
t('代碼從買家備註抓，夾在句子裡也抓得到', () => {
	assert.equal(eBy('10000001').code, 'K7M2QX');
	assert.equal(eBy('10000002').code, 'P4TR9N');
	assert.equal(eBy('10000003').code, null);
});

t('上傳前會拿掉姓名、手機、Email、地址', () => {
	const stripped = stripUnusedColumns(ecpayRows);
	const all = stripped.flat().join('|');
	assert.ok(!all.includes('測試甲') && !all.includes('0900000000') && !all.includes('a@example.com') && !all.includes('測試地址'));
	// 拿掉之後仍然解析得出一模一樣的結果
	assert.deepEqual(parseEcpay(stripped), ecpay);
});

t('綠界贊助頁的匯出檔會被認出來（之後拒收）', () => {
	const donation = [
		['訂單日期', '訂單編號', '商品名稱', '贊助者留言', '付款人', '付款方式', '交易金額', '付款狀態'],
		['2026/09/12 22:58:24', '20260912225824138', '實況主贊助', 'JDDTN4', '-', '信用卡', '10', '已付款']
	];
	assert.equal(detectFormat(donation), 'ecpay-donation');
	assert.equal(parseEcpay(donation).length, 0);
});

t('賣貨便檔拿掉欄位後結果不變', () => {
	assert.deepEqual(parseMyship(stripUnusedColumns(rows)), parsed);
});

console.log('其他格式');

t('一般 CSV 不會被誤認成賣貨便', () =>
	assert.equal(detectFormat(parseCsv('訂單編號,金額,備註\nA1,300,K7M2QX')), 'columns'));

t('手動欄位：金額可含千分位', () => {
	const g = parseByColumns(parseCsv('訂單編號,金額,備註\nA1,"1,280",代碼K7M2QX'), { orderRef: 0, amount: 1, note: 2 }, true);
	assert.equal(g[0].amountTwd, 1280);
	assert.equal(g[0].code, 'K7M2QX');
	assert.equal(g[0].block, null);
});

t('extractCode 不吃 7 碼以上的連續字元', () => assert.equal(extractCode('載具/ABC23456'), null));

console.log(`\n${passed} 項全部通過`);

// ── 選用：對真實檔案跑一次，只印統計 ─────────────────────
const real = process.argv[2];
if (real) {
	const realRows = /\.xlsx$/i.test(real) ? await readXlsx(fs.readFileSync(real)) : parseCsv(fs.readFileSync(real, 'utf8'));
	const format = detectFormat(realRows);
	const res = format === 'ecpay' ? parseEcpay(realRows) : parseMyship(realRows);
	const count = (k: string | null) => res.filter((r) => r.block === k).length;
	console.log(`\n真實檔案：格式 ${detectFormat(realRows)}，訂單 ${res.length} 張`);
	console.log(`  可發放候選（已付款）${count(null)}、未付款 ${count('not-paid')}、已合併 ${count('merged')}、取消 ${count('cancelled')}`);
	console.log(`  金額無法解析 ${res.filter((r) => !Number.isFinite(r.amountTwd)).length} 張`);
	console.log(`  抓到備註碼樣式 ${res.filter((r) => r.code).length} 張`);
}
