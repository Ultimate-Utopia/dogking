/**
 * 排行榜獎品 —— 後台編輯、前台顯示。
 *
 * 所有函式都接受可選的 tx，讓測試能包在一個最後會回滾的交易裡跑，
 * 不會在資料庫留下測試資料（見 scripts/_ 開頭的暫時性測試做法）。
 */
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { prizes } from './db/schema';
import type { PrizeInput } from './prize-image';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface PublicPrize {
	id: number;
	sortOrder: number;
	ranksLabel: string;
	name: string;
	features: string[];
	/** 沒有圖時為 null，前台顯示「示意圖準備中」 */
	imageUrl: string | null;
}

/** 前台與後台列表共用。刻意不 select image_data —— 圖片走自己的端點。 */
export async function listPrizes(tx: Executor = db): Promise<PublicPrize[]> {
	const rows = await tx
		.select({
			id: prizes.id,
			sortOrder: prizes.sortOrder,
			ranksLabel: prizes.ranksLabel,
			name: prizes.name,
			features: prizes.features,
			imageVersion: prizes.imageVersion
		})
		.from(prizes)
		.orderBy(asc(prizes.sortOrder), asc(prizes.id));

	return rows.map((r) => ({
		id: r.id,
		sortOrder: r.sortOrder,
		ranksLabel: r.ranksLabel,
		name: r.name,
		features: r.features ?? [],
		imageUrl: r.imageVersion ? `/prizes/image/${r.id}?v=${r.imageVersion}` : null
	}));
}

export async function createPrize(input: PrizeInput, tx: Executor = db) {
	const [row] = await tx.insert(prizes).values(input).returning({ id: prizes.id });
	return row.id;
}

export async function updatePrize(id: number, input: PrizeInput, tx: Executor = db) {
	const rows = await tx
		.update(prizes)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(prizes.id, id))
		.returning({ id: prizes.id });
	return rows.length > 0;
}

export async function deletePrize(id: number, tx: Executor = db) {
	const rows = await tx.delete(prizes).where(eq(prizes.id, id)).returning({ id: prizes.id });
	return rows.length > 0;
}

export async function setPrizeImage(
	id: number,
	image: { bytes: Buffer; type: string; version: string } | null,
	tx: Executor = db
) {
	const rows = await tx
		.update(prizes)
		.set({
			imageData: image?.bytes ?? null,
			imageType: image?.type ?? null,
			imageVersion: image?.version ?? null,
			updatedAt: new Date()
		})
		.where(eq(prizes.id, id))
		.returning({ id: prizes.id });
	return rows.length > 0;
}

export async function getPrizeImage(id: number, tx: Executor = db) {
	const [row] = await tx
		.select({ data: prizes.imageData, type: prizes.imageType, version: prizes.imageVersion })
		.from(prizes)
		.where(eq(prizes.id, id))
		.limit(1);
	return row?.data && row.type ? row : null;
}
