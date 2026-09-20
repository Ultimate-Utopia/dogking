/**
 * 訂單匯出檔的解析 —— 把各平台的 CSV 轉成同一種「訂單」形狀。
 *
 * 刻意不引用資料庫或任何其他模組：這裡只有純函式，
 * 可以直接用 node 跑測試（scripts/test-order-formats.ts），不需要連線。
 * 對帳號、查重複、發幣都在 purchase.ts。
 */

/** 排除 0/O/1/I/L —— 手寫或口述時最容易看錯的幾個。訂單備註碼只會用這些字元。 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 為什麼這筆訂單不能發幣。null 代表可以（還要再看有沒有對到帳號）。 */
export type OrderBlock = 'not-paid' | 'cancelled' | 'merged' | null;

export interface ParsedOrder {
	orderRef: string;
	/** 計算狗狗幣用的金額（新台幣）。賣貨便為「不含運費」，見 parseMyship。 */
	amountTwd: number;
	/** 買家實付總額，只用來顯示給操作員對照。沒有這個資訊的格式與 amountTwd 相同。 */
	totalTwd: number;
	/** 找到備註碼的那一格原文，給操作員看是從哪裡抓的 */
	rawCode: string;
	code: string | null;
	block: OrderBlock;
	/** 平台上的狀態原文（去掉時間），例如「付款完成」 */
	statusText: string;
}

export type OrderFormat = 'myship' | 'ecpay' | 'columns';

// ─────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────

/**
 * 極簡 CSV 解析：支援雙引號包住的欄位、欄位內的逗號與換行、跳脫的雙引號。
 *
 * 刻意自己寫而不裝套件 —— 只有後台一個地方用得到。
 * 賣貨便的標題列本身就含換行（「商品名稱⏎(品名/規格)」），靠引號處理。
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	// 去掉 Excel 匯出常見的 BOM
	const src = text.replace(/^﻿/, '');

	for (let i = 0; i < src.length; i++) {
		const ch = src[i];

		if (inQuotes) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
			continue;
		}

		if (ch === '"') inQuotes = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (ch !== '\r') {
			field += ch;
		}
	}

	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}

	return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * 從一段文字裡抓出訂單備註碼。
 *
 * 買家不會乖乖只填代碼，實際會出現「代碼:K7M2QX」「我的ID K7M2QX 謝謝」
 * 這類寫法，所以抓「前後不接其他英數字」的連續 6 個合法字元。
 */
export function extractCode(note: string): string | null {
	const cleaned = note.toUpperCase().replace(/[^0-9A-Z]/g, ' ');
	const m = cleaned.match(new RegExp(`\\b[${CODE_ALPHABET}]{6}\\b`));
	return m ? m[0] : null;
}

/** "1,280" → 1280；抓不到數字回 NaN */
function money(cell: string | undefined): number {
	const raw = (cell ?? '').replace(/[^0-9.-]/g, '');
	return raw === '' ? NaN : Math.floor(Number(raw));
}

/** 標題比對用：去掉空白與換行，「商品總額⏎(A+B-C-D-E)」→「商品總額(A+B-C-D-E)」 */
const norm = (s: string) => s.replace(/\s/g, '');

// ─────────────────────────────────────────────────────────
// 賣貨便
// ─────────────────────────────────────────────────────────

/**
 * 賣貨便「訂單資訊」匯出檔的特徵：
 *
 *   ・第 1 列是篩選條件（「訂購日期：2025/11/03~…」），第 2 列才是標題
 *   ・一張訂單佔好幾列：第一列有訂單資訊，之後每個商品一列，訂單編號留空
 *   ・「商品總額(A+B-C-D-E)」是含運費的實付金額（A 小計、B 運費、C D E 折抵）
 *   ・「回饋資訊1～5」是賣家自訂的結帳問題，內容格式為「問題：回答」
 *
 * 依一份 109 張訂單的真實匯出檔建立，商品總額 = ΣA + B − C − D − E 逐筆驗算全數吻合。
 */
const MYSHIP_REQUIRED = ['訂單編號', '狀態', '付款方式', '運費(B)'];

