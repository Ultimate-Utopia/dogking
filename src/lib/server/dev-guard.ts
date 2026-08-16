/**
 * 開發用端點的雙重防護。
 *
 * 原本只檢查「是不是開發模式」，那擋得住正式站，卻擋不住
 * 「本機開發模式 + .env 指向正式資料庫」這個組合 ——
 * 而那正是實際發生過的事：
 *
 *   跑 migration 時把正式站的連線字串填進本機 .env，
 *   忘了切回來，接著執行的自我測試就在正式資料庫建立了測試帳號。
 *   （被中途中斷，連自清都沒跑完。）
 *
 * 更糟的情況只差一步：同樣的狀態下打開 /dev/demo?reset=1，
 * 會清空正式站的所有下注與盤口。活動當天遇到就沒救了。
 *
 * 所以這裡改成同時檢查「開發模式」與「連的是本機資料庫」。
 */

import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

/** 視為本機的主機名。其餘一律當成遠端。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal', 'db']);

export function databaseHost(): string {
	try {
		return new URL(env.DATABASE_URL ?? '').hostname;
	} catch {
		return '(無法解析)';
	}
}

export function isLocalDatabase(): boolean {
	const host = databaseHost();
	return LOCAL_HOSTS.has(host) || host.endsWith('.local');
}

/**
 * 開發端點的入口守衛。正式環境當作不存在，
 * 連到遠端資料庫時則明確拒絕並說明原因。
 */
export function requireLocalDev(): void {
	if (!dev) error(404, 'Not found');

	if (!isLocalDatabase()) {
		error(
			403,
			`開發端點已封鎖：目前的 DATABASE_URL 指向 ${databaseHost()}，不是本機資料庫。\n\n` +
				'這些端點會建立或刪除資料（/dev/demo?reset=1 會清空所有下注與盤口），' +
				'因此只允許在連到本機資料庫時執行。\n\n' +
				'若你剛才是為了對正式站跑 migration 才改的，請把 .env 的 DATABASE_URL 切回 ' +
				'postgres://dogking:dogking@localhost:5433/dogking 再重啟開發伺服器。'
		);
	}
}
