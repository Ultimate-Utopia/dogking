/**
 * 資料模型 —— 對應規格書 §07
 *
 * 核心原則：ledger 是唯一真相來源。
 * 使用者餘額永遠由 ledger 加總得出，不存在「餘額欄位」這種可以被直接改壞的東西。
 */

import {
	pgTable,
	text,
	uuid,
	boolean,
	integer,
	bigint,
	timestamp,
	jsonb,
	bigserial,
	serial,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';

/** 陣營。藍方 / 紅方，對應前台看板左右兩側。 */
export type Side = 'blue' | 'red';

// ─────────────────────────────────────────────────────────
// users —— 觀眾與工作人員
// ─────────────────────────────────────────────────────────
export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),

		/** Discord 使用者 ID。我們只索取 identify 權限，不取得 email。 */
		discordId: text('discord_id').notNull(),
		displayName: text('display_name').notNull(),
		avatarUrl: text('avatar_url'),

		/**
		 * 公開短代碼，例如 K7M2QX。
		 *
		 * 買周邊時要填進訂單備註，後台才能把訂單對到帳號（規格書 §08）。
		 * 內部 id 是 UUID，沒有人會把 36 個字元抄進賣貨便的備註欄。
		 *
		 * 字母表刻意排除 0/O/1/I/L —— 手寫或口述時最容易看錯的幾個。
		 */
		publicCode: text('public_code'),

		/** 參賽主播。允許下注，但標記起來供事後查核（規格書 §10 內線風險）。 */
		isParticipant: boolean('is_participant').notNull().default(false),
		isAdmin: boolean('is_admin').notNull().default(false),

		/** active | frozen */
		status: text('status').notNull().default('active'),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('users_discord_id_idx').on(t.discordId),
		uniqueIndex('users_public_code_idx').on(t.publicCode)
	]
);

// ─────────────────────────────────────────────────────────
// sessions —— 登入工作階段（伺服器端，非 JWT）
// ─────────────────────────────────────────────────────────
export const sessions = pgTable(
	'sessions',
	{
		/** 隨機 token，同時作為 cookie 值 */
		id: text('id').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('sessions_user_id_idx').on(t.userId)]
);

// ─────────────────────────────────────────────────────────
// participants —— 9 位參賽主播
//
// 刻意與 users 分開：參賽者是「賽事實體」（有頻道、立繪、戰績），
// users 是「觀眾帳號」（Discord 登入建立）。主播不一定會註冊網站帳號，
// 硬塞進 users 就得偽造 discord_id。
//
// 若某位主播同時也是觀眾（規格書決策 E：參賽者可下注），
// 那是另一筆獨立的 users 資料，以 users.is_participant 標記。
// ─────────────────────────────────────────────────────────
export const participants = pgTable('participants', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),

	/**
	 * player = 9 位參賽主播，只有這些能被指派到場次
	 * host   = 主持與副台（語風薯薯、可樂月月、艾絲梅亞），只在賽況資訊區露出
	 */
	role: text('role').notNull().default('player'),
	/** 主持人的職稱，例如「主持人」「同步視聽」 */
	roleLabel: text('role_label'),

	/** 頻道連結，賽況資訊區點擊導向 */
	channelUrl: text('channel_url'),

	/**
	 * DORO 立繪的 slug，例如 youyou。
	 *
	 * 實際檔案是 /participants/{slug}-sm.webp 與 -lg.webp，
	 * 由 scripts/build-participant-images.mjs 產生。
	 * 存 slug 而非完整路徑，之後要換尺寸或格式不用改資料。
	 */
	doroSlug: text('doro_slug'),

	/** 顯示順序 */
	orderNo: integer('order_no').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// ─────────────────────────────────────────────────────────
