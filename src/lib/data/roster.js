/**
 * 賽事初始資料 —— 參賽者、主持群與場次骨架。
 *
 * 刻意寫成純 JS（不是 .ts）：開發用的 /dev/seed 路由與
 * 可對正式資料庫執行的 scripts/seed.mjs 都要用它。
 * 兩邊共用同一份，才不會改了一邊忘了另一邊。
 *
 * 名稱以完整台名為準（立繪檔名與 lit.link 一致）。
 * 企劃書用的是簡稱，對應如下：
 *   呦呦→呦呦　希亞→希蘿亞　咩嚕→黒羊める　雪寶→雪寶うさぎ　渡渡→伊索渡
 *   悠妮→悠妮涅可　阿翼→悠太翼　姆莉→姆莉醬　愛紗→愛紗公主
 */

/**
 * @typedef {object} RosterMember
 * @property {string} name
 * @property {'player'|'host'} role
 * @property {string} doroSlug  立繪 slug，對應 /participants/{slug}-sm.webp
 * @property {string} channelUrl
 * @property {string} [roleLabel] 主持人的職稱
 */

/** @type {RosterMember[]} */
export const ROSTER = [
	{ name: '呦呦', role: 'player', doroSlug: 'youyou', channelUrl: 'https://www.youtube.com/@yunyun_twvt' },
	{ name: '希蘿亞', role: 'player', doroSlug: 'shiroa', channelUrl: 'https://www.youtube.com/@Siroya.Neilson' },
	{ name: '黒羊める', role: 'player', doroSlug: 'meru', channelUrl: 'https://www.youtube.com/channel/UCUhYqNYFmyP6MWGIZX9gndA' },
	// 雪寶是 Twitch，其餘皆為 YouTube
	{ name: '雪寶うさぎ', role: 'player', doroSlug: 'yukibo', channelUrl: 'https://www.twitch.tv/shinyuki2511' },
	{ name: '伊索渡', role: 'player', doroSlug: 'isodo', channelUrl: 'https://www.youtube.com/@AesopDu' },
	{ name: '悠妮涅可', role: 'player', doroSlug: 'yunineko', channelUrl: 'https://www.youtube.com/@uninekoch_3337' },
	{ name: '悠太翼', role: 'player', doroSlug: 'yuuta', channelUrl: 'https://www.youtube.com/@YuutaTsubasa' },
	{ name: '姆莉醬', role: 'player', doroSlug: 'muri', channelUrl: 'https://www.youtube.com/@MurichanChannel' },
	{ name: '愛紗公主', role: 'player', doroSlug: 'aisa', channelUrl: 'https://www.youtube.com/@愛紗公主與毬毬Aisa' },
	{ name: '語風薯薯', role: 'host', roleLabel: '賽事主持', doroSlug: 'shushu', channelUrl: 'https://www.youtube.com/channel/UCLHSj-ZnzmpQlZuUcnXMoVg' },
	{ name: '可樂月月', role: 'host', roleLabel: '賽事副持', doroSlug: 'yueyue', channelUrl: 'https://www.youtube.com/@colamoonie' },
	{ name: '艾絲梅亞', role: 'host', roleLabel: '賭盤副台', doroSlug: 'esmeya', channelUrl: 'https://www.youtube.com/@Esmea666' }
];

/**
 * @typedef {object} Advance
 * @property {number} match  流向第幾場（場次編號）
 * @property {'blue'|'red'} slot  流向該場的哪一側
 */

/**
 * @typedef {object} MatchSeed
 * @property {number} orderNo
 * @property {string} roundLabel
 * @property {'BO1'|'BO3'|'BO5'} format
 * @property {boolean} isElimination
 * @property {'winners'|'losers'|'final'} bracket
 * @property {number} roundNo
 * @property {Advance|null} winnerTo
 * @property {Advance|null} loserTo
 */

