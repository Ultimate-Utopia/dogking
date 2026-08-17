import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLeaderboard } from '$lib/server/board';

/** 排行榜要把整張帳本加總，比看板貴，所以快取 60 秒。 */
export const GET: RequestHandler = async ({ setHeaders }) => {
	const rows = await getLeaderboard(5);

	setHeaders({
		'Cache-Control': 'public, max-age=60, stale-while-revalidate=600'
	});

	return json({ rows });
};
