import { redirect, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCodeForProfile, DiscordAuthError } from '$lib/server/discord';
import { upsertUserFromDiscord, createSession } from '$lib/server/auth';

const STATE_COOKIE = 'dogking_oauth_state';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expectedState = cookies.get(STATE_COOKIE);

	cookies.delete(STATE_COOKIE, { path: '/' });

	// 使用者在 Discord 按了取消
	if (url.searchParams.get('error')) {
		redirect(302, '/?login=cancelled');
	}

	if (!code) {
		error(400, '授權碼遺失，請重新登入。');
	}

	if (!state || state !== expectedState) {
		error(400, '登入驗證失敗，請重新登入。');
	}

	/**
	 * 每一步都獨立處理錯誤。
	 *
	 * 原本整段沒有 try/catch，任何一步失敗都變成沒有內容的 500 ——
	 * 上線後看到的只有「function crashed」，完全無從判斷是
	 * Discord 憑證不對、資料庫連不上、還是別的問題。
	 */
	let profile;
	try {
		profile = await exchangeCodeForProfile(code);
	} catch (e) {
		if (e instanceof DiscordAuthError) {
			error(502, `Discord 授權失敗：${e.message}`);
		}
		error(502, '無法連線到 Discord，請稍後再試。');
	}

	try {
		const user = await upsertUserFromDiscord(profile);
		await createSession(user.id, cookies);
	} catch (e) {
		if (isHttpError(e) || isRedirect(e)) throw e;
		console.error('[auth/callback] 建立帳號或工作階段失敗', e);
		error(500, '登入資料寫入失敗，請稍後再試。若持續發生請聯繫主辦方。');
	}

	redirect(302, '/');
};
