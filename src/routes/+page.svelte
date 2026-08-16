<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import '../app.css';
	import './board.css';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** 籌碼面額。點一次加一次，可疊出大額（企劃書 DEMO 圖的作法）。 */
	const CHIPS = [100, 500, 1000, 5000, 10000];

	/**
	 * 輪詢結果先放進 polled*，畫面再用 $derived 取「輪詢值 ?? SSR 值」。
	 *
	 * 不直接把 data 複製進 $state：那樣一旦 data 更新（例如下注成功後
	 * SvelteKit 重跑 load），本地狀態不會跟著動，畫面就會停在舊資料。
	 */
	let polledBoard = $state<typeof data.board | null>(null);
	let polledLeaderboard = $state<typeof data.leaderboard | null>(null);
	let polledBalance = $state<number | null>(null);
	let polledBets = $state<typeof data.myBets | null>(null);

	const board = $derived(polledBoard ?? data.board);
	const leaderboard = $derived(polledLeaderboard ?? data.leaderboard);
	const balance = $derived(polledBalance ?? data.balance);
	const myBets = $derived(polledBets ?? data.myBets);

	/** 伺服器與瀏覽器的時鐘差。倒數一律以伺服器時間為基準。 */
	let clockSkew = $state(0);
	let tick = $state(Date.now());

	let pickedMarket = $state<number | null>(null);
	let pickedSide = $state<'blue' | 'red' | null>(null);
	let stake = $state(0);
	let confirming = $state(false);
	let idemKey = $state('');

	const fmt = (n: number) => n.toLocaleString('zh-TW');

	/**
	 * 倒數歸零就立刻當成封盤，不等伺服器狀態同步。
	 *
	 * /api/board 有 3 秒快取，狀態改成 locked 之後畫面最多還會慢 3 秒。
	 * 那段空窗期若還顯示下注介面，使用者按下去只會拿到失敗訊息。
	 */
	function isOpen(m: (typeof board.markets)[number]) {
		if (m.state !== 'open') return false;
		const left = remaining(m.lockAt);
		return left === null || left > 0;
	}

	const openMarkets = $derived(board.markets.filter(isOpen));

	const activeMarket = $derived(
		board.markets.find((m) => m.id === pickedMarket) ?? openMarkets[0] ?? null
	);

	/** 封盤剩餘秒數，以伺服器時鐘計算。 */
	function remaining(lockAt: string | null): number | null {
		if (!lockAt) return null;
		const ms = new Date(lockAt).getTime() - (tick + clockSkew);
		return ms > 0 ? Math.ceil(ms / 1000) : 0;
	}

	function mmss(sec: number) {
		return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
	}

	/** 依目前彩池估算獲得。封盤前賠率會變，所以只是預估。 */
	const estimate = $derived.by(() => {
		if (!activeMarket || !pickedSide || stake <= 0) return 0;
		const pool = pickedSide === 'blue' ? activeMarket.poolBlue : activeMarket.poolRed;
		const total = activeMarket.total + stake;
		const winner = pool + stake;
		return winner > 0 ? Math.floor((stake * total) / winner) : 0;
	});

	const canBet = $derived(
		!!data.user && !!activeMarket && activeMarket.state === 'open' && !!pickedSide && stake > 0 && stake <= balance
	);

	/**
	 * 我在某個盤口上的持倉，同一邊的多筆合併成一列。
	 *
	 * 觀眾常常分好幾次加碼，只列原始注單會很難看出「我到底押了多少」。
	 */
	function myPositions(marketId: number) {
		const rows = myBets.filter((b) => b.marketId === marketId);
		const out: Array<{ side: 'blue' | 'red'; amount: number; payout: number; state: string }> = [];

		for (const side of ['blue', 'red'] as const) {
			const same = rows.filter((r) => r.side === side);
			if (!same.length) continue;
			out.push({
				side,
				amount: same.reduce((a, b) => a + b.amount, 0),
				payout: same.reduce((a, b) => a + b.payout, 0),
				state: same[0].state
			});
		}
		return out;
	}

	/** 依「目前」彩池估算持倉可領回多少。彩池已含自己的注，所以直接算即可。 */
	function positionEstimate(m: (typeof board.markets)[number], side: 'blue' | 'red', amount: number) {
		const pool = side === 'blue' ? m.poolBlue : m.poolRed;
		return pool > 0 ? Math.floor((amount * m.total) / pool) : 0;
	}

	/**
	 * 選擇陣營。點已選中的那邊等於取消，讓「改變主意」有路可退。
	 * 換邊時金額刻意保留 —— 觀眾常常是想比較「同樣的錢押另一邊會怎樣」。
	 */
	function pick(marketId: number, side: 'blue' | 'red') {
		if (pickedMarket === marketId && pickedSide === side) {
			pickedSide = null;
			stake = 0;
			return;
		}
		pickedMarket = marketId;
		pickedSide = side;
	}

	function addChip(v: number) {
		if (stake + v <= balance) stake += v;
		else stake = balance;
	}

	function newKey() {
		idemKey = crypto.randomUUID();
	}

	async function refresh() {
		try {
			const [b, l] = await Promise.all([
				fetch('/api/board').then((r) => r.json()),
				fetch('/api/leaderboard').then((r) => r.json())
			]);
			polledBoard = b;
			polledLeaderboard = l.rows;
			clockSkew = new Date(b.now).getTime() - Date.now();

			if (data.user) {
				const me = await fetch('/api/me').then((r) => r.json());
				polledBalance = me.balance;
				polledBets = me.bets;
			}
		} catch {
			// 網路瞬斷不需要打擾使用者，下一次輪詢會補上
		}
	}

	onMount(() => {
		newKey();
		clockSkew = new Date(board.now).getTime() - Date.now();

		// 看板每 3 秒更新一次（回應由 CDN 快取，見 /api/board 的註解）
		const poll = setInterval(refresh, 3000);
		// 倒數每秒重畫，但不打伺服器
		const clock = setInterval(() => (tick = Date.now()), 1000);

		return () => {
			clearInterval(poll);
			clearInterval(clock);
		};
	});

	$effect(() => {
		if (form?.success) {
			confirming = false;
			stake = 0;
			pickedSide = null;
			newKey();
			refresh();
		}
		if (form?.error) confirming = false;
	});
