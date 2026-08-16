import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCodeForProfile } from '$lib/server/discord';
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

	const profile = await exchangeCodeForProfile(code);
	const user = await upsertUserFromDiscord(profile);
	await createSession(user.id, cookies);

	redirect(302, '/');
};
