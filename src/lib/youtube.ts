/**
 * YouTube 影片網址解析 —— 純函式，可直接用 node 測試。
 *
 * 後台是人在貼網址，所以什麼形式都可能出現：watch 連結、分享用的短網址、
 * 直播頁、Shorts、嵌入網址，後面還常常跟著 ?si=... 之類的追蹤參數。
 * 一律抽出 11 碼的影片 ID，前台只拿 ID 去組嵌入網址。
 */

/** YouTube 影片 ID 固定 11 碼，字元集是 base64url */
const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * 從使用者貼的字串抽出影片 ID。認不出來回 null。
 * 直接貼 11 碼 ID 也接受 —— 有人會從別的地方複製 ID 過來。
 */
export function parseYouTubeId(input: string): string | null {
	const raw = input.trim();
	if (!raw) return null;
	if (ID.test(raw)) return raw;

	let url: URL;
	try {
		// 沒寫 https:// 的話補上，不然 URL 會解析失敗
		url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
	} catch {
		return null;
	}

	const host = url.hostname.replace(/^www\./, '').toLowerCase();
	const parts = url.pathname.split('/').filter(Boolean);

	// youtu.be/VIDEOID
	if (host === 'youtu.be') return ID.test(parts[0] ?? '') ? parts[0] : null;

	if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;

	// youtube.com/watch?v=VIDEOID
	const v = url.searchParams.get('v');
	if (v && ID.test(v)) return v;

	// youtube.com/live/ID、/embed/ID、/shorts/ID、/v/ID
	if (['live', 'embed', 'shorts', 'v'].includes(parts[0] ?? '') && ID.test(parts[1] ?? '')) {
		return parts[1];
	}

	return null;
}

/**
 * 嵌入用網址。
 *
 * 用 youtube-nocookie.com：觀眾只是想看選手過去的表現，不需要被 YouTube 放追蹤 cookie。
 * 前台也刻意等到觀眾按下播放才載入這個 iframe（在那之前只放縮圖），
 * 否則光是開首頁就會向 YouTube 發出十幾個請求。
 */
export function youTubeEmbedUrl(videoId: string): string {
	return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
}

/** 縮圖。hqdefault 每支影片都有，maxres 不一定存在。 */
export function youTubeThumbUrl(videoId: string): string {
	return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** 給操作員對照用的觀看網址 */
export function youTubeWatchUrl(videoId: string): string {
	return `https://www.youtube.com/watch?v=${videoId}`;
}
