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

		/** 參賽主播。允許下注，但標記起來供事後查核（規格書 §10 內線風險）。 */
		isParticipant: boolean('is_participant').notNull().default(false),
		isAdmin: boolean('is_admin').notNull().default(false),

		/** active | frozen */
		status: text('status').notNull().default('active'),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('users_discord_id_idx').on(t.discordId)]
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

	/** 對戰雙方。雙敗淘汰下，晚期場次要等前面打完才確定，因此可為 null。 */
	blueUserId: uuid('blue_user_id').references(() => users.id),
	redUserId: uuid('red_user_id').references(() => users.id),

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
		/** 小局盤的局數（1 起算）。整場盤為 null。 */
		gameNo: integer('game_no'),

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
