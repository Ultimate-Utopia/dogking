/**
 * 選手實況影片 —— 後台編輯、前台輪播。
 *
 * 所有函式都接受可選的 tx，測試才能包在最後會回滾的交易裡跑。
 */
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { streams, participants } from './db/schema';
import { parseYouTubeId } from '../youtube';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class StreamInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StreamInputError';
	}
}

export interface PublicStream {
	id: number;
	sortOrder: number;
	videoId: string;
	title: string;
	/** 這支影片是誰的。沒指定時為 null。 */
	who: string | null;
	whoDoro: string | null;
}

export async function listStreams(tx: Executor = db): Promise<PublicStream[]> {
	const rows = await tx
		.select({
			id: streams.id,
			sortOrder: streams.sortOrder,
			videoId: streams.videoId,
			title: streams.title,
			who: participants.name,
			whoDoro: participants.doroSlug
		})
		.from(streams)
		.leftJoin(participants, eq(streams.participantId, participants.id))
		.orderBy(asc(streams.sortOrder), asc(streams.id));

	return rows.map((r) => ({ ...r, who: r.who ?? null, whoDoro: r.whoDoro ?? null }));
}

export interface StreamInput {
	videoId: string;
	title: string;
	sortOrder: number;
	participantId: number | null;
}

/** 後台表單 → 影片欄位。網址什麼形式都接受，一律轉成影片 ID。 */
export function parseStreamInput(fields: {
	url?: unknown;
	title?: unknown;
	sortOrder?: unknown;
	participantId?: unknown;
}): StreamInput {
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

	const videoId = parseYouTubeId(str(fields.url));
	if (!videoId) {
		throw new StreamInputError('認不出這個 YouTube 網址，請貼影片或直播的連結');
	}

	const title = str(fields.title);
	if (!title) throw new StreamInputError('請填寫影片標題');
	if (title.length > 80) throw new StreamInputError('標題最多 80 字');

	const sortOrder = Number(str(fields.sortOrder) || 0);
	if (!Number.isInteger(sortOrder)) throw new StreamInputError('顯示順序請填整數');

	const pid = Number(str(fields.participantId) || 0);
	return {
		videoId,
		title,
		sortOrder,
		participantId: Number.isInteger(pid) && pid > 0 ? pid : null
	};
}

export async function createStream(input: StreamInput, tx: Executor = db) {
	const [row] = await tx.insert(streams).values(input).returning({ id: streams.id });
	return row.id;
}

export async function updateStream(id: number, input: StreamInput, tx: Executor = db) {
	const rows = await tx
		.update(streams)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(streams.id, id))
		.returning({ id: streams.id });
	return rows.length > 0;
}

export async function deleteStream(id: number, tx: Executor = db) {
	const rows = await tx.delete(streams).where(eq(streams.id, id)).returning({ id: streams.id });
	return rows.length > 0;
}
