/**
 * 訂單匯出檔解析的測試。不需要資料庫。
 *
 *   node scripts/test-order-formats.ts
 *   node scripts/test-order-formats.ts <匯出檔.csv 或 .xlsx> [賣場名稱]   另外對一份真實檔案跑一次，只印統計、不印內容
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
	ecpayShops,
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

// 依 09-23 主辦方提供的匯出檔結構捏造。欄位順序刻意與 09-21 那份不同 ——
// 解析一律用欄位名稱找欄，換版本不該壞。個資欄位一律用假值。
const ECPAY_HEADER = ['訂單日期', '訂單編號', '訂單狀態', '賣場名稱', '商品', '運費', '訂單總金額', '付款人姓名', '付款人手機', '付款人Email', '付款日期', '付款方式', '收件人姓名', '收件人手機', '收件人地址', '買家備註'];
const ecpayRow = (ref: string, status: string, shop: string, ship: string, total: string, paidAt: string, pay: string, note: string) =>
	['2026-09-23 12:00:00', ref, status, shop, '狗狗吊飾', ship, total, '假名甲', '0900000000', 'a@example.com', paidAt, pay, '假名乙', '0900000001', '100 假地址', note];

const SHOP = '終焉狗王大賽周邊';
const ecpayRows = [
	ECPAY_HEADER,
	// 待出貨 + 信用卡：主辦方明確要求視為已付款
	ecpayRow('11349648', '待出貨', SHOP, '65', '1415', '', '信用卡一次付清', 'K7M2QX'),
	// 已出貨 + 信用卡：也早就付過了，同樣要發（主辦方原話只提「待出貨」）
	ecpayRow('11340296', '已出貨', SHOP, '65', '1265', '2026-09-22 10:00:00', '信用卡一次付清', '我的代碼 P4TR9N'),
	// 超商取貨付款：這份報表看不出有沒有收到錢 —— 即使已出貨也不發
	ecpayRow('11334582', '已出貨', SHOP, '65', '1215', '', '7-ELEVEN超商取貨付款', 'W2E3R4'),
	ecpayRow('11288966', '待出貨', SHOP, '65', '765', '', '全家超商取貨付款', ''),
	// 已取消：即使是信用卡也不發
	ecpayRow('10846939', '已取消', SHOP, '65', '815', '', '信用卡一次付清', 'H8WQ3Z'),
	// 運費 0
	ecpayRow('10829378', '待出貨', SHOP, '0', '900', '', '信用卡一次付清', 'R5TY7U'),
	// 運費空白
	ecpayRow('10829377', '待出貨', SHOP, '', '500', '', '信用卡一次付清', ''),
	// 其他賣場：匯出時會一起下載，要整筆略過
	ecpayRow('99999999', '待出貨', '語風薯薯撿到貓-魔王城商品部', '65', '9999', '', '信用卡一次付清', 'K7M2QX')
];

const ecpay = parseEcpay(ecpayRows, SHOP);
const eBy = (ref: string) => ecpay.find((p) => p.orderRef === ref)!;

t('認得出綠界商店格式（欄位順序不同也認得）', () => assert.equal(detectFormat(ecpayRows), 'ecpay'));

t('只留賽事賣場的訂單', () => {
	assert.equal(ecpay.length, 7);
	assert.equal(ecpay.find((p) => p.orderRef === '99999999'), undefined);
});

t('狗狗幣金額＝訂單總金額 − 運費', () => {
	assert.equal(eBy('11349648').totalTwd, 1415);
	assert.equal(eBy('11349648').amountTwd, 1350);
});

t('運費 0 或空白都當 0，不會算成 NaN', () => {
	assert.equal(eBy('10829378').amountTwd, 900);
	assert.equal(eBy('10829377').amountTwd, 500);
});

t('待出貨 + 信用卡 → 視為已付款，可以發', () => assert.equal(eBy('11349648').block, null));
t('已出貨 + 信用卡 → 也可以發（出貨代表更晚的階段）', () => assert.equal(eBy('11340296').block, null));
t('超商取貨付款 → 不發，即使已出貨', () => {
	assert.equal(eBy('11334582').block, 'not-paid');
	assert.equal(eBy('11288966').block, 'not-paid');
});
t('已取消 → 不發，即使是信用卡', () => assert.equal(eBy('10846939').block, 'cancelled'));

t('狀態會寫出付款方式，操作員才知道為什麼不能發', () =>
	assert.equal(eBy('11334582').statusText, '已出貨・7-ELEVEN超商取貨付款'));

t('代碼從買家備註抓，夾在句子裡也抓得到', () => {
	assert.equal(eBy('11349648').code, 'K7M2QX');
	assert.equal(eBy('11340296').code, 'P4TR9N');
	assert.equal(eBy('11288966').code, null);
});

t('列出檔案裡的賣場與筆數', () => {
	assert.deepEqual(ecpayShops(ecpayRows), [
		{ name: SHOP, count: 7 },
		{ name: '語風薯薯撿到貓-魔王城商品部', count: 1 }
	]);
});

t('上傳前會拿掉姓名、手機、Email、地址', () => {
	const stripped = stripUnusedColumns(ecpayRows);
	const all = stripped.flat().join('|');
	assert.ok(!all.includes('假名甲') && !all.includes('0900000000') && !all.includes('a@example.com') && !all.includes('假地址'));
	// 拿掉之後仍然解析得出一模一樣的結果（賣場名稱要留著才濾得掉別的賣場）
	assert.deepEqual(parseEcpay(stripped, SHOP), ecpay);
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
	const res = format === 'ecpay' ? parseEcpay(realRows, process.argv[3] ?? '') : parseMyship(realRows);
	const count = (k: string | null) => res.filter((r) => r.block === k).length;
	console.log(`\n真實檔案：格式 ${detectFormat(realRows)}，訂單 ${res.length} 張`);
	console.log(`  可發放候選（已付款）${count(null)}、未付款 ${count('not-paid')}、已合併 ${count('merged')}、取消 ${count('cancelled')}`);
	console.log(`  金額無法解析 ${res.filter((r) => !Number.isFinite(r.amountTwd)).length} 張`);
	console.log(`  抓到備註碼樣式 ${res.filter((r) => r.code).length} 張`);
}
