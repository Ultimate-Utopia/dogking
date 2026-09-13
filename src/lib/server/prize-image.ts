/**
 * 獎品圖片的檢查 —— 純函式，不連資料庫，可以直接用 node 測試。
 *
 * 後台上傳的圖片之後會用我們自己的網域送給所有觀眾，
 * 所以伺服器端一定要自己驗一次，不能相信瀏覽器說它是什麼：
 *
 *   ・只收 WebP / JPEG / PNG，而且看檔案開頭的魔術位元組，不看宣稱的類型
 *   ・刻意不收 SVG —— SVG 裡可以藏 JavaScript，從我們的網域送出去就是 XSS
 *   ・大小設上限。瀏覽器端已經縮到 800px 以內，正常只有一兩百 KB
 */
import { createHash } from 'node:crypto';

export const MAX_IMAGE_BYTES = 600 * 1024;

export class PrizeInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PrizeInputError';
	}
}

type ImageType = 'image/webp' | 'image/jpeg' | 'image/png';

/** 依檔案開頭判斷真正的格式，認不得就回 null */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
	const at = (i: number) => bytes[i];
	if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
		at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
		return 'image/webp'; // "RIFF....WEBP"
	}
	if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
	if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
	return null;
}

/**
 * 把表單送來的 data URL 轉成可以存進資料庫的圖片。
 * 版本號取內容雜湊，同一張圖重傳版本不變，換圖網址一定變。
 */
export function decodeImageDataUrl(dataUrl: string): { bytes: Buffer; type: ImageType; version: string } {
	const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
	if (!m) throw new PrizeInputError('圖片格式無法辨識，請重新選擇檔案');

	// 先用 base64 長度估算，避免把超大的字串整個解碼
	if ((m[2].length * 3) / 4 > MAX_IMAGE_BYTES * 1.05) {
		throw new PrizeInputError(`圖片太大，上限 ${Math.round(MAX_IMAGE_BYTES / 1024)} KB`);
	}

	const bytes = Buffer.from(m[2], 'base64');
	if (bytes.length > MAX_IMAGE_BYTES) {
		throw new PrizeInputError(`圖片太大，上限 ${Math.round(MAX_IMAGE_BYTES / 1024)} KB`);
	}

	const type = sniffImageType(bytes);
	if (!type) throw new PrizeInputError('只接受 WebP、JPEG 或 PNG 圖片');

	const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
	return { bytes, type, version };
}

export interface PrizeInput {
	sortOrder: number;
	ranksLabel: string;
	name: string;
	features: string[];
}

/** 後台表單 → 獎品欄位。特色一行一項，空行略過。 */
export function parsePrizeInput(fields: {
	sortOrder?: unknown;
	ranksLabel?: unknown;
	name?: unknown;
	features?: unknown;
}): PrizeInput {
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

	const ranksLabel = str(fields.ranksLabel);
	const name = str(fields.name);
	const sortOrder = Number(str(fields.sortOrder) || 0);
	const features = str(fields.features)
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(Boolean);

	if (!name) throw new PrizeInputError('請填寫品名');
	if (!ranksLabel) throw new PrizeInputError('請填寫適用名次，例如「持有狗狗幣前三名」');
	if (name.length > 40) throw new PrizeInputError('品名最多 40 字');
	if (ranksLabel.length > 30) throw new PrizeInputError('適用名次最多 30 字');
	if (!Number.isInteger(sortOrder)) throw new PrizeInputError('顯示順序請填整數');
	if (features.length > 8) throw new PrizeInputError('特色最多 8 項');
	if (features.some((f) => f.length > 30)) throw new PrizeInputError('每項特色最多 30 字');

	return { sortOrder, ranksLabel, name, features };
}
