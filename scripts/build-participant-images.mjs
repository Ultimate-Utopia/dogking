/**
 * 把繪師交來的 DORO 立繪處理成前台用的圖檔。
 *
 *   node scripts/build-participant-images.mjs <來源資料夾>
 *
 * 原始檔是 1000×1000 的 PNG，每張約 320KB。前台一次會顯示兩張，
 * 直接用原檔等於每次載入就吃掉 640KB —— 觀眾多半在手機上邊看直播邊開網頁，
 * 這個代價太高。因此轉成 WebP 並產生兩種尺寸。
 *
 * 檔名一律轉成 ASCII slug：中日文檔名放進網址要百分比編碼，
 * 又長又容易出錯，交接時也難溝通。
 *
 * 新的立繪交件時重跑這個腳本即可。
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** 立繪檔名（繪師命名） → 網址用的 slug */
const SLUGS = {
	呦呦: 'youyou',
	希蘿亞: 'shiroa',
	黒羊める: 'meru',
	雪寶うさぎ: 'yukibo',
	伊索渡: 'isodo',
	悠妮涅可: 'yunineko',
	悠太翼: 'yuuta',
	姆莉醬: 'muri',
	愛紗公主: 'aisa',
	語風薯薯: 'shushu',
	可樂月月: 'yueyue',
	艾絲梅亞: 'esmeya'
};

const SIZES = [
	{ name: 'sm', width: 256, quality: 82 },
	{ name: 'lg', width: 640, quality: 84 }
];

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
	console.error('用法：node scripts/build-participant-images.mjs <來源資料夾>');
	process.exit(1);
}

const outDir = path.join(process.cwd(), 'static', 'participants');
fs.mkdirSync(outDir, { recursive: true });

const walk = (p) =>
	fs
		.readdirSync(p, { withFileTypes: true })
		.flatMap((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)]));

const files = walk(src).filter((f) => f.toLowerCase().endsWith('.png'));

/**
 * 挑出每個人要用的那一張。
 *
 * 規則：資料夾裡若有「更新」子資料夾，以更新版優先；
 * 否則取沒有 -2 -3 之類後綴的基本款。
 */
const chosen = new Map();
for (const f of files) {
	const base = path.basename(f, '.png');
	const isUpdated = f.split(path.sep).includes('更新');

	// 去掉 -2 / 2 之類的變體後綴，得到人名
	const person = base.replace(/-?\d+$/, '').trim();
	if (!SLUGS[person]) continue;

	const variantRank = isUpdated ? 2 : base === person ? 1 : 0;
	const prev = chosen.get(person);
	if (!prev || variantRank > prev.rank) chosen.set(person, { file: f, rank: variantRank });
}

const missing = Object.keys(SLUGS).filter((p) => !chosen.has(p));
if (missing.length) console.warn('⚠️  找不到立繪：' + missing.join('、'));

let totalIn = 0;
let totalOut = 0;

for (const [person, { file, rank }] of chosen) {
	const slug = SLUGS[person];
	totalIn += fs.statSync(file).size;

	for (const s of SIZES) {
		const out = path.join(outDir, `${slug}-${s.name}.webp`);
		await sharp(file)
			.resize(s.width, s.width, { fit: 'inside', withoutEnlargement: true })
			.webp({ quality: s.quality })
			.toFile(out);
		totalOut += fs.statSync(out).size;
	}

	const tag = rank === 2 ? '（更新版）' : '';
	console.log(`  ${person.padEnd(6)} → ${slug}${tag}`);
}

console.log('');
console.log(`  處理 ${chosen.size} 人，每人 2 種尺寸`);
console.log(
	`  ${(totalIn / 1024 / 1024).toFixed(1)}MB → ${(totalOut / 1024 / 1024).toFixed(2)}MB ` +
		`（縮小 ${Math.round((1 - totalOut / totalIn) * 100)}%）`
);