// matches —— 場次 1～13（含條件觸發的加賽）
// ─────────────────────────────────────────────────────────
export const matches = pgTable('matches', {
	id: serial('id').primaryKey(),

	/** 場次編號 1～13。加賽為 13，賽程未觸發時不建立。 */
	orderNo: integer('order_no').notNull(),
	/** 例：勝部第一輪 / 敗部第二輪 / 總決賽 */
	roundLabel: text('round_label').notNull(),
	/** BO1 | BO3 | BO5 */
	format: text('format').notNull(),
	/** 輸者淘汰（規格書：場次 7～11、12、13） */
	isElimination: boolean('is_elimination').notNull().default(false),

	/** 對戰雙方。雙敗淘汰下，晚期場次要等前面打完才確定，因此可為 null。 */
	blueParticipantId: integer('blue_participant_id').references(() => participants.id),
	redParticipantId: integer('red_participant_id').references(() => participants.id),

	/** pending | live | done | void */
	state: text('state').notNull().default('pending'),

	scoreBlue: integer('score_blue').notNull().default(0),
	scoreRed: integer('score_red').notNull().default(0),
	/** blue | red | null */
	winnerSide: text('winner_side'),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// ─────────────────────────────────────────────────────────
// markets —— 盤口。整場盤與小局盤共用同一個抽象。
// ─────────────────────────────────────────────────────────
export const markets = pgTable(
	'markets',
	{
		id: serial('id').primaryKey(),
		matchId: integer('match_id')
			.notNull()
			.references(() => matches.id, { onDelete: 'cascade' }),

		/** match = 整場盤，game = 小局盤 */
		type: text('type').notNull(),
		/**
		 * 0 = 整場盤，1 以上 = 第 N 小局。
		 *
		 * 刻意用 0 而非 NULL：Postgres 唯一索引把 NULL 視為互不相同，
		 * 若整場盤的 game_no 是 NULL，下面的唯一索引就擋不住重複建立。
		 */
		gameNo: integer('game_no').notNull().default(0),

		/** pending | open | locked | settled | void */
		state: text('state').notNull().default('pending'),

		/** 彩池累計。以 bigint 儲存，避免大額下注溢位。 */
		poolBlue: bigint('pool_blue', { mode: 'number' }).notNull().default(0),
		poolRed: bigint('pool_red', { mode: 'number' }).notNull().default(0),

		/** blue | red | null */
		winnerSide: text('winner_side'),

		/** 預定封盤時間。操作員按下倒數後才有值，前台據此顯示計時器。 */
		lockAt: timestamp('lock_at', { withTimezone: true }),

		openedAt: timestamp('opened_at', { withTimezone: true }),
		lockedAt: timestamp('locked_at', { withTimezone: true }),
		settledAt: timestamp('settled_at', { withTimezone: true })
	},
	(t) => [
		index('markets_match_id_idx').on(t.matchId),
		index('markets_state_idx').on(t.state),
		// 同一場次的同一個盤口不可重複建立
		uniqueIndex('markets_match_type_game_idx').on(t.matchId, t.type, t.gameNo)
	]
);

// ─────────────────────────────────────────────────────────
// bets —— 下注
// ─────────────────────────────────────────────────────────
export const bets = pgTable(
	'bets',
	{
		id: serial('id').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id),
		marketId: integer('market_id')
			.notNull()
			.references(() => markets.id),

		/** blue | red */
		side: text('side').notNull(),
		amount: bigint('amount', { mode: 'number' }).notNull(),

		/** pending | won | lost | refunded */
		state: text('state').notNull().default('pending'),
		/** 派彩金額（含本金）。未結算為 0。 */
		payout: bigint('payout', { mode: 'number' }).notNull().default(0),

		/** 冪等鍵，防止連點造成重複下注（規格書 §05） */
		idempotencyKey: text('idempotency_key').notNull(),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('bets_idempotency_key_idx').on(t.idempotencyKey),
		index('bets_user_id_idx').on(t.userId),
		index('bets_market_id_idx').on(t.marketId)
	]
);

// ─────────────────────────────────────────────────────────
// ledger —— 狗狗幣帳本。唯一真相來源，只新增不修改。
// ─────────────────────────────────────────────────────────

/** signup 註冊贈送 / purchase 周邊訂單 / bet 下注扣款 / payout 派彩 / refund 退款 / adjust 人工調整 */
export type LedgerType = 'signup' | 'purchase' | 'bet' | 'payout' | 'refund' | 'adjust';

export const ledger = pgTable(
	'ledger',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id),

		type: text('type').notNull(),
		/** 有號數。下注為負，派彩為正。 */
		amount: bigint('amount', { mode: 'number' }).notNull(),
		/** 寫入當下的餘額快照，供對帳。爭議時仍以 SUM(amount) 為準。 */
		balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),

		refMarketId: integer('ref_market_id').references(() => markets.id),
		refBetId: integer('ref_bet_id').references(() => bets.id),
		note: text('note'),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('ledger_user_id_idx').on(t.userId), index('ledger_type_idx').on(t.type)]
);

// ─────────────────────────────────────────────────────────
// purchase_orders —— 周邊訂單發幣紀錄（規格書 §08 主線路徑）
//
// order_ref 設唯一索引是這張表的重點：後台匯入同一份 CSV 兩次時，
// 第二次會被資料庫擋下，不會有人拿到雙倍狗狗幣。
// ─────────────────────────────────────────────────────────
export const purchaseOrders = pgTable(
	'purchase_orders',
	{
		id: serial('id').primaryKey(),
		/** 賣貨便 / 綠界 / 其他 */
		platform: text('platform').notNull(),
		/** 平台上的訂單編號 */
		orderRef: text('order_ref').notNull(),
		amountTwd: integer('amount_twd').notNull(),
		chips: bigint('chips', { mode: 'number' }).notNull(),

		/** 比對到的帳號 */
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id),
		/** 訂單備註上填的代碼原文，供事後查核 */
		publicCode: text('public_code'),

		adminUserId: uuid('admin_user_id').references(() => users.id),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('purchase_orders_ref_idx').on(t.platform, t.orderRef),
		index('purchase_orders_user_idx').on(t.userId)
	]
);

// ─────────────────────────────────────────────────────────
// redeem_codes —— 兌換碼（規格書 §08 補救路徑）
// 用於買家漏填網站 ID 時發幣，此路徑不需要知道買家身分。
// ─────────────────────────────────────────────────────────
export const redeemCodes = pgTable('redeem_codes', {
	code: text('code').primaryKey(),
	amount: bigint('amount', { mode: 'number' }).notNull(),
	/** 對應的訂單編號，供對帳 */
	orderRef: text('order_ref'),

	usedByUserId: uuid('used_by_user_id').references(() => users.id),
	usedAt: timestamp('used_at', { withTimezone: true }),

	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// ─────────────────────────────────────────────────────────
// admin_logs —— 後台操作紀錄。誰在幾點對哪個盤口做了什麼。
// ─────────────────────────────────────────────────────────
export const adminLogs = pgTable(
	'admin_logs',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		adminUserId: uuid('admin_user_id')
			.notNull()
			.references(() => users.id),
		action: text('action').notNull(),
		target: text('target'),
		payload: jsonb('payload'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('admin_logs_admin_user_id_idx').on(t.adminUserId)]
);
