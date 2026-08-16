/**
 * Discord OAuth2 —— 對應規格書 §02
 *
 * 刻意手寫而非使用 auth 套件，原因是這個活動的設計目標之一就是
 * 「蒐集最少的個資」。手寫可以確保我們清楚知道每一個欄位從哪來、存了什麼。
 *
 * scope 只有 identify：我們拿得到 Discord ID、暱稱、頭像，
 * 拿不到 email、真名或任何聯絡方式。
 */

import { env } from '$env/dynamic/private';

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

/** 只要 identify。永遠不要加上 email。 */
const SCOPE = 'identify';

function requireConfig() {
	const clientId = env.DISCORD_CLIENT_ID;
	const clientSecret = env.DISCORD_CLIENT_SECRET;
	const redirectUri = env.DISCORD_REDIRECT_URI;

	if (!clientId || !clientSecret || !redirectUri) {
		throw new Error(
			'Discord OAuth 未設定。請在 .env 填入 DISCORD_CLIENT_ID、DISCORD_CLIENT_SECRET、DISCORD_REDIRECT_URI。'
		);
	}
	return { clientId, clientSecret, redirectUri };
}

/** 產生授權網址。state 用於防 CSRF，呼叫端要把它存進 cookie 並在 callback 比對。 */
export function buildAuthorizeUrl(state: string): string {
	const { clientId, redirectUri } = requireConfig();

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: SCOPE,
		state,
		prompt: 'none'
	});

	return `${AUTHORIZE_URL}?${params}`;
}

export interface DiscordProfile {
	discordId: string;
	displayName: string;
	avatarUrl: string | null;
}

/** 用授權碼換 token，再換使用者資料。 */
export async function exchangeCodeForProfile(code: string): Promise<DiscordProfile> {
	const { clientId, clientSecret, redirectUri } = requireConfig();

	const tokenRes = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri
		})
	});

	if (!tokenRes.ok) {
		throw new Error(`Discord token 交換失敗（${tokenRes.status}）：${await tokenRes.text()}`);
	}

	const { access_token } = (await tokenRes.json()) as { access_token: string };

	const userRes = await fetch(USER_URL, {
		headers: { Authorization: `Bearer ${access_token}` }
	});

	if (!userRes.ok) {
		throw new Error(`讀取 Discord 使用者失敗（${userRes.status}）`);
	}

	const user = (await userRes.json()) as {
		id: string;
		username: string;
		global_name: string | null;
		avatar: string | null;
	};

	return {
		discordId: user.id,
		// global_name 是新版 Discord 的顯示名稱，沒有的話退回 username
		displayName: user.global_name ?? user.username,
		avatarUrl: user.avatar
			? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
			: null
	};
}
