import type { PageServerLoad } from './$types';
import { listMatches } from '$lib/server/tournament';
import { recentAdminLogs } from '$lib/server/admin';

export const load: PageServerLoad = async () => {
	const [matches, logs] = await Promise.all([listMatches(), recentAdminLogs(20)]);
	return { matches, logs };
};
