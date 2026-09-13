/**
 * 狗狗幣排行榜的獎品 —— 主辦方提供（2026-09-13）。
 *
 * 刻意放在資料檔而不是寫死在頁面裡：品名、說明、示意圖日後改動時，
 * 只要改這一份，不必去翻版面程式碼。
 *
 * 示意圖放進 static/prizes/ 後，把 image 改成 '/prizes/檔名.webp' 即可。
 * image 為 null 時前台會顯示「示意圖準備中」的佔位，不會出現破圖。
 */

/**
 * @typedef {object} Prize
 * @property {string} ranks  適用名次的文字，例如「第 1～3 名」
 * @property {string} name   品名
 * @property {string[]} features  特色，一項一行
 * @property {string|null} image  示意圖路徑
 */

/** @type {Prize} */
export const TOP_HOLDER_PRIZE = {
	ranks: '持有狗狗幣前三名',
	name: '愛心水晶王座',
	features: ['可指定印刷的狗狗', '含親簽', '客製化 ID'],
	image: null
};
