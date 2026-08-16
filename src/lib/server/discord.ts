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

/**
 * Discord 回報的錯誤。
 *
 * 刻意把 Discord 的錯誤代碼帶出來 —— 那不是機密，卻是唯一能分辨
 * 「Secret 填錯」與「redirect_uri 對不上」的線索。少了它，
 * 上線後只會看到一個沒有內容的 500，完全無從查起。
 */
export class DiscordAuthError extends Error {
	constructor(
		message: string,
		public readonly step: 'token' | 'profile',
		public readonly status: number,
		public readonly code?: string
	) {
		super(message);
		this.name = 'DiscordAuthError';
	}
}

/** 把 Discord 的錯誤代碼翻成可以直接照做的說明。 */
function explain(code: string | undefined, status: number): string {
	switch (code) {
		case 'invalid_client':
			return 'Client Secret 不正確 —— 請確認部署環境的 DISCORD_CLIENT_SECRET 與 Discord 後台目前的一致（重置過就要同步更新）。';
		case 'invalid_grant':
			return '授權碼無效或已使用過，也可能是 DISCORD_REDIRECT_URI 與 Discord 後台登記的不完全相同。';
		case 'invalid_request':
			return '請求缺少必要參數，請檢查 DISCORD_CLIENT_ID 是否有填。';
		default:
			return `Discord 回報錯誤（HTTP ${status}${code ? `，${code}` : ''}）。`;
	}
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
		// 回應內容只有錯誤代碼，不含我們送出去的憑證
		let errCode: string | undefined;
		try {
			errCode = ((await tokenRes.json()) as { error?: string }).error;
		} catch {
			errCode = undefined;
		}
		throw new DiscordAuthError(explain(errCode, tokenRes.status), 'token', tokenRes.status, errCode);
	}

	const { access_token } = (await tokenRes.json()) as { access_token: string };

	const userRes = await fetch(USER_URL, {
		headers: { Authorization: `Bearer ${access_token}` }
	});

	if (!userRes.ok) {
		throw new DiscordAuthError(
			`取得 Discord 使用者資料失敗（HTTP ${userRes.status}）。`,
			'profile',
			userRes.status
		);
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