</script>

<svelte:head>
	<title>終焉狗王大賽</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && confirming) confirming = false;
	}}
/>

<!-- ── 頂部導覽列 ────────────────────────────────────── -->
<div class="topbar">
	<div class="topbar-in">
		<a class="brand" href="/">終焉狗王大賽</a>
		{#if data.user}
			<div class="purse">
				<span class="who">{data.user.displayName}</span>
				<span class="coins">{fmt(balance)}</span>
				<span class="who">狗狗幣</span>
				<a href="/coins">獲得狗狗幣</a>
				{#if data.user.isAdmin}<a href="/admin">後台</a>{/if}
				<form method="POST" action="/auth/logout" style="display:inline">
					<button
						type="submit"
						style="background:none;border:none;color:var(--muted);cursor:pointer;font-family:inherit;font-size:14px"
					>登出</button>
				</form>
			</div>
		{:else}
			<a class="btn" href="/auth/login" data-sveltekit-reload>使用 Discord 登入</a>
		{/if}
	</div>
</div>

<div class="board">
	{#if form?.success}<div class="msg-ok">{form.success}</div>{/if}
	{#if form?.error}<div class="msg-err">{form.error}</div>{/if}

	{#if !data.user}
		<div class="card2" style="margin-bottom:16px">
			<h2>還沒加入？</h2>
			<p style="margin:0 0 6px">用 Discord 登入即可領取 1,000 狗狗幣，馬上開始下注。</p>
			<p style="margin:0;font-size:12.5px;color:var(--muted)">
				僅索取 identify 權限，不會取得你的 email 或任何聯絡方式。
			</p>
		</div>
	{/if}

	<!-- ── 賽事看板 ─────────────────────────────────── -->
	{#if board.current}
		{@const c = board.current}
		<div class="stage">
			<div class="stage-top">
				<div class="round">
					第 {c.orderNo} 場・{c.roundLabel}
					<small>{c.format}{c.isElimination ? '・輸者淘汰' : ''}</small>
				</div>
				<div>
					{#if openMarkets.length > 0}
						<span class="tag t-open" style="color:var(--ok);border:1px solid var(--ok)">開放下注</span>
					{:else if board.markets.some((m) => m.state === 'locked')}
						<span class="tag" style="color:var(--red);border:1px solid var(--red)">已封盤・結算中</span>
					{:else}
						<span class="tag" style="color:var(--muted);border:1px solid var(--line)">尚未開盤</span>
					{/if}
				</div>
			</div>

			<div class="versus">
				<div class="fighter b">
					{#if c.blueDoro}
						<img class="doro" src="/participants/{c.blueDoro}-lg.webp" alt="" width="640" height="640" />
					{/if}
					<div class="tagline">藍方</div>
					<div class="nm">{c.blueName ?? '待定'}</div>
				</div>
				<div class="score">{c.scoreBlue} - {c.scoreRed}</div>
				<div class="fighter r">
					{#if c.redDoro}
						<img class="doro" src="/participants/{c.redDoro}-lg.webp" alt="" width="640" height="640" />
					{/if}
					<div class="tagline">紅方</div>
					<div class="nm">{c.redName ?? '待定'}</div>
				</div>
			</div>
		</div>

		<!-- ── 盤口與下注 ─────────────────────────────── -->
		<div class="markets">
			{#each board.markets as m (m.id)}
				{@const secs = remaining(m.lockAt)}
				{@const isActive = activeMarket?.id === m.id}
				<div class="mk {m.state === 'open' ? 'open' : ''}">
					<div class="mk-top">
						<span class="mk-name">{m.label}</span>
						{#if isOpen(m) && secs !== null && secs > 0}
							<span class="countdown">{mmss(secs)} 後封盤</span>
						{:else if isOpen(m)}
							<span style="color:var(--ok);font-size:13px">開放下注中</span>
						{:else if m.state === 'locked' || (m.state === 'open' && secs === 0)}
							<span style="color:var(--red);font-size:13px">已封盤</span>
						{:else if m.state === 'settled'}
							<span style="font-size:13px">
								{m.winnerSide === 'blue' ? c.blueName : c.redName} 獲勝
							</span>
						{:else if m.state === 'void'}
							<span style="font-size:13px;color:var(--muted)">已取消・全額退款</span>
						{/if}
					</div>

					<div class="odds">
						<div class="odd b">
							<div class="lab">{c.blueName ?? '藍方'}</div>
							<div class="val">{m.oddsBlue ? m.oddsBlue.toFixed(2) : '—'}</div>
						</div>
						<div class="odd r">
							<div class="lab">{c.redName ?? '紅方'}</div>
							<div class="val">{m.oddsRed ? m.oddsRed.toFixed(2) : '—'}</div>
						</div>
					</div>

					<div class="split">
						{#if m.total === 0}
							<div class="none">尚無人下注</div>
						{:else}
							{#if m.poolBlue > 0}<div class="sb" style="flex:{m.poolBlue}">{fmt(m.poolBlue)}</div>{/if}
							{#if m.poolRed > 0}<div class="sr" style="flex:{m.poolRed}">{fmt(m.poolRed)}</div>{/if}
						{/if}
					</div>
					<div class="split-legend">
						<span>{m.total > 0 ? Math.round((m.poolBlue / m.total) * 100) : 0}%</span>
						<span>總彩池 {fmt(m.total)}</span>
						<span>{m.total > 0 ? Math.round((m.poolRed / m.total) * 100) : 0}%</span>
					</div>

					{#if data.user}
						{@const mine = myPositions(m.id)}
						{#if mine.length > 0}
							<div class="mine">
								<div class="mine-t">你的押注</div>
								{#each mine as p (p.side)}
									{@const nm = p.side === 'blue' ? c.blueName : c.redName}
									<div class="mine-row">
										<span class="mine-side {p.side}">
											{nm ?? (p.side === 'blue' ? '藍方' : '紅方')}
										</span>
										<span class="mine-amt">{fmt(p.amount)}</span>
										<span class="mine-out">
											{#if p.state === 'pending'}
												預估領回 {fmt(positionEstimate(m, p.side, p.amount))}
											{:else if p.state === 'won'}
												<span style="color:var(--ok)">獲勝，領回 {fmt(p.payout)}</span>
											{:else if p.state === 'lost'}
												<span style="color:var(--red)">未中</span>
											{:else}
												已退款
											{/if}
										</span>
									</div>
								{/each}
								{#if m.state === 'open'}
									<p class="mine-note">預估值會隨其他人下注而變動，最終依封盤後的彩池計算。</p>
								{/if}
							</div>
						{/if}
					{/if}

					{#if isOpen(m)}
						<div class="betbox">
							{#if !data.user}
								<p class="closed-note">登入後即可下注</p>
							{:else}
								{@const held = myPositions(m.id)}
								<div class="sides">
									<button
										class="side-btn b {isActive && pickedSide === 'blue' ? 'on' : ''}"
										onclick={() => pick(m.id, 'blue')}
									>
										{held.some((p) => p.side === 'blue') ? '加碼' : '支持'}
										{c.blueName ?? '藍方'}
									</button>
									<button
										class="side-btn r {isActive && pickedSide === 'red' ? 'on' : ''}"
										onclick={() => pick(m.id, 'red')}
									>
										{held.some((p) => p.side === 'red') ? '加碼' : '支持'}
										{c.redName ?? '紅方'}
									</button>
								</div>

								{#if isActive && pickedSide}
									<p class="switch-hint">
										想改押另一邊？直接點另一顆按鈕，金額會保留。
										<button class="linkish" onclick={() => pick(m.id, pickedSide!)}>取消選擇</button>
									</p>
								{/if}

								{#if isActive && pickedSide}
									<div class="chips">
										{#each CHIPS as v (v)}
											<button class="chip-btn" disabled={stake + v > balance} onclick={() => addChip(v)}>
												+{v >= 1000 ? `${v / 1000}K` : v}
											</button>
										{/each}
										<button class="chip-btn" disabled={balance <= 0} onclick={() => (stake = balance)}>
											All-in
										</button>
										<button class="chip-btn clear" onclick={() => (stake = 0)}>清除</button>
									</div>

									<div class="stake">
										<span class="n">{fmt(stake)}</span>
										<span class="est">
											{#if stake > 0}預估獲得 {fmt(estimate)}{:else}請選擇金額{/if}
										</span>
									</div>

									<button class="submit" disabled={!canBet} onclick={() => (confirming = true)}>
										送出下注
									</button>
								{/if}
							{/if}
						</div>
					{:else if m.state === 'locked' || m.state === 'open'}
						<div class="closed-note">已封盤，等待賽果</div>
					{/if}
				</div>
			{:else}
				<div class="mk"><p class="closed-note">這一場還沒開盤，稍候片刻。</p></div>
			{/each}
		</div>
	{:else}
		<div class="stage"><p class="closed-note">賽事尚未開始。</p></div>
	{/if}

	<!-- ── 前後場次 ─────────────────────────────────── -->
	<div class="cols" style="margin-bottom:16px">
		<div class="card2">
			<h2>上一場結果</h2>
			{#if board.previous}
				<p style="margin:0">
					第 {board.previous.orderNo} 場・{board.previous.roundLabel}<br />
					{board.previous.blueName ?? '—'}
					<strong>{board.previous.scoreBlue} - {board.previous.scoreRed}</strong>
					{board.previous.redName ?? '—'}
				</p>
			{:else}
				<p style="margin:0;color:var(--muted)">還沒有已結束的場次。</p>
			{/if}
		</div>
		<div class="card2">
			<h2>下一場</h2>
			{#if board.next}
				<p style="margin:0">
					第 {board.next.orderNo} 場・{board.next.roundLabel}<br />
					{board.next.blueName ?? '待定'} vs {board.next.redName ?? '待定'}
					<span style="color:var(--muted)">（{board.next.format}）</span>
				</p>
			{:else}
				<p style="margin:0;color:var(--muted)">已經是最後一場了。</p>
			{/if}
		</div>
	</div>

	<!-- ── 排行榜與個人紀錄 ──────────────────────────── -->
	<div class="cols">
		<div class="card2">
			<h2>籌碼排行榜 TOP 5</h2>
			{#each leaderboard as r (r.rank)}
				<div class="rank-row">
					<span class="r">{r.rank}</span>
					<span>{r.displayName}</span>
					<span class="v">{fmt(r.balance)}</span>
				</div>
			{:else}
				<p style="margin:0;color:var(--muted)">還沒有人參加。</p>
			{/each}
			<p style="margin:12px 0 0;font-size:12px;color:var(--muted)">每分鐘更新一次</p>
		</div>

		<div class="card2">
			<h2>我的下注紀錄</h2>
			{#if !data.user}
				<p style="margin:0;color:var(--muted)">登入後顯示。</p>
			{:else}
				{#each myBets as b (b.id)}
					<div class="bet-row">
						<div>
							<div>第 {b.matchOrderNo} 場・{b.label}</div>
							<div class="meta">
								押 {b.side === 'blue' ? '藍方' : '紅方'} {fmt(b.amount)}
								{#if b.state === 'pending'}・等待開獎
								{:else if b.state === 'won'}・獲勝（已派彩）
								{:else if b.state === 'lost'}・失敗
								{:else}・已退款{/if}
							</div>
						</div>
						<div class="amt" style="color:{b.net > 0 ? 'var(--ok)' : b.net < 0 ? 'var(--red)' : 'var(--muted)'}">
							{#if b.state === 'pending'}—
							{:else if b.net > 0}+{fmt(b.net)}
							{:else if b.net < 0}{fmt(b.net)}
							{:else}±0{/if}
						</div>
					</div>
				{:else}
					<p style="margin:0;color:var(--muted)">還沒有下注紀錄。</p>
				{/each}
			{/if}
		</div>
	</div>

	<!-- ── 賽況資訊區（企劃書 §七）──────────────────────── -->
	<div class="card2" style="margin-top:16px">
		<h2>參賽主播</h2>
		<div class="roster">
			{#each data.roster.players as p (p.id)}
				<svelte:element
					this={p.channelUrl ? 'a' : 'div'}
					class="member"
					href={p.channelUrl ?? undefined}
					target={p.channelUrl ? '_blank' : undefined}
					rel={p.channelUrl ? 'noopener noreferrer' : undefined}
				>
					{#if p.doroSlug}
						<img src="/participants/{p.doroSlug}-sm.webp" alt="" width="256" height="256" loading="lazy" />
					{:else}
						<div class="no-art">未到</div>
					{/if}
					<span>{p.name}</span>
				</svelte:element>
			{/each}
		</div>

		<h2 style="margin-top:22px">主持群</h2>
		<div class="roster">
			{#each data.roster.hosts as p (p.id)}
				<svelte:element
					this={p.channelUrl ? 'a' : 'div'}
					class="member"
					href={p.channelUrl ?? undefined}
					target={p.channelUrl ? '_blank' : undefined}
					rel={p.channelUrl ? 'noopener noreferrer' : undefined}
				>
					{#if p.doroSlug}
						<img src="/participants/{p.doroSlug}-sm.webp" alt="" width="256" height="256" loading="lazy" />
					{:else}
						<div class="no-art">未到</div>
					{/if}
					<span>{p.name}</span>
					<small>{p.roleLabel}</small>
				</svelte:element>
			{/each}
		</div>
	</div>

	<div class="foot">
		<strong>本平台的狗狗幣無實際金錢價值，僅供娛樂用途。</strong>
		不可轉讓、不可兌換現金，活動結束後全數回收。<br />
		賠率為彩池分配制：你的獎金 = 總彩池 × 你的注 ÷ 贏方總注，除不盡採無條件捨去。<br />
		封盤前賠率會隨下注變動，畫面顯示為預估值，最終依封盤後的彩池計算。<br />
		平局、比賽取消或選手退賽時，該盤口全額退款。
	</div>
</div>

<!-- ── 二次確認彈窗 ──────────────────────────────────── -->
{#if confirming && activeMarket && pickedSide && board.current}
	{@const nm = pickedSide === 'blue' ? board.current.blueName : board.current.redName}
	<div class="backdrop">
		<!-- 點背景關閉。用 button 而非在 div 上掛 onclick，鍵盤才能操作 -->
		<button class="backdrop-close" aria-label="關閉下注確認" onclick={() => (confirming = false)}
		></button>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1">
			<h3 id="confirm-title">確認下注</h3>
			<dl>
				<dt>盤口</dt>
				<dd>{activeMarket.label}</dd>
				<dt>押注</dt>
				<dd style="color:{pickedSide === 'blue' ? 'var(--blue)' : 'var(--red)'}">{nm ?? (pickedSide === 'blue' ? '藍方' : '紅方')}</dd>
				<dt>金額</dt>
				<dd>{fmt(stake)}</dd>
				<dt>預估獲得</dt>
				<dd>{fmt(estimate)}</dd>
			</dl>
			<p class="fine">
				下注後<strong>無法取消或更改</strong>。預估獲得會隨其他人下注而變動，最終金額依封盤後的彩池計算。
			</p>
			<form method="POST" action="?/bet" use:enhance class="modal-actions">
				<input type="hidden" name="marketId" value={activeMarket.id} />
				<input type="hidden" name="side" value={pickedSide} />
				<input type="hidden" name="amount" value={stake} />
				<input type="hidden" name="idempotencyKey" value={idemKey} />
				<button type="button" class="no" onclick={() => (confirming = false)}>再想想</button>
				<button type="submit" class="yes">確認下注</button>
			</form>
		</div>
	</div>
{/if}
