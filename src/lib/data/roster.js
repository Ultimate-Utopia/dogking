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
 * @typedef {object} MatchSeed
 * @property {number} orderNo
 * @property {string} roundLabel
 * @property {'BO1'|'BO3'|'BO5'} format
 * @property {boolean} isElimination
 */

/**
 * 場次骨架。對戰組合刻意留空 —— 雙敗淘汰下，
 * 場次 5 的對手要等場次 1、2 打完才確定，由後台在賽程推進時填入。
 *
 * ⚠️ 9 人雙敗淘汰需要 16 場才能決出冠軍（淘汰 8 人 × 每人 2 敗），
 * 企劃書只列 12 場。詳見規格書 §06。這些欄位全部可在後台修改。
 *
 * 場次 9 的 isElimination 與企劃書不同：企劃書列為輸者淘汰，
 * 但勝部決賽的敗者依定義掉到敗部而非淘汰。
 *
 * @type {MatchSeed[]}
 */
export const MATCHES = [
	{ orderNo: 1, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 2, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 3, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 4, roundLabel: '勝部第一輪', format: 'BO1', isElimination: false },
	{ orderNo: 5, roundLabel: '勝部四強', format: 'BO3', isElimination: false },
	{ orderNo: 6, roundLabel: '勝部四強', format: 'BO3', isElimination: false },
	{ orderNo: 7, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true },
	{ orderNo: 8, roundLabel: '敗部第一輪', format: 'BO1', isElimination: true },
	{ orderNo: 9, roundLabel: '勝部決賽', format: 'BO3', isElimination: false },
	{ orderNo: 10, roundLabel: '敗部第二輪', format: 'BO3', isElimination: true },
	{ orderNo: 11, roundLabel: '敗部決賽', format: 'BO3', isElimination: true },
	{ orderNo: 12, roundLabel: '總決賽', format: 'BO5', isElimination: true },
	{ orderNo: 13, roundLabel: '加賽（敗部冠軍勝出時觸發）', format: 'BO5', isElimination: true }
];
