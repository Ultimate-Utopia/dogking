/**
 * Excel 讀取器的測試。不需要資料庫。
 *
 *   node scripts/test-xlsx.ts
 *   node scripts/test-xlsx.ts <訂單.xlsx>   另外驗證一份真實檔案：直接解析與「瀏覽器上傳流程」結果相同
 *
 * 真實檔案只測過綠界一種產生器。手機上的 Excel、Google 試算表、Numbers 另存的 .xlsx
 * 內部寫法各不相同，所以這裡自己組出幾種常見的 xlsx 來測。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readXlsx, toCsv } from '../src/lib/xlsx.ts';
import { parseCsv, detectFormat, parseEcpay, parseMyship, stripUnusedColumns } from '../src/lib/order-formats.ts';

// ── 極簡 zip 產生器（只為了組測試檔；不算 CRC，讀取器也不檢查） ──
function zip(files: Record<string, string>, deflate = true): Uint8Array {
	const local: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const nameBuf = Buffer.from(name);
		const raw = Buffer.from(text);
		const data = deflate ? zlib.deflateRawSync(raw) : raw;
		const method = deflate ? 8 : 0;

		const lh = Buffer.alloc(30);
		lh.writeUInt32LE(0x04034b50, 0);
		lh.writeUInt16LE(method, 8);
		lh.writeUInt32LE(data.length, 18);
		lh.writeUInt32LE(raw.length, 22);
		lh.writeUInt16LE(nameBuf.length, 26);
		local.push(lh, nameBuf, data);

		const ch = Buffer.alloc(46);
		ch.writeUInt32LE(0x02014b50, 0);
		ch.writeUInt16LE(method, 10);
		ch.writeUInt32LE(data.length, 20);
		ch.writeUInt32LE(raw.length, 24);
		ch.writeUInt16LE(nameBuf.length, 28);
		ch.writeUInt32LE(offset, 42);
		central.push(ch, nameBuf);

		offset += 30 + nameBuf.length + data.length;
	}
	const cd = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(Object.keys(files).length, 8);
	eocd.writeUInt16LE(Object.keys(files).length, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...local, cd, eocd]));
}

const workbook = (sheetFile: string) => ({
	'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="訂單" sheetId="1" r:id="rId7"/></sheets></workbook>`,
	'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/${sheetFile}"/></Relationships>`
});

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => {
	await fn();
	passed++;
	console.log('  ✓', name);
};

console.log('Excel 讀取');

await t('共用字串、數字、跳過的空格', async () => {
	const file = zip({
		...workbook('sheet1.xml'),
		'xl/sharedStrings.xml': `<sst><si><t>訂單編號</t></si><si><t>運費</t></si><si><t>K7M2QX</t></si></sst>`,
		'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
			<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
			<row r="2"><c r="A2"><v>10000001</v></c><c r="B2"/><c r="C2"><v>65</v></c><c r="D2" t="s"><v>2</v></c></row>
		</sheetData></worksheet>`
	});
	const rows = await readXlsx(file);
	assert.deepEqual(rows, [
		['訂單編號', '', '運費'],
		['10000001', '', '65', 'K7M2QX']
	]);
});

await t('內嵌字串（Google 試算表常用）與 XML 跳脫字元', async () => {
	const file = zip({
		...workbook('sheet1.xml'),
		'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
			<row r="1"><c r="A1" t="inlineStr"><is><t>買家備註</t></is></c></row>
			<row r="2"><c r="A2" t="inlineStr"><is><t>代碼 &lt;P4TR9N&gt; &amp; 謝謝 &#x1F436;</t></is></c></row>
		</sheetData></worksheet>`
	});
	assert.deepEqual(await readXlsx(file), [['買家備註'], ['代碼 <P4TR9N> & 謝謝 🐶']]);
});

await t('多段格式文字接起來，注音標註（rPh）不混進來', async () => {
	const file = zip({
		...workbook('sheet1.xml'),
		'xl/sharedStrings.xml': `<sst><si><r><rPr><b/></rPr><t>我的</t></r><r><t xml:space="preserve"> 代碼</t></r><rPh sb="0" eb="1"><t>ワタシ</t></rPh></si></sst>`,
		'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`
	});
	assert.deepEqual(await readXlsx(file), [['我的 代碼']]);
});

await t('第一個工作表不是 sheet1.xml 時仍讀得到', async () => {
	const file = zip({
		...workbook('sheet3.xml'),
		'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>錯的那張</t></is></c></row></sheetData></worksheet>`,
		'xl/worksheets/sheet3.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>對的那張</t></is></c></row></sheetData></worksheet>`
	});
	assert.deepEqual(await readXlsx(file), [['對的那張']]);
});

await t('沒有壓縮的 zip 也讀得到', async () => {
	const file = zip(
		{
			...workbook('sheet1.xml'),
			'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>公式結果</v></c></row></sheetData></worksheet>`
		},
		false
	);
	assert.deepEqual(await readXlsx(file), [['公式結果']]);
});

await t('標題上方的空白列不影響（標題不一定在第 1 列）', async () => {
	const file = zip({
		...workbook('sheet1.xml'),
		'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
			<row r="3"><c r="A3" t="inlineStr"><is><t>標題</t></is></c></row>
			<row r="4"><c r="A4"><v>1</v></c></row>
		</sheetData></worksheet>`
	});
	assert.deepEqual(await readXlsx(file), [['標題'], ['1']]);
});

await t('不是 Excel 的檔案給看得懂的錯誤', async () => {
	await assert.rejects(readXlsx(new TextEncoder().encode('訂單編號,金額\n1,2')), /不是有效的 Excel/);
});

await t('轉成 CSV 再讀回來內容不變（含逗號、引號、換行）', () => {
	const rows = [['a,b', '說"你好"', '第一行\n第二行'], ['1', '', '3']];
	assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

console.log(`\n${passed} 項全部通過`);

// ── 選用：真實檔案 ─────────────────────────────────────
const real = process.argv[2];
if (real) {
	const rows = await readXlsx(fs.readFileSync(real));
	const format = detectFormat(rows);
	const parse = format === 'myship' ? parseMyship : parseEcpay;
	const direct = parse(rows);
	// 瀏覽器上傳流程：讀 Excel → 拿掉個資欄位 → 轉 CSV → 伺服器 parseCsv → 解析
	const viaUpload = parse(parseCsv(toCsv(stripUnusedColumns(rows))));
	assert.deepEqual(viaUpload, direct);
	const kept = stripUnusedColumns(rows)[0];
	console.log(`\n真實檔案：格式 ${format}，訂單 ${direct.length} 張；上傳流程結果與直接解析相同 ✓`);
	console.log(`  上傳時保留的欄位：${kept.join('、')}`);
	console.log(`  拿掉的欄位數：${rows[0].length - kept.length}`);
}
