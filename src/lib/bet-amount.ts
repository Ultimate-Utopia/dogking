/**
 * 下注金額輸入的規則 —— 純函式，可直接用 node 測試。
 *
 * 主辦方要求可以自己打金額（分完獎池會出現零頭，籌碼按鈕湊不出來），
 * 規則是：大於 0、不可有小數點、不可超過持有數量。
 *
 * ⚠️ 這裡只負責「讓人不容易打錯」。真正的把關在伺服器端：
 * placeBet 會重新驗一次金額，餘額不足由資料庫的鎖定與帳本擋下。
 * 前端的檢查永遠可以被繞過，不能當成唯一防線。
 */

export interface StakeInput {
	/** 回填到輸入框的字串。空字串代表還沒輸入。 */
	text: string;
	/** 實際要送出的金額。0 代表不能下注。 */
	value: number;
	/** 被持有量擋下來時為 true，畫面上提示「已是全部狗狗幣」 */
	clamped: boolean;
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

	if (digits === '') return { text: '', value: 0, clamped: false };

	// 去掉開頭多餘的 0，避免出現 "007"
	const trimmed = digits.replace(/^0+(?=\d)/, '');
	const n = Number(trimmed);

	// 超過安全整數就直接視為「全押」，不要讓它變成 1e21 這種東西
	if (!Number.isSafeInteger(n)) {
		const max = Math.max(0, Math.floor(balance));
		return { text: String(max), value: max, clamped: true };
	}

	const max = Math.max(0, Math.floor(balance));
	if (n > max) return { text: String(max), value: max, clamped: true };

	return { text: trimmed, value: n, clamped: false };
}
