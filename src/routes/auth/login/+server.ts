import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { buildAuthorizeUrl } from '$lib/server/discord';

const STATE_COOKIE = 'dogking_oauth_state';

export const GET: RequestHandler = async ({ cookies }) => {
	// state 防 CSRF：存進 cookie，callback 時必須對得上
	const state = crypto.randomUUID();

	cookies.set(STATE_COOKIE, state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 10
	});

	redirect(302, buildAuthorizeUrl(state));
};
