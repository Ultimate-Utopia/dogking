import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, resolveSession } from '$lib/server/auth';

/** 每個請求都先解析 session，結果放進 locals 供後續 load 與 action 使用。 */
export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = await resolveSession(token);
	return resolve(event);
};
