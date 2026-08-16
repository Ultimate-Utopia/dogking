import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, destroySession } from '$lib/server/auth';

export const POST: RequestHandler = async ({ cookies }) => {
	await destroySession(cookies.get(SESSION_COOKIE), cookies);
	redirect(302, '/');
};
