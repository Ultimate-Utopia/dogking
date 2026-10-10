/**
 * 應援金額輸入的規則 —— 純函式，可直接用 node 測試。
 *
 * 主辦方要求可以自己打金額（分完獎池會出現零頭，狗狗幣按鈕湊不出來），
 * 規則是：至少 100、不可有小數點、不可超過持有數量。
 *
 * ⚠️ 這裡只負責「讓人不容易打錯」。真正的把關在伺服器端：
 * placeBet 會重新驗一次金額，餘額不足由資料庫的鎖定與帳本擋下。
 * 前端的檢查永遠可以被繞過，不能當成唯一防線。
 */

/**
 * 最低應援金額（主辦方 10-10）。
 *
 * 原本下限是 1。投入 1 枚猜中時，<u>無條件捨去只會吃掉賺的部分</u>
 * —— 輸方池比贏方池小的時候就是拿回 1 枚、不賺不賠，體驗很差。
 *
 * ⚠️ 伺服器端的 placeBet 也要擋。前端的檢查永遠可以被繞過。
 */
export const MIN_STAKE = 100;

export interface StakeInput {
	/** 回填到輸入框的字串。空字串代表還沒輸入。 */
	text: string;
	/** 實際要送出的金額。0 代表不能應援。 */
	value: number;
	/** 被持有量擋下來時為 true，畫面上提示「已是全部狗狗幣」 */
	clamped: boolean;
	/**
	 * 打了數字、但還沒到最低金額。
	 *
	 * ⚠️ 刻意<strong>不</strong>在這裡自動補到 100 —— 使用者打「1」的下一秒
	 * 可能是要打「100」，當場改成 100 會讓人完全沒辦法輸入。
	 * 這裡只標記，由畫面提示、送出按鈕擋下來。
	 */
	belowMin: boolean;
}

/**
 * 把使用者打的字轉成合法金額。
 *
 * 全形數字（１２３）一併轉半形 —— 手機中文輸入法很容易打出全形，
 * 不轉的話使用者會覺得「我明明有打字，怎麼都是 0」。
 * 小數點、負號、逗號、空白一律丟掉：小數點不合規則，千分位逗號則是貼上金額時常見。
 */
export function sanitizeStake(raw: string, balance: number): StakeInput {
	const half = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
	const digits = half.replace(/[^0-9]/g, '');

	if (digits === '') return { text: '', value: 0, clamped: false, belowMin: false };

	// 去掉開頭多餘的 0，避免出現 "007"
	const trimmed = digits.replace(/^0+(?=\d)/, '');
	const n = Number(trimmed);

	// 超過安全整數就直接視為「全部投入」，不要讓它變成 1e21 這種東西
	const max = Math.max(0, Math.floor(balance));
	const below = (v: number) => v > 0 && v < MIN_STAKE;

	if (!Number.isSafeInteger(n)) {
		return { text: String(max), value: max, clamped: true, belowMin: below(max) };
	}

	if (n > max) return { text: String(max), value: max, clamped: true, belowMin: below(max) };

	return { text: trimmed, value: n, clamped: false, belowMin: below(n) };
}
