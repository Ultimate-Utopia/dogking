<script lang="ts">
	import { onMount } from 'svelte';
	import './overlay.css';

	/**
	 * OBS 直播疊圖 —— 對應規格書 §04「直播 Overlay」
	 *
	 * 設計前提與一般網頁完全不同：
	 *   - 背景必須透明，才能疊在遊戲畫面或攝影機上
	 *   - 觀眾是在手機上看被壓縮過的串流，字要夠大、對比要夠強
	 *   - 沒有任何互動元素，純顯示
	 *   - 不跟隨系統深淺色（OBS 沒有這個概念），自帶固定配色
	 *
	 * 檔名的 @ 是刻意的：讓這一頁跳出根 layout，
	 * 不套用前台的 app.css 與版面容器。
	 *
	 * 網址參數：
	 *   ?view=board|leaderboard   顯示賭盤或排行榜，預設 board
	 *   ?anchor=tl|tr|bl|br|tc|bc 貼齊位置，預設 tl
	 *   ?scale=1.4               整體縮放，預設 1
	 *   ?debug=1                 顯示外框，方便在 OBS 裡對位
	 */

	interface Market {
		id: number;
		gameNo: number;
		label: string;
		state: string;
		poolBlue: number;
		poolRed: number;
		total: number;
		oddsBlue: number | null;
		oddsRed: number | null;
		lockAt: string | null;
		winnerSide: string | null;
	}

	interface BoardMatch {
		orderNo: number;
		roundLabel: string;
		blueName: string | null;
		redName: string | null;
		blueDoro: string | null;
		redDoro: string | null;
		scoreBlue: number;
		scoreRed: number;
	}

	let current = $state<BoardMatch | null>(null);
	let markets = $state<Market[]>([]);
	let ranks = $state<Array<{ rank: number; displayName: string; balance: number }>>([]);
	let clockSkew = $state(0);
	let tick = $state(Date.now());

	let view = $state('board');
	let anchor = $state('tl');
	let scale = $state(1);
	let debug = $state(false);
	let pinnedGame = $state<number | null>(null);

	const fmt = (n: number) => n.toLocaleString('zh-TW');

	/**
	 * 要播哪一個盤口。
	 *
	 * 優先序刻意把「正在倒數的」排第一 —— 那是主播當下在講的盤口，
	 * 也是觀眾最需要看到剩幾秒的。整場盤雖然排在小局前面，
	 * 但通常早就開著了，沒有急迫性。
	 *
	 * 想固定顯示某一個可用 ?game=0（整場）或 ?game=1（第一局）。
	 */
	const active = $derived.by(() => {
		if (pinnedGame !== null) {
			return markets.find((m) => m.gameNo === pinnedGame) ?? null;
		}
		return (
			markets.find((m) => m.state === 'open' && m.lockAt) ??
			markets.find((m) => m.state === 'open') ??
			markets.find((m) => m.state === 'locked') ??
			markets[markets.length - 1] ??
			null
		);
	});

	const secs = $derived.by(() => {
		if (!active?.lockAt) return null;
		const ms = new Date(active.lockAt).getTime() - (tick + clockSkew);
		return ms > 0 ? Math.ceil(ms / 1000) : 0;
	});

	const mmss = (s: number) =>
		`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

	const statusText = $derived.by(() => {
		if (!active) return '準備中';
		if (active.state === 'open') return secs !== null && secs <= 0 ? '已封盤' : '開放下注';
		if (active.state === 'locked') return '已封盤';
		if (active.state === 'settled') return '已開獎';
		if (active.state === 'void') return '已取消';
		return '準備中';
	});

	const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 50);

	async function refresh() {
		try {
			const b = await fetch('/api/board').then((r) => r.json());
			current = b.current;
			markets = b.markets;
			clockSkew = new Date(b.now).getTime() - Date.now();

			if (view === 'leaderboard') {
				const l = await fetch('/api/leaderboard').then((r) => r.json());
				ranks = l.rows;
			}
		} catch {
			// 直播中不該因為一次網路瞬斷就整塊消失，保留上一次的畫面
		}
	}

	onMount(() => {
		const q = new URLSearchParams(location.search);
		view = q.get('view') === 'leaderboard' ? 'leaderboard' : 'board';
		anchor = q.get('anchor') ?? 'tl';
		scale = Number(q.get('scale')) || 1;
		debug = q.get('debug') === '1';
		const g = q.get('game');
		pinnedGame = g !== null && g !== '' && Number.isInteger(Number(g)) ? Number(g) : null;

		refresh();
		const poll = setInterval(refresh, 3000);
		const clock = setInterval(() => (tick = Date.now()), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(clock);
		};
	});
</script>

<svelte:head>
	<title>直播疊圖</title>
</svelte:head>

<div class="stage anchor-{anchor}">
	<div class="scaler" style="--s:{scale}">
		{#if view === 'leaderboard'}
			<!-- ── 排行榜 ─────────────────────────────────── -->
			<div class="panel {debug ? 'debug' : ''}">
				<div class="head">
					<span class="head-title">籌碼排行榜</span>
					<span class="head-sub">TOP 5</span>
				</div>
				<div class="ranks">
					{#each ranks as r (r.rank)}
						<div class="rank">
							<span class="rank-no r{r.rank}">{r.rank}</span>
							<span class="rank-name">{r.displayName}</span>
							<span class="rank-val">{fmt(r.balance)}</span>
						</div>
					{:else}
						<div class="empty">尚無資料</div>
					{/each}
				</div>
			</div>
		{:else if current && active}
			<!-- ── 賭盤 ───────────────────────────────────── -->
			<div class="panel {debug ? 'debug' : ''}">
				<div class="head">
					<span class="head-title">第 {current.orderNo} 場・{current.roundLabel}</span>
					<span class="head-sub">{active.label}</span>
					<span class="status s-{active.state}">{statusText}</span>
				</div>

				{#if active.state === 'open' && secs !== null && secs > 0}
					<div class="timer {secs <= 10 ? 'urgent' : ''}">
						<span class="timer-lab">封盤倒數</span>
						<span class="timer-val">{mmss(secs)}</span>
					</div>
				{/if}

				<div class="duel">
					<div class="team blue">
						{#if current.blueDoro}
							<img class="art" src="/participants/{current.blueDoro}-sm.webp" alt="" />
						{/if}
						<div class="team-txt">
							<div class="team-name">{current.blueName ?? '藍方'}</div>
							<div class="team-odds">{active.oddsBlue ? active.oddsBlue.toFixed(2) : '—'}</div>
						</div>
					</div>
					<div class="score">{current.scoreBlue}<span>:</span>{current.scoreRed}</div>
					<div class="team red">
						<div class="team-txt">
							<div class="team-name">{current.redName ?? '紅方'}</div>
							<div class="team-odds">{active.oddsRed ? active.oddsRed.toFixed(2) : '—'}</div>
						</div>
						{#if current.redDoro}
							<img class="art flip" src="/participants/{current.redDoro}-sm.webp" alt="" />
						{/if}
					</div>
				</div>

				<div class="bar">
					<div class="fill-b" style="flex:{active.poolBlue || 1}"></div>
					<div class="fill-r" style="flex:{active.poolRed || 1}"></div>
				</div>
				<div class="legend">
					<span>{pct(active.poolBlue, active.total)}%　{fmt(active.poolBlue)}</span>
					<span class="pot">總彩池 {fmt(active.total)}</span>
					<span>{fmt(active.poolRed)}　{pct(active.poolRed, active.total)}%</span>
				</div>
			</div>
		{:else}
			<div class="panel {debug ? 'debug' : ''}">
				<div class="empty">賽事準備中</div>
			</div>
		{/if}
	</div>
</div>
