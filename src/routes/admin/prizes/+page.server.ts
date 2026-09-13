import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { requireAdmin, logAdmin } from '$lib/server/admin';
import { listPrizes, createPrize, updatePrize, deletePrize, setPrizeImage } from '$lib/server/prizes';
import { parsePrizeInput, decodeImageDataUrl, PrizeInputError } from '$lib/server/prize-image';

export const load: PageServerLoad = async () => {
	return { prizes: await listPrizes() };
};

/** 驗證錯誤給看得懂的訊息，其他錯誤不外洩細節 */
function toFail(e: unknown) {
	if (e instanceof PrizeInputError) return fail(400, { error: e.message });
	console.error('[admin/prizes]', e);
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
			const input = parsePrizeInput(Object.fromEntries(form));
			const id = await createPrize(input);
			await logAdmin(admin.id, '新增獎品', `獎品 ${id}`, input);
			return { success: `已新增「${input.name}」` };
		} catch (e) {
			return toFail(e);
		}
	},

	update: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { error: '找不到這個獎品' });

		try {
			const input = parsePrizeInput(Object.fromEntries(form));
			if (!(await updatePrize(id, input))) return fail(404, { error: '找不到這個獎品，可能已被刪除' });
			await logAdmin(admin.id, '修改獎品', `獎品 ${id}`, input);
			return { success: `已儲存「${input.name}」` };
		} catch (e) {
			return toFail(e);
		}
	},

	/** 圖片另外存：只換圖時不必重送文字欄位，也不會因為文字驗證失敗而連圖一起丟掉 */
	setImage: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const form = await request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { error: '找不到這個獎品' });

		try {
			const image = decodeImageDataUrl(String(form.get('image') ?? ''));
			if (!(await setPrizeImage(id, image))) return fail(404, { error: '找不到這個獎品，可能已被刪除' });
			// 圖片本身不寫進紀錄，只記大小與版本
			await logAdmin(admin.id, '更換獎品圖片', `獎品 ${id}`, {
				type: image.type,
				bytes: image.bytes.length,
				version: image.version
			});
			return { success: '圖片已更新' };
		} catch (e) {
			return toFail(e);
		}
	},

	clearImage: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const id = idOf(await request.formData());
		if (!id) return fail(400, { error: '找不到這個獎品' });

		await setPrizeImage(id, null);
		await logAdmin(admin.id, '移除獎品圖片', `獎品 ${id}`);
		return { success: '已移除圖片，前台會顯示「示意圖準備中」' };
	},

	delete: async ({ request, locals }) => {
		const admin = requireAdmin(locals.user);
		const id = idOf(await request.formData());
		if (!id) return fail(400, { error: '找不到這個獎品' });

		if (!(await deletePrize(id))) return fail(404, { error: '找不到這個獎品，可能已被刪除' });
		await logAdmin(admin.id, '刪除獎品', `獎品 ${id}`);
		return { success: '已刪除' };
	}
};
