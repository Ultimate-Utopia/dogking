/**
 * 登入工作階段 —— 伺服器端 session，不是 JWT。
 *
 * 選 session 而非 JWT 是為了「後台能凍結帳號」（規格書 §10 小號防堵）：
 * session 存在資料庫，刪掉就立即失效；JWT 在過期前無法撤銷。
 */

import { eq, and, gt, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { sessions, users, ledger } from './db/schema';
import type { DiscordProfile } from './discord';
import { generatePublicCode } from './purchase';

export const SESSION_COOKIE = 'dogking_session';
const SESSION_DAYS = 30;

export interface SessionUser {
	id: string;
	displayName: string;
	avatarUrl: string | null;
	/** 買周邊時要填進訂單備註的短代碼（規格書 §08） */
	publicCode: string | null;
	isAdmin: boolean;
	isParticipant: boolean;
	status: string;
}

function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 依 Discord 資料找出或建立使用者。
 *
 * 首次登入時在同一個交易內發放註冊獎勵，確保「建立帳號」與「發幣」
 * 要嘛都成功、要嘛都失敗，不會出現有帳號卻沒拿到幣的狀況。
 */
export async function upsertUserFromDiscord(profile: DiscordProfile): Promise<SessionUser> {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(users)
			.where(eq(users.discordId, profile.discordId))
			.limit(1);

		if (existing) {
			// 暱稱和頭像可能改過，每次登入同步一次。
			// 順便補上公開代碼，讓這個欄位新增之前就註冊的人也有。
			const [updated] = await tx
				.update(users)
				.set({
					displayName: profile.displayName,
					avatarUrl: profile.avatarUrl,
					publicCode: existing.publicCode ?? (await generatePublicCode(tx))
				})
				.where(eq(users.id, existing.id))
				.returning();
			return toSessionUser(updated);
		}

		const [created] = await tx
			.insert(users)
			.values({
				discordId: profile.discordId,
				displayName: profile.displayName,
				avatarUrl: profile.avatarUrl,
				publicCode: await generatePublicCode(tx)
			})
			.returning();

		const bonus = Number(env.SIGNUP_BONUS ?? 1000);
		if (bonus > 0) {
			await tx.insert(ledger).values({
				userId: created.id,
				type: 'signup',
				amount: bonus,
				balanceAfter: bonus,
				note: '註冊贈送'
			});
		}

		return toSessionUser(created);
	});
}

function toSessionUser(u: typeof users.$inferSelect): SessionUser {
	return {
		id: u.id,
		displayName: u.displayName,
		avatarUrl: u.avatarUrl,
		publicCode: u.publicCode,
		isAdmin: u.isAdmin,
		isParticipant: u.isParticipant,
		status: u.status
	};
}

export async function createSession(userId: string, cookies: Cookies): Promise<void> {
	const token = randomToken();
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

	await db.insert(sessions).values({ id: token, userId, expiresAt });

	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		expires: expiresAt
	});
}

/** 由 cookie 取回使用者。無效、過期或帳號凍結一律回 null。 */
export async function resolveSession(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;

	const [row] = await db
		.select({ user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
		.limit(1);

	if (!row) return null;
	if (row.user.status !== 'active') return null;

	return toSessionUser(row.user);
}

export async function destroySession(token: string | undefined, cookies: Cookies): Promise<void> {
	if (token) {
		await db.delete(sessions).where(eq(sessions.id, token));
	}
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** 清掉過期 session。之後可掛在排程或後台按鈕上。 */
export async function purgeExpiredSessions(): Promise<void> {
	await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
