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

/** @type {'winners'} */
const W = 'winners';
/** @type {'losers'} */
const L = 'losers';
/**
 * @param {number} match
 * @param {'blue'|'red'} slot
 * @returns {Advance}
 */
const to = (match, slot) => ({ match, slot });

/**
 * 賽程 —— 依主辦方提供的 9 人賽程圖建立（2026-09-13 版）。
 *
 * 9 人雙敗淘汰：2 × 9 − 2 = 16 場，正好對上圖上的 M1～M16。
 * 圖上沒有「敗部冠軍贏了總決賽要再加賽」的場次，M16 就是冠軍戰。
 *
 * 9 人不是 2 的次方，所以勝部多一場資格賽：M1 的勝者才進 M2 對上參賽 3。
 * 敗部同理，M6（M1 敗者 vs M2 敗者）是敗部的資格賽。
 *
 * 每一場的藍方／紅方＝賽程圖上該格的上列／下列。
 * 輪次名稱是依結構推定的，賽程圖本身沒有寫，後台可改。
 *
 * 晉級關係（winnerTo / loserTo）是樹狀圖與「判定勝方後自動帶入下一場」
 * 的依據。null 代表到此為止 —— 拿冠軍，或遭淘汰。
 *
 * 沒有任何路線指進去的格子就是「種子位」，由後台指派參賽者。
 * 這份賽程共 9 個種子位：M1 雙方、M2 紅方、M3～M5 雙方。
 * scripts/verify-bracket.mjs 會核對種子位數量等於參賽人數。
 *
 * @type {MatchSeed[]}
 */
export const MATCHES = [
	// ── 勝部 ─────────────────────────────────────────
	// M1 是資格賽：9 人多出來的那一位從這裡打上來
	{ orderNo: 1, roundLabel: '勝部資格賽', format: 'BO1', isElimination: false, bracket: W, roundNo: 1, winnerTo: to(2, 'blue'), loserTo: to(6, 'blue') },
	{ orderNo: 2, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: W, roundNo: 2, winnerTo: to(9, 'blue'), loserTo: to(6, 'red') },
	{ orderNo: 3, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: W, roundNo: 2, winnerTo: to(9, 'red'), loserTo: to(7, 'red') },
	{ orderNo: 4, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: W, roundNo: 2, winnerTo: to(10, 'blue'), loserTo: to(8, 'blue') },
	{ orderNo: 5, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false, bracket: W, roundNo: 2, winnerTo: to(10, 'red'), loserTo: to(8, 'red') },

	// ── 敗部前段（BO1）從這裡開始輸了就淘汰 ─────────
	{ orderNo: 6, roundLabel: '敗部資格賽', format: 'BO1', isElimination: true, bracket: L, roundNo: 1, winnerTo: to(7, 'blue'), loserTo: null },
	{ orderNo: 7, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true, bracket: L, roundNo: 2, winnerTo: to(11, 'blue'), loserTo: null },
	{ orderNo: 8, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true, bracket: L, roundNo: 2, winnerTo: to(12, 'blue'), loserTo: null },

	// ── 勝部四強（BO3）敗者掉到敗部第二輪 ──────────
	{ orderNo: 9, roundLabel: '勝部四強', format: 'BO3', isElimination: false, bracket: W, roundNo: 3, winnerTo: to(13, 'blue'), loserTo: to(11, 'red') },
	{ orderNo: 10, roundLabel: '勝部四強', format: 'BO3', isElimination: false, bracket: W, roundNo: 3, winnerTo: to(13, 'red'), loserTo: to(12, 'red') },

	// ── 敗部第二輪（BO3）─────────────────────────────
	{ orderNo: 11, roundLabel: '敗部第二輪', format: 'BO3', isElimination: true, bracket: L, roundNo: 3, winnerTo: to(14, 'blue'), loserTo: null },
	{ orderNo: 12, roundLabel: '敗部第二輪', format: 'BO3', isElimination: true, bracket: L, roundNo: 3, winnerTo: to(14, 'red'), loserTo: null },

	// ── 勝部決賽（BO3）敗者掉到敗部決賽 ────────────
	{ orderNo: 13, roundLabel: '勝部決賽', format: 'BO3', isElimination: false, bracket: W, roundNo: 4, winnerTo: to(16, 'blue'), loserTo: to(15, 'red') },

	// ── 敗部第三輪（BO3）與敗部決賽（BO5）────────────
	{ orderNo: 14, roundLabel: '敗部第三輪', format: 'BO3', isElimination: true, bracket: L, roundNo: 4, winnerTo: to(15, 'blue'), loserTo: null },
	{ orderNo: 15, roundLabel: '敗部決賽', format: 'BO5', isElimination: true, bracket: L, roundNo: 5, winnerTo: to(16, 'red'), loserTo: null },

	// ── 總決賽（BO5）沒有加賽，勝者即冠軍 ──────────
	{ orderNo: 16, roundLabel: '總決賽', format: 'BO5', isElimination: true, bracket: 'final', roundNo: 1, winnerTo: null, loserTo: null }
];
