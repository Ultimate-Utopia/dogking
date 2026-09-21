/**
 * 極簡 .xlsx 讀取器 —— 只讀「第一個工作表」的儲存格文字。
 *
 * 為什麼需要：綠界的訂單匯出選 CSV 會亂序，只有 Excel 版是對的；
 * 主辦方又希望能用手機直接上傳，不想先開電腦轉檔。
 *
 * 為什麼自己寫而不裝套件：
 *   ・npm 上的 xlsx（SheetJS）停在 0.18.5，有已知的原型污染與 ReDoS 漏洞，
 *     維護中的版本改從官方 CDN 發佈、不在 npm 上
 *   ・exceljs 等完整套件動輒數百 KB，要全部送到觀眾與操作員的手機
 *   ・我們只需要「每一格的文字」，不需要樣式、公式、圖表
 *
 * .xlsx 其實是一個 zip，裡面是 XML：
 *   xl/workbook.xml + xl/_rels/workbook.xml.rels → 第一個工作表是哪個檔案
 *   xl/sharedStrings.xml → 文字儲存格共用的字串表
 *   xl/worksheets/sheetN.xml → 每一格的值
 *
 * 解壓縮用瀏覽器內建的 DecompressionStream（Node 18+ 也有），
 * XML 用正規表示式讀 —— Excel 產生的這幾個檔案結構固定，不需要完整的 XML 解析器，
 * 也因此同一份程式可以直接在 Node 裡測試。
 */

export class XlsxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'XlsxError';
	}
}

// ─────────────────────────────────────────────────────────
// zip
// ─────────────────────────────────────────────────────────

interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	localOffset: number;
}

function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// 從檔尾往回找「中央目錄結束」記錄（0x06054b50）
	let eocd = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new XlsxError('這不是有效的 Excel 檔（找不到壓縮目錄）');

	const count = view.getUint16(eocd + 10, true);
	let p = view.getUint32(eocd + 16, true);
	const entries = new Map<string, ZipEntry>();
	const decoder = new TextDecoder();

	for (let i = 0; i < count; i++) {
		if (view.getUint32(p, true) !== 0x02014b50) throw new XlsxError('Excel 檔的目錄結構損毀');
		const method = view.getUint16(p + 10, true);
		const compressedSize = view.getUint32(p + 20, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const localOffset = view.getUint32(p + 42, true);
		const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
		entries.set(name, { name, method, compressedSize, localOffset });
		p += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

async function readZipFile(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const p = entry.localOffset;
	if (view.getUint32(p, true) !== 0x04034b50) throw new XlsxError('Excel 檔的內容損毀');
	const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
	const data = bytes.subarray(start, start + entry.compressedSize);

	if (entry.method === 0) return new TextDecoder().decode(data);
	if (entry.method !== 8) throw new XlsxError('不支援這種 Excel 壓縮方式');

	// slice() 複製成獨立的 ArrayBuffer：Blob 不收 SharedArrayBuffer 型別的來源
	const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Response(stream).text();
}

// ─────────────────────────────────────────────────────────
// XML
// ─────────────────────────────────────────────────────────

function decodeXml(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
		if (e === 'lt') return '<';
		if (e === 'gt') return '>';
		if (e === 'amp') return '&';
		if (e === 'quot') return '"';
		if (e === 'apos') return "'";
		const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
		return String.fromCodePoint(code);
	});
}

/** 一段 XML 裡所有 <t> 的文字接起來。刻意略過 <rPh>（中日文的注音標註，也包著 <t>）。 */
function textOf(xml: string): string {
	const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
	let out = '';
	for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
	return decodeXml(out);
}

function attr(tag: string, name: string): string | null {
	const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
	return m ? decodeXml(m[1]) : null;
}

/** "AB12" → 27（從 0 開始） */
function columnIndex(ref: string): number {
	const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
	let n = 0;
	for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

// ─────────────────────────────────────────────────────────
// 工作表
// ─────────────────────────────────────────────────────────

/** 找出第一個工作表的檔案路徑。不能假設是 sheet1.xml —— 工作表被刪過或重排就不是。 */
async function firstSheetPath(bytes: Uint8Array, entries: Map<string, ZipEntry>): Promise<string> {
	const wb = entries.get('xl/workbook.xml');
	const rels = entries.get('xl/_rels/workbook.xml.rels');
	if (wb && rels) {
		const wbXml = await readZipFile(bytes, wb);
		const relsXml = await readZipFile(bytes, rels);
		const sheetTag = /<sheet\b[^>]*>/.exec(wbXml)?.[0];
		const rid = sheetTag ? (attr(sheetTag, 'r:id') ?? attr(sheetTag, 'id')) : null;
		if (rid) {
			for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
				if (attr(m[0], 'Id') === rid) {
					const target = attr(m[0], 'Target') ?? '';
					const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
					if (entries.has(path)) return path;
				}
			}
		}
	}
	// 退路：目錄裡第一個工作表
	const any = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
	if (!any.length) throw new XlsxError('Excel 檔裡找不到工作表');
	return any[0];
}

/**
 * 讀出第一個工作表的所有儲存格文字，回傳和 parseCsv 相同的形狀（string[][]），
 * 後面的格式辨識與解析完全不用改。
 */
export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<string[][]> {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const entries = readZipDirectory(bytes);

	const shared: string[] = [];
	const ss = entries.get('xl/sharedStrings.xml');
	if (ss) {
		const xml = await readZipFile(bytes, ss);
		for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
	}

	const sheetXml = await readZipFile(bytes, entries.get(await firstSheetPath(bytes, entries))!);
	const rows: string[][] = [];

	for (const rm of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
		const rowNo = Number(attr(rm[0], 'r'));
		const cells: string[] = [];
		let next = 0;

		// <c .../> 自閉合的是空格子，只需要 <c ...>...</c>
		for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const tag = `<c${cm[1]}>`;
			const ref = attr(tag, 'r');
			const col = ref ? columnIndex(ref) : next;
			next = col + 1;
			const body = cm[2] ?? '';
			const type = attr(tag, 't');
			const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];

			let value = '';
			if (type === 's') value = shared[Number(v)] ?? '';
			else if (type === 'inlineStr') value = textOf(body);
			else if (v !== undefined) value = decodeXml(v);

			while (cells.length < col) cells.push('');
			cells[col] = value;
		}

		// 保留空白列的位置，列號才對得上（標題不一定在第 1 列）
		const index = Number.isFinite(rowNo) && rowNo > 0 ? rowNo - 1 : rows.length;
		while (rows.length < index) rows.push([]);
		rows[index] = cells;
	}

	return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** 轉成 CSV 文字：每一格都加引號，內容裡的逗號與換行就不會把欄位切錯。 */
export function toCsv(rows: string[][]): string {
	return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