/**
 * 賽程 —— 依主辦方提供的賽程圖建立。
 *
 * 這是標準的 8 人雙敗淘汰：2 × 8 − 2 = 14 場，正好對上圖上的場次 1～14。
 *
 * ⚠️ 企劃書文字寫「9 名參賽者、12 場」，兩個數字都與賽程圖不符。
 *    目前依賽程圖建立；第 9 位參賽者的安排待主辦方確認。
 *
 * 晉級關係（winnerTo / loserTo）是樹狀圖與「判定勝方後自動帶入下一場」
 * 的依據。null 代表到此為止 —— 拿冠軍，或遭淘汰。
 *
 * @type {MatchSeed[]}
 */
export const MATCHES = [
	// ── 勝部第一輪（BO1）敗者掉到敗部，不算淘汰 ──
	{ orderNo: 1, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: 'winners', roundNo: 1, winnerTo: { match: 5, slot: 'blue' }, loserTo: { match: 7, slot: 'blue' } },
	{ orderNo: 2, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: 'winners', roundNo: 1, winnerTo: { match: 5, slot: 'red' }, loserTo: { match: 7, slot: 'red' } },
	{ orderNo: 3, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: 'winners', roundNo: 1, winnerTo: { match: 6, slot: 'blue' }, loserTo: { match: 8, slot: 'blue' } },
	{ orderNo: 4, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: 'winners', roundNo: 1, winnerTo: { match: 6, slot: 'red' }, loserTo: { match: 8, slot: 'red' } },

	// ── 勝部四強（BO3）──
	{ orderNo: 5, roundLabel: '勝部四強', format: 'BO3', isElimination: false, bracket: 'winners', roundNo: 2, winnerTo: { match: 11, slot: 'blue' }, loserTo: { match: 9, slot: 'red' } },
	{ orderNo: 6, roundLabel: '勝部四強', format: 'BO3', isElimination: false, bracket: 'winners', roundNo: 2, winnerTo: { match: 11, slot: 'red' }, loserTo: { match: 10, slot: 'red' } },

	// ── 敗部第一輪（BO1）從這裡開始輸了就淘汰 ──
	{ orderNo: 7, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true, bracket: 'losers', roundNo: 1, winnerTo: { match: 9, slot: 'blue' }, loserTo: null },
	{ orderNo: 8, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true, bracket: 'losers', roundNo: 1, winnerTo: { match: 10, slot: 'blue' }, loserTo: null },

	// ── 敗部第二輪（BO3）敗部勝者對上勝部掉下來的人 ──
	{ orderNo: 9, roundLabel: '敗部第二輪', format: 'BO3', isElimination: true, bracket: 'losers', roundNo: 2, winnerTo: { match: 12, slot: 'blue' }, loserTo: null },
	{ orderNo: 10, roundLabel: '敗部第二輪', format: 'BO3', isElimination: true, bracket: 'losers', roundNo: 2, winnerTo: { match: 12, slot: 'red' }, loserTo: null },

	// ── 勝部決賽（BO3）敗者掉到敗部決賽 ──
	{ orderNo: 11, roundLabel: '勝部決賽', format: 'BO3', isElimination: false, bracket: 'winners', roundNo: 3, winnerTo: { match: 14, slot: 'blue' }, loserTo: { match: 13, slot: 'blue' } },

	// ── 敗部第三輪與敗部決賽（BO3）──
	{ orderNo: 12, roundLabel: '敗部第三輪', format: 'BO3', isElimination: true, bracket: 'losers', roundNo: 3, winnerTo: { match: 13, slot: 'red' }, loserTo: null },
	{ orderNo: 13, roundLabel: '敗部決賽', format: 'BO3', isElimination: true, bracket: 'losers', roundNo: 4, winnerTo: { match: 14, slot: 'red' }, loserTo: null },

	// ── 總決賽（BO5）──
	{ orderNo: 14, roundLabel: '總決賽', format: 'BO5', isElimination: true, bracket: 'final', roundNo: 1, winnerTo: null, loserTo: null },

	// ── 加賽（BO5）只有敗部冠軍在場次 14 擊敗勝部冠軍時才進行 ──
	{ orderNo: 15, roundLabel: '加賽（敗部冠軍勝出時觸發）', format: 'BO5', isElimination: true, bracket: 'final', roundNo: 2, winnerTo: null, loserTo: null }
];
