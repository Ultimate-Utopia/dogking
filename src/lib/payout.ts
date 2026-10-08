/**
 * 彩池計算 —— 對應規格書 §05
 *
 * 純函式、不連資料庫，所以 scripts/test-payout.ts 可以直接用 node 跑。
 * 寫入帳本與盤口狀態在 server/tournament.ts。
 */

// ─────────────────────────────────────────────────────────
// 賠率
// ─────────────────────────────────────────────────────────

/**
 * 彩池分配制賠率：總彩池 ÷ 該方彩池。
 *
 * 某方彩池為 0 時賠率無意義（沒有人押就沒有人能領），回傳 null。
 * 前台顯示時應標示「預估賠率，最終依封盤後彩池計算」。
 */
export function calcOdds(poolBlue: number, poolRed: number) {
	const total = poolBlue + poolRed;
	return {
		blue: poolBlue > 0 ? total / poolBlue : null,
		red: poolRed > 0 ? total / poolRed : null,
		total
	};
}

/**
 * 單筆下注在指定彩池下的派彩金額。無條件捨去，餘數留在系統。
 *
 * ⚠️ 用 BigInt 算，不要改回 `Math.floor(amount * poolTotal / poolWinner)`。
 *
 * amount × poolTotal 這個中間值很容易超過 JavaScript 的安全整數上限
 * （9,007,199,254,740,991）。超過之後浮點數只能表示近似值，結果會差個一兩塊 ——
 * 最明顯的是「獲勝方只有一個人押」的情況：他應該把整個彩池拿回去，
 * 卻會因為誤差少拿 1 枚。實測在獲勝方彩池約 6,700 萬以上就會出現。
 *
 * 這次活動是 NT$1 = 100 狗狗幣，300 人各買 NT$2,000 就有 6,000 萬，
 * 剛好落在那個量級，不是純理論問題。
 *
 * BigInt 的除法本來就是往零捨去，正數即無條件捨去，與原本的規則一致。
 */
export function calcPayout(amount: number, poolWinner: number, poolTotal: number): number {
	if (poolWinner <= 0) return 0;
	return Number((BigInt(amount) * BigInt(poolTotal)) / BigInt(poolWinner));
}