function findMyshipHeader(rows: string[][]): number {
	for (let i = 0; i < Math.min(rows.length, 6); i++) {
		const cells = rows[i].map(norm);
		if (MYSHIP_REQUIRED.every((h) => cells.includes(h)) && cells.some((c) => c.startsWith('商品總額'))) {
			return i;
		}
	}
	return -1;
}

export function detectFormat(rows: string[][]): OrderFormat {
	if (findMyshipHeader(rows) >= 0) return 'myship';
	if (findEcpayHeader(rows) >= 0) return 'ecpay';
	return 'columns';
}

/**
 * 這張訂單能不能發幣。
 *
 * 付款方式欄會標「(尚未付款)」—— 取貨付款在買家取件前、信用卡在授權完成前都有這個標記，
 * 是最直接的判斷依據。實際資料裡「已送達」但買家還沒去取件的訂單也帶著這個標記，
 * 光看狀態會誤判成已完成。
 *
 * 另外兩種無論付款標記為何都不發：
 *   ・取消訂單
 *   ・已合併：這張訂單被併進另一張（狀態寫「併入：CM…」），金額會算在新的那張上，
 *     兩張都發就是重複發幣
 */
function myshipBlock(status: string, payment: string): OrderBlock {
	if (status.startsWith('已合併')) return 'merged';
	if (status.startsWith('取消')) return 'cancelled';
	if (payment.includes('尚未付款')) return 'not-paid';
	return null;
}

/**
 * 回饋資訊裡「問題名稱」含這些字的那一格，才當作買家填備註碼的地方。
 *
 * 不能把所有回饋資訊都掃一遍 —— 那裡還有「聊天室名稱」「DC 名稱」這類暱稱欄位，
 * 實際資料中就有暱稱剛好是 6 個英文字母、符合備註碼格式。
 */
const CODE_QUESTION = /備註碼|狗狗幣|代碼/;

export function parseMyship(rows: string[][]): ParsedOrder[] {
	const h = findMyshipHeader(rows);
	if (h < 0) return [];

	const header = rows[h].map(norm);
	const col = (name: string) => header.indexOf(name);
	const colStarts = (prefix: string) => header.findIndex((c) => c.startsWith(prefix));

	const cRef = col('訂單編號');
	const cStatus = col('狀態');
	const cPay = col('付款方式');
	const cTotal = colStarts('商品總額');
	const cShip = col('運費(B)');
	const cShipCoupon = colStarts('使用平台運費券');
	const cNote = col('訂單備註');
	const feedback = header
		.map((c, i) => (c.startsWith('回饋資訊') ? i : -1))
		.filter((i) => i >= 0);

	const out: ParsedOrder[] = [];

	for (const r of rows.slice(h + 1)) {
		const orderRef = (r[cRef] ?? '').trim();
		// 沒有訂單編號的是同一張訂單的商品續列
		if (!orderRef) continue;

		const total = money(r[cTotal]);
		const shipping = money(r[cShip]) || 0;
		const shippingCoupon = cShipCoupon >= 0 ? money(r[cShipCoupon]) || 0 : 0;
		/**
		 * 計幣金額不含運費：商品總額 − 運費 + 平台運費券。
		 * 運費是付給物流的，不是周邊消費；運費券抵的也是運費，要一起拿掉。
		 * 選「少算」而不是「多算」：少發可以事後用兌換券補，多發的幣可能已經被押出去收不回來。
		 */
		const amountTwd = Number.isFinite(total) ? total - shipping + shippingCoupon : NaN;

		// 先找回饋資訊裡問備註碼的那一題，找不到才看訂單備註
		let rawCode = '';
		for (const i of feedback) {
			const cell = (r[i] ?? '').trim();
			const m = cell.match(/^(.{1,30}?)[：:](.*)$/s);
			if (m && CODE_QUESTION.test(m[1])) {
				rawCode = m[2].trim();
				break;
			}
		}
		if (!rawCode && cNote >= 0) rawCode = (r[cNote] ?? '').trim();

		const status = (r[cStatus] ?? '').trim();
		out.push({
			orderRef,
			amountTwd,
			totalTwd: total,
			rawCode,
			code: rawCode ? extractCode(rawCode) : null,
			block: myshipBlock(status, r[cPay] ?? ''),
			// 「付款完成⏎(12/25 20:31)」只留第一行
			statusText: status.split('\n')[0].trim()
		});
	}

	return out;
}

