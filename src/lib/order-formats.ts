/**
 * 訂單匯出檔的解析 —— 把各平台的 CSV 轉成同一種「訂單」形狀。
 *
 * 刻意不引用資料庫或任何其他模組：這裡只有純函式，
 * 可以直接用 node 跑測試（scripts/test-order-formats.ts），不需要連線。
 * 對帳號、查重複、發幣都在 server/purchase.ts。
 *
 * 放在 $lib 而不是 $lib/server：瀏覽器端也要用 —— 上傳前先在操作員手機上
 * 把姓名、手機、地址等欄位拿掉（stripUnusedColumns），個資就不會送到伺服器。
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

/**
 * 'ecpay-donation' 是「認得出來但刻意拒收」的格式：綠界贊助頁的匯出檔。
 * 那是觀眾贊助實況主的紀錄，不是周邊訂單，拿來發幣就是把贊助當成購買。
 */
export type OrderFormat = 'myship' | 'ecpay' | 'ecpay-donation' | 'columns';

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
	if (findEcpayDonationHeader(rows) >= 0) return 'ecpay-donation';
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
 * 綠界商店「訂單明細」匯出檔（2026-09-21 主辦方提供的正確版本）。
 *
 *   ・第 1 列就是標題，一張訂單一列
 *   ・代碼填在「買家備註」
 *   ・「訂單總金額」含運費，另有「運費」欄 —— 這次活動的狗狗幣不含運費，要扣掉
 *   ・⚠️ 只能用 Excel 匯出。綠界的 CSV 匯出欄位會亂序，不能用
 *
 * 付款與否看「付款日期」有沒有值，不看「訂單狀態」。
 * 實際資料中三張超商取貨付款的訂單都是「待出貨」，付款日期全是空的 ——
 * 買家要到門市取件時才付錢。只看狀態的話，這些還沒付錢的訂單就會被發幣。
 *
 * ⚠️ 這份檔案有付款人與收件人的姓名、手機、Email、地址。
 * 解析只讀訂單編號、訂單狀態、付款日期、運費、訂單總金額、買家備註；
 * 瀏覽器端上傳前也會先把其他欄位拿掉（見 stripUnusedColumns）。
 */
const ECPAY_REQUIRED = ['訂單編號', '訂單狀態', '付款日期', '運費', '訂單總金額'];
const ECPAY_KEEP = [...ECPAY_REQUIRED, '買家備註'];

function findEcpayHeader(rows: string[][]): number {
	for (let i = 0; i < Math.min(rows.length, 6); i++) {
		const cells = rows[i].map(norm);
		if (ECPAY_REQUIRED.every((h) => cells.includes(h))) return i;
	}
	return -1;
}

/** 綠界贊助頁的匯出檔。只用來認出來並拒收，見 OrderFormat 的說明。 */
function findEcpayDonationHeader(rows: string[][]): number {
	for (let i = 0; i < Math.min(rows.length, 6); i++) {
		const cells = rows[i].map(norm);
		if (['訂單編號', '交易金額', '付款狀態', '贊助者留言'].every((h) => cells.includes(h))) return i;
	}
	return -1;
}

function ecpayBlock(status: string, paidAt: string): OrderBlock {
	if (/取消|退款|退貨|失敗/.test(status)) return 'cancelled';
	if (!paidAt || paidAt === '-') return 'not-paid';
	return null;
}

export function parseEcpay(rows: string[][]): ParsedOrder[] {
	const h = findEcpayHeader(rows);
	if (h < 0) return [];

	const header = rows[h].map(norm);
	const col = (name: string) => header.indexOf(name);

	const cRef = col('訂單編號');
	const cStatus = col('訂單狀態');
	const cPaidAt = col('付款日期');
	const cShip = col('運費');
	const cTotal = col('訂單總金額');
	const cNote = col('買家備註');

	const out: ParsedOrder[] = [];

	for (const r of rows.slice(h + 1)) {
		const orderRef = (r[cRef] ?? '').trim();
		if (!orderRef) continue;

		const total = money(r[cTotal]);
		const shipping = money(r[cShip]) || 0;
		// 狗狗幣不含運費（主辦方 09-21 確認）
		const amountTwd = Number.isFinite(total) ? total - shipping : NaN;

		let rawCode = cNote >= 0 ? (r[cNote] ?? '').trim() : '';
		if (rawCode === '-') rawCode = '';

		const status = (r[cStatus] ?? '').trim();
		out.push({
			orderRef,
			amountTwd,
			totalTwd: total,
			rawCode,
			code: rawCode ? extractCode(rawCode) : null,
			block: ecpayBlock(status, (r[cPaidAt] ?? '').trim()),
			statusText: status
		});
	}

	return out;
}

// ─────────────────────────────────────────────────────────
// 上傳前拿掉用不到的欄位
// ─────────────────────────────────────────────────────────

/**
 * 認得出格式時，只保留解析會用到的欄位。
 *
 * 匯出檔裡有買家的姓名、手機、Email、地址。整份上傳的話，這些個資會經過我們的伺服器，
 * 還會在「預覽 → 確認發放」之間來回傳一次。在瀏覽器裡先拿掉，個資就不會離開操作員的手機。
 *
 * 認不出格式時原樣回傳 —— 那時要靠操作員手動指定「第幾欄」，拿掉欄位會讓欄號對不上。
 */
export function stripUnusedColumns(rows: string[][]): string[][] {
	let h = -1;
	let keep: (name: string) => boolean = () => true;

	const format = detectFormat(rows);
	if (format === 'ecpay') {
		h = findEcpayHeader(rows);
		keep = (n) => ECPAY_KEEP.includes(n);
	} else if (format === 'myship') {
		h = findMyshipHeader(rows);
		keep = (n) =>
			MYSHIP_REQUIRED.includes(n) ||
			n.startsWith('商品總額') ||
			n.startsWith('使用平台運費券') ||
			n.startsWith('回饋資訊') ||
			n === '訂單備註';
	} else {
		return rows;
	}

	const cols = rows[h].map((c, i) => (keep(norm(c)) ? i : -1)).filter((i) => i >= 0);
	return rows.map((r) => cols.map((i) => r[i] ?? ''));
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
