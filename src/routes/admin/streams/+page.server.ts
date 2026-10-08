import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import { participants } from '$lib/server/db/schema';
import { requireAdmin, logAdmin } from '$lib/server/admin';
import {
	listStreams,
	createStream,
	updateStream,
	deleteStream,
	parseStreamInput,
	StreamInputError
} from '$lib/server/streams';

export const load: PageServerLoad = async () => {
	const [streams, people] = await Promise.all([
		listStreams(),
		db
			.select({ id: participants.id, name: participants.name })
			.from(participants)
			.where(eq(participants.role, 'player'))
			.orderBy(asc(participants.orderNo))
	]);
	return { streams, people };
};

function toFail(e: unknown) {
	if (e instanceof StreamInputError) return fail(400, { error: e.message });
	console.error('[admin/streams]', e);
	return fail(500, { error: '儲存失敗，請再試一次' });
}

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		try {
			const input = parseStreamInput(Object.fromEntries(form));
			const id = await createStream(input);
			await logAdmin(admin.id, '新增實況影片', `影片 ${id}`, input);
			return { success: `已新增「${input.title}」` };
		} catch (e) {
			return toFail(e);
		}
	},

	update: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { error: '找不到這支影片' });
		try {
			const input = parseStreamInput(Object.fromEntries(form));
			if (!(await updateStream(id, input))) return fail(404, { error: '找不到這支影片，可能已被刪除' });
			await logAdmin(admin.id, '修改實況影片', `影片 ${id}`, input);
			return { success: `已儲存「${input.title}」` };
		} catch (e) {
			return toFail(e);
		}
	},

	delete: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const id = idOf(await request.formData());
		if (!id) return fail(400, { error: '找不到這支影片' });
		if (!(await deleteStream(id))) return fail(404, { error: '找不到這支影片，可能已被刪除' });
		await logAdmin(admin.id, '刪除實況影片', `影片 ${id}`);
		return { success: '已刪除' };
	}
};