// ─────────────────────────────────────────────────────────
// 綠界
// ─────────────────────────────────────────────────────────

/**
 * 綠界「贊助 / 收款」匯出檔的特徵：
 *
 *   ・第 1 列就是標題，一張訂單一列（不像賣貨便會拆成多列）
 *   ・代碼填在「贊助者留言」，那是結帳時給觀眾打字的欄位
 *   ・有「付款狀態」欄（已付款 / 未付款 / 退款…），金額欄是「交易金額」
 *
 * ⚠️ 這份檔案含姓名、手機、電子信箱、地址等個資欄位。
 * 解析時刻意只讀訂單編號、金額、付款狀態與留言 —— 其他欄位連碰都不碰，
 * 也不會寫進資料庫或後台操作紀錄。
 */
const ECPAY_REQUIRED = ['訂單編號', '交易金額', '付款狀態'];

function findEcpayHeader(rows: string[][]): number {
	for (let i = 0; i < Math.min(rows.length, 6); i++) {
		const cells = rows[i].map(norm);
		if (ECPAY_REQUIRED.every((h) => cells.includes(h))) return i;
	}
	return -1;
}

/**
 * 付款狀態 → 能不能發幣。
 * 綠界的狀態是中文字串，退款與失敗都當成不發，其餘非「已付款」一律視為尚未付款。
 */
function ecpayBlock(status: string): OrderBlock {
	if (/退款|取消|失敗/.test(status)) return 'cancelled';
	if (status.includes('已付款')) return null;
	return 'not-paid';
}

export function parseEcpay(rows: string[][]): ParsedOrder[] {
	const h = findEcpayHeader(rows);
	if (h < 0) return [];

	const header = rows[h].map(norm);
	const col = (name: string) => header.indexOf(name);

	const cRef = col('訂單編號');
	const cAmount = col('交易金額');
	const cStatus = col('付款狀態');
	// 代碼優先看贊助者留言（觀眾自己打的），沒有才看廠商備註（我們自己註記的）
	const cNote = col('贊助者留言');
	const cShopNote = col('廠商備註');

	const out: ParsedOrder[] = [];

	for (const r of rows.slice(h + 1)) {
		const orderRef = (r[cRef] ?? '').trim();
		if (!orderRef) continue;

		const amountTwd = money(r[cAmount]);
		let rawCode = cNote >= 0 ? (r[cNote] ?? '').trim() : '';
		// 綠界空欄位會匯出成「-」
		if (rawCode === '-') rawCode = '';
		if (!rawCode && cShopNote >= 0) {
			const shop = (r[cShopNote] ?? '').trim();
			if (shop !== '-') rawCode = shop;
		}

		const status = (r[cStatus] ?? '').trim();
		out.push({
			orderRef,
			amountTwd,
			totalTwd: amountTwd,
			rawCode,
			code: rawCode ? extractCode(rawCode) : null,
			block: ecpayBlock(status),
			statusText: status
		});
	}

	return out;
}

// ─────────────────────────────────────────────────────────
// 其他平台：手動指定欄位
// ─────────────────────────────────────────────────────────

/**
 * 認不出格式時的退路：操作員自己指定訂單編號、金額、備註在第幾欄。
 * 這種格式沒有付款狀態可看，操作員要自己先篩出已付款的訂單再匯入。
 */
export function parseByColumns(
	rows: string[][],
	cols: { orderRef: number; amount: number; note: number },
	hasHeader: boolean
): ParsedOrder[] {
	const out: ParsedOrder[] = [];
	for (const r of hasHeader ? rows.slice(1) : rows) {
		const orderRef = (r[cols.orderRef] ?? '').trim();
		if (!orderRef) continue;
		const amountTwd = money(r[cols.amount]);
		const rawCode = (r[cols.note] ?? '').trim();
		out.push({
			orderRef,
			amountTwd,
			totalTwd: amountTwd,
			rawCode,
			code: extractCode(rawCode),
			block: null,
			statusText: ''
		});
	}
	return out;
}
