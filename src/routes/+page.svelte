<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import '../app.css';
	import './board.css';
	import './bracket.css';
	import Bracket from '$lib/components/Bracket.svelte';
	import IdCard from '$lib/components/IdCard.svelte';
	import PrizeCard from '$lib/components/PrizeCard.svelte';
	import { sanitizeStake, MIN_STAKE } from '$lib/bet-amount';
	import StreamStrip from '$lib/components/StreamStrip.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** 狗狗幣面額。點一次加一次，可疊出大額（企劃書 DEMO 圖的作法）。 */
	const CHIPS = [100, 500, 1000, 5000, 10000];

	/**
	 * 輪詢結果先放進 polled*，畫面再用 $derived 取「輪詢值 ?? SSR 值」。
	 *
	 * 不直接把 data 複製進 $state：那樣一旦 data 更新（例如應援成功後
	 * SvelteKit 重跑 load），本地狀態不會跟著動，畫面就會停在舊資料。
	 */
	let polledBoard = $state<typeof data.board | null>(null);
	let polledLeaderboard = $state<typeof data.leaderboard | null>(null);
	let polledBracket = $state<typeof data.bracket | null>(null);

	const board = $derived(polledBoard ?? data.board);
	const leaderboard = $derived(polledLeaderboard ?? data.leaderboard);
	const bracket = $derived(polledBracket ?? data.bracket);

	/**
	 * 個人資料一律由前端取得。
	 *
	 * 首頁的 HTML 會被 CDN 快取後送給所有人，所以伺服器端渲染不能含任何
	 * 個人資訊（見 +page.server.ts 的說明）。代價是登入狀態會晚一步出現。
	 */
	interface Me {
		user: {
			displayName: string;
			avatarUrl: string | null;
			publicCode: string | null;
			isAdmin: boolean;
		} | null;
		balance: number;
		bets: Array<{
			id: number;
			side: string;
			amount: number;
			state: string;
			payout: number;
			marketId: number;
			label: string;
			matchOrderNo: number;
			net: number;
		}>;
	}

	let me = $state<Me | null>(null);
	/** 還沒問到 /api/me 之前不要急著顯示「請登入」，避免登入者看到閃爍 */
	let meLoaded = $state(false);

	const user = $derived(me?.user ?? null);
	const balance = $derived(me?.balance ?? 0);
	const myBets = $derived(me?.bets ?? []);

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
	 * 倒數歸零就立刻當成關閉應援，不等伺服器狀態同步。
	 *
	 * /api/board 有 3 秒快取，狀態改成 locked 之後畫面最多還會慢 3 秒。
	 * 那段空窗期若還顯示應援介面，使用者按下去只會拿到失敗訊息。
	 */
	function isOpen(m: (typeof board.markets)[number]) {
		if (m.state !== 'open') return false;
		const left = remaining(m.lockAt);
		return left === null || left > 0;
	}

	const openMarkets = $derived(board.markets.filter(isOpen));

	/**
	 * 畫面上所有可操作的應援場：上方當前場次的各局，加上下方「所有場次」的整場應援。
	 * 同一個應援場可能同時出現在兩邊（當前場次的整場應援），find 取到的是同一筆，無妨。
	 */
	const pageMarkets = $derived.by(() => {
		const out = [...board.markets];
		for (const b of board.bars) if (b.market) out.push(b.market);
		return out;
	});

	const activeMarket = $derived(
		pageMarkets.find((m) => m.id === pickedMarket) ?? openMarkets[0] ?? null
	);

	/**
	 * 正在操作的應援場屬於哪一場、雙方是誰。
	 *
	 * 確認視窗要寫出「你應援的是誰」，但下方列表的應援場不屬於當前場次，
	 * 名字不能再從 board.current 拿。對手未定時退而顯示晉級來源（M1 勝者）。
	 */
	const activeTarget = $derived.by(() => {
		if (!activeMarket) return null;

		const bar = board.bars.find((b) => b.market?.id === activeMarket.id);
		if (bar) {
			return {
				title: `M${bar.orderNo}・${bar.roundLabel}`,
				blueName: bar.blueName ?? bar.blueFrom ?? '藍方',
				redName: bar.redName ?? bar.redFrom ?? '紅方'
			};
		}
		if (board.current) {
			return {
				title: `第 ${board.current.orderNo} 場・${activeMarket.label}`,
				blueName: board.current.blueName ?? '藍方',
				redName: board.current.redName ?? '紅方'
			};
		}
		return null;
	});

	/** 展開應援面板的那一列（場次 id）。一次只展開一列，版面才不會爆開。 */
	let openBar = $state<number | null>(null);

	/** 這一列現在能不能應援 */
	function barOpen(bar: (typeof board.bars)[number]) {
		return !!bar.market && isOpen(bar.market);
	}

	/** 關閉應援剩餘秒數，以伺服器時鐘計算。 */
	function remaining(lockAt: string | null): number | null {
		if (!lockAt) return null;
		const ms = new Date(lockAt).getTime() - (tick + clockSkew);
		return ms > 0 ? Math.ceil(ms / 1000) : 0;
	}

	function mmss(sec: number) {
		return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
	}

	/** 依目前獎池估算獲得。關閉應援前分配倍率會變，所以只是預估。 */
	const estimate = $derived.by(() => {
		if (!activeMarket || !pickedSide || stake <= 0) return 0;
		const pool = pickedSide === 'blue' ? activeMarket.poolBlue : activeMarket.poolRed;
		const total = activeMarket.total + stake;
		const winner = pool + stake;
		return winner > 0 ? Math.floor((stake * total) / winner) : 0;
	});

	const canBet = $derived(
		!!user &&
		!!activeMarket &&
		isOpen(activeMarket) &&
		!!pickedSide &&
		stake >= MIN_STAKE &&
		stake <= balance
	);

	/**
	 * 我在某個應援場上的持倉，同一邊的多筆合併成一列。
	 *
	 * 觀眾常常分好幾次加碼，只列原始應援紀錄會很難看出「我到底投入多少」。
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

	/** 依「目前」獎池估算持倉可領回多少。獎池已含自己的注，所以直接算即可。 */
	function positionEstimate(m: (typeof board.markets)[number], side: 'blue' | 'red', amount: number) {
		const pool = side === 'blue' ? m.poolBlue : m.poolRed;
		return pool > 0 ? Math.floor((amount * m.total) / pool) : 0;
	}

	/**
	 * 選擇陣營。點已選中的那邊等於取消，讓「改變主意」有路可退。
	 * 換邊時金額刻意保留 —— 觀眾常常是想比較「同樣的錢應援另一邊會怎樣」。
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
		// 餘額可能是負的（訂單取消被收回），所以下限要壓在 0，不能直接寫 stake = balance
		if (stake + v <= balance) stake += v;
		else stake = Math.max(0, balance);
	}

	/**
	 * 自己打金額。規則與邊界情況都在 sanitizeStake 裡（有測試守著）：
	 * 正整數、不超過持有量、全形數字與千分位逗號也吃得下。
	 *
	 * 輸入框顯示的字串與 stake 分開存，使用者才能清空重打。
	 */
	let stakeText = $state('');
	let stakeClamped = $state(false);
	/** 打了數字但還沒到最低金額。只提示，不自動補 —— 補了就沒辦法繼續往下打。 */
	let stakeBelowMin = $state(false);

	/**
	 * ⚠️ 一定要把清理後的字串寫回 DOM。
	 *
	 * value={stakeText} 是單向綁定：stakeText 沒變，Svelte 就不會去動輸入框。
	 * 持有 1,000 的人打到第五個字（10000）時會被壓回 1000，而 stakeText
	 * 上一個字就已經是 "1000"，於是畫面上留著 "10000" —— 主辦方 10-10 回報的
	 * 「可以手動輸入，但會變成超出持有數量」就是這個。實際送出的是 1,000，
	 * 但使用者看到的數字比自己的狗狗幣還多，會以為系統壞了。
	 */
	function typeStake(el: HTMLInputElement) {
		const r = sanitizeStake(el.value, balance);
		stakeText = r.text;
		stake = r.value;
		stakeClamped = r.clamped;
		stakeBelowMin = r.belowMin;
		if (el.value !== r.text) el.value = r.text;
	}

	/**
	 * 餘額變少時把已經打好的金額壓下來。
	 * 餘額是輪詢回來的，可能在使用者打完之後才更新（後台人工調整之類），
	 * 不壓的話畫面上會出現比持有還多的金額，要等送出被伺服器擋下才知道。
	 */
	$effect(() => {
		if (stake > balance) {
			// 餘額可能是負的（訂單取消被收回）。直接 stake = balance 會讓
			// 輸入框出現「-5000」這種東西，所以下限壓在 0。
			const max = Math.max(0, balance);
			stake = max;
			stakeText = max === 0 ? '' : String(max);
			stakeClamped = true;
			stakeBelowMin = max > 0 && max < MIN_STAKE;
		}
	});

	/** 金額被狗狗幣按鈕或應援成功改動時，輸入框要跟著更新 */
	$effect(() => {
		const shown = stakeText === '' ? 0 : Number(stakeText);
		if (shown !== stake) {
			stakeText = stake === 0 ? '' : String(stake);
			stakeClamped = false;
			stakeBelowMin = stake > 0 && stake < MIN_STAKE;
		}
	});


	function newKey() {
		idemKey = crypto.randomUUID();
	}

	/**
	 * 已結算／已取消的應援場指紋，用來偵測「剛剛發放了」。
	 * 看板反正每 3 秒都會拿到，比對一下就知道要不要更新餘額。
	 */
	let settledMark = $state('');

	function markOf(list: typeof board.markets) {
		return list
			.filter((m) => m.state === 'settled' || m.state === 'void')
			.map((m) => m.id)
			.sort()
			.join(',');
	}

	/**
	 * 個人資料。
	 *
	 * ⚠️ 不要把這個放進定時輪詢。
	 *
	 * /api/me 回的是個人餘額，必須 no-store，所以每次呼叫都會叫起一個
	 * Function —— 不像看板那樣所有人共用一份 CDN 快取。若每 3 秒問一次，
	 * 300 人的活動就是 180 萬次呼叫，而 Netlify 免費額度是 12.5 萬次／月。
	 *
	 * 餘額只有三種情況會變：開啟頁面、自己應援、應援場發放。
	 * 事件驅動不但省下 99% 的呼叫，反應還更快（應援完立刻更新，不用等輪詢）。
	 */
	async function refreshMe() {
		try {
			me = await fetch('/api/me').then((r) => r.json());
		} catch {
			// 失敗就沿用上一次的資料，下次事件再更新
		} finally {
			meLoaded = true;
		}
	}

	/** 看板與排行榜。這兩支都有 CDN 快取，定時輪詢的成本可忽略。 */
	async function refreshBoard() {
		try {
			const [b, l] = await Promise.all([
				fetch('/api/board').then((r) => r.json()),
				fetch('/api/leaderboard').then((r) => r.json())
			]);
			polledBoard = b;
			polledLeaderboard = l.rows;
			clockSkew = new Date(b.now).getTime() - Date.now();

			// 有應援場結算或取消 → 發放或退還發生了 → 這時才去看餘額。
			//
			// 基準值在 onMount 就設好了，所以這裡任何變化都是真的發生了事情。
			// 不要再加「基準值非空才比對」之類的防呆 —— 頁面開啟時若剛好
			// 一個已結算應援場都沒有，那種寫法會把第一次發放整個吃掉。
			const mark = markOf(b.markets);
			if (mark !== settledMark) {
				settledMark = mark;
				refreshMe();
			}
		} catch {
			// 網路瞬斷不需要打擾使用者，下一次輪詢會補上
		}
	}

	/**
	 * 賽程樹。只有某一場判定勝負時才會變，所以輪詢得比看板慢得多
	 * （/api/bracket 也對應設了 15 秒快取）。
	 */
	async function refreshBracket() {
		try {
			polledBracket = await fetch('/api/bracket').then((r) => r.json());
		} catch {
			// 沿用上一次的結果，下一輪會補上
		}
	}

	onMount(() => {
		newKey();
		clockSkew = new Date(board.now).getTime() - Date.now();
		settledMark = markOf(board.markets);

		refreshMe();
		refreshBoard();

		// 只有看板在輪詢（回應由 CDN 快取，見 /api/board 的註解）
		const poll = setInterval(refreshBoard, 3000);
		const bracketPoll = setInterval(refreshBracket, 15000);
		// 倒數每秒重畫，但不打伺服器
		const clock = setInterval(() => (tick = Date.now()), 1000);

		return () => {
			clearInterval(poll);
			clearInterval(bracketPoll);
			clearInterval(clock);
		};
	});

	$effect(() => {
		if (form?.success) {
			confirming = false;
			openBar = null;
			stake = 0;
			pickedSide = null;
			newKey();
			// 錢剛扣掉，立刻更新餘額與獎池
			refreshMe();
			refreshBoard();
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
		<!--
			登入狀態要等 /api/me 回來才知道（首頁 HTML 被快取後對所有人都一樣）。
			在那之前顯示骨架而不是「請登入」—— 否則已登入的人會先看到登入按鈕、
			再跳成自己的餘額，看起來像卡住。
		-->
		{#if !meLoaded}
			<div class="purse"><span class="skeleton"></span></div>
		{:else if user}
			<div class="purse">
				<IdCard
					displayName={user.displayName}
					avatarUrl={user.avatarUrl}
					{balance}
					publicCode={user.publicCode}
				/>
				<a href="/coins">獲得狗狗幣</a>
				{#if user.isAdmin}<a href="/admin">後台</a>{/if}
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

<!-- ── 負餘額提示 ─────────────────────────────────────
     訂單取消被收回、或主辦方人工扣除時，餘額可能變成負的。
     不解釋的話觀眾只會看到一個負數，完全不知道發生什麼事。 -->
{#if user && balance < 0}
	<div class="owe">
		你目前的狗狗幣是 <b>{fmt(balance)}</b>。
		這代表先前發放給你的狗狗幣被收回（訂單取消、退款，或主辦方調整），而當時那些幣已經應援出去了。
		<br />
		<b>餘額回到正數之前無法再應援。</b>詳細的進出紀錄在<a href="/coins">「獲得狗狗幣」</a>頁最下方；
		有疑問請透過主辦方公告的客服管道聯繫。
	</div>
{/if}

<div class="board">
	{#if form?.success}<div class="msg-ok">{form.success}</div>{/if}
	{#if form?.error}<div class="msg-err">{form.error}</div>{/if}

	{#if meLoaded && !user}
		<div class="card2" style="margin-bottom:16px">
			<h2>還沒加入？</h2>
			<p style="margin:0 0 6px">用 Discord 登入即可領取 1,000 狗狗幣，馬上開始應援。</p>
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
						<span class="tag t-open" style="color:var(--ok);border:1px solid var(--ok)">開放應援</span>
					{:else if board.markets.some((m) => m.state === 'locked')}
						<span class="tag" style="color:var(--red);border:1px solid var(--red)">已關閉應援・結算中</span>
					{:else}
						<span class="tag" style="color:var(--muted);border:1px solid var(--line)">尚未開放應援</span>
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

		<!-- ── 應援場與應援 ─────────────────────────────── -->
		<div class="markets">
			{#each board.markets as m (m.id)}
				{@const secs = remaining(m.lockAt)}
				{@const isActive = activeMarket?.id === m.id}
				<div class="mk {m.state === 'open' ? 'open' : ''}">
					<div class="mk-top">
						<span class="mk-name">{m.label}</span>
						{#if isOpen(m) && secs !== null && secs > 0}
							<span class="countdown">{mmss(secs)} 後關閉應援</span>
						{:else if isOpen(m)}
							<span style="color:var(--ok);font-size:13px">開放應援中</span>
						{:else if m.state === 'locked' || (m.state === 'open' && secs === 0)}
							<span style="color:var(--red);font-size:13px">已關閉應援</span>
						{:else if m.state === 'settled'}
							<span style="font-size:13px">
								{m.winnerSide === 'blue' ? c.blueName : c.redName} 獲勝
							</span>
						{:else if m.state === 'void'}
							<span style="font-size:13px;color:var(--muted)">已取消・全額退還</span>
						{/if}
					</div>

					<div class="split">
						{#if m.total === 0}
							<div class="none">尚無人應援</div>
						{:else}
							{#if m.poolBlue > 0}<div class="sb" style="flex:{m.poolBlue}">{fmt(m.poolBlue)}</div>{/if}
							{#if m.poolRed > 0}<div class="sr" style="flex:{m.poolRed}">{fmt(m.poolRed)}</div>{/if}
						{/if}
					</div>
					<!-- 主辦方 10-10 要求：倍率的大方塊拿掉，只留這條比例長條。
					     陣營名字改放在長條兩端，不然卡片上就看不出哪邊是誰。 -->
					<div class="split-legend">
						<span class="sl b">{c.blueName ?? '藍方'}　{m.total > 0 ? Math.round((m.poolBlue / m.total) * 100) : 0}%</span>
						<span>總獎池 {fmt(m.total)}</span>
						<span class="sl r">{m.total > 0 ? Math.round((m.poolRed / m.total) * 100) : 0}%　{c.redName ?? '紅方'}</span>
					</div>

					{#if user}
						{@const mine = myPositions(m.id)}
						{#if mine.length > 0}
							<div class="mine">
								<div class="mine-t">你的應援</div>
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
												已退還
											{/if}
										</span>
									</div>
								{/each}
								{#if m.state === 'open'}
									<p class="mine-note">預估值會隨其他人應援而變動，最終依關閉應援後的獎池計算。</p>
								{/if}
							</div>
						{/if}
					{/if}

					{#if isOpen(m)}
						<div class="betbox">
							{#if meLoaded && !user}
								<p class="closed-note">登入後即可應援</p>
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
										想改成應援另一邊？直接點另一顆按鈕，金額會保留。
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
											全部
										</button>
										<button class="chip-btn clear" onclick={() => (stake = 0)}>清除</button>
									</div>

									<div class="stake">
										<input
											class="n"
											type="text"
											inputmode="numeric"
											placeholder="0"
											aria-label="應援金額"
											value={stakeText}
											oninput={(e) => typeStake(e.currentTarget)}
										/>
										<span class="est">
											{#if stakeBelowMin}
												<span class="too-low">最低 {fmt(MIN_STAKE)} 狗狗幣</span>
											{:else if stake > 0}
												預估獲得 {fmt(estimate)}{#if stakeClamped}・已是全部狗狗幣{/if}
											{:else}
												可直接輸入，最低 {fmt(MIN_STAKE)} 狗狗幣
											{/if}
										</span>
									</div>

									<button class="submit" disabled={!canBet} onclick={() => (confirming = true)}>
										送出應援
									</button>
									{#if balance < MIN_STAKE}
										<p class="too-low" style="margin:8px 0 0;text-align:center">
											持有不足 {fmt(MIN_STAKE)} 狗狗幣，無法應援
										</p>
									{/if}
								{/if}
							{/if}
						</div>
					{:else if m.state === 'locked' || m.state === 'open'}
						<div class="closed-note">已關閉應援，等待賽果</div>
					{/if}
				</div>
			{:else}
				<div class="mk"><p class="closed-note">這一場還沒開放應援，稍候片刻。</p></div>
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

	<!-- ── 賽程樹狀圖 ──────────────────────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>賽程樹</h2>
		<Bracket {bracket} />
	</div>

	<!-- ── 選手實況（後台 /admin/streams 編輯）───────── -->
	{#if data.streams.length}
		<div class="card2" style="margin-bottom:16px">
			<h2>選手實況回顧</h2>
			<p class="bars-note">
				先看看選手過去的表現，再決定要應援誰。按下縮圖才會開始播放。
			</p>
			<StreamStrip streams={data.streams} />
		</div>
	{/if}

	<!-- ── 所有場次：提前應援 ──────────────────────── -->
	{#if board.bars.length}
		<div class="card2" style="margin-bottom:16px">
			<h2>所有場次・提前應援</h2>
			<p class="bars-note">
				每一場都可以提前應援，<strong>連還沒確定對手的場次也可以</strong> ——
				應援的是那一側，例如「M1 勝者」。主持人會在每場開打前約一分鐘關閉該場應援，關閉後就不能再投入。
			</p>

			<div class="bars-grid">
			{#each board.bars as bar (bar.matchId)}
				{@const mk = bar.market}
				{@const canPick = barOpen(bar)}
				{@const left = mk ? remaining(mk.lockAt) : null}
				{@const expanded = openBar === bar.matchId && canPick}
				<div
					class="bar"
					class:bar-open={canPick}
					class:bar-done={bar.matchState === 'done'}
					class:bar-wide={expanded}
				>
					<div class="bar-head">
						<span class="bar-no">M{bar.orderNo}</span>
						<span class="bar-fmt">{bar.format}</span>
						<span class="bar-round">{bar.roundLabel}</span>
						{#if canPick && left !== null}
							<span class="cd">{mmss(left)}</span>
						{:else if canPick}
							<span class="tag t-open">開放應援</span>
						{:else if mk?.state === 'settled'}
							<span class="tag t-settled">已發放</span>
						{:else if mk?.state === 'void'}
							<span class="tag t-void">已取消</span>
						{:else if mk}
							<span class="tag t-locked">已關閉應援</span>
						{:else}
							<span class="tag t-pending">尚未開放應援</span>
						{/if}
					</div>

					<div class="bar-vs">
						<span class="bar-name b" class:win={bar.matchWinnerSide === 'blue'}>
							{#if bar.blueDoro}<img src="/participants/{bar.blueDoro}-sm.webp" alt="" width="22" height="22" />{/if}
							{bar.blueName ?? bar.blueFrom ?? '待定'}
						</span>
						<span class="bar-x">VS</span>
						<span class="bar-name r" class:win={bar.matchWinnerSide === 'red'}>
							{#if bar.redDoro}<img src="/participants/{bar.redDoro}-sm.webp" alt="" width="22" height="22" />{/if}
							{bar.redName ?? bar.redFrom ?? '待定'}
						</span>
					</div>

					{#if mk}
						<div class="split">
							{#if mk.total === 0}
								<div class="none">尚無人應援</div>
							{:else}
								{#if mk.poolBlue > 0}<div class="sb" style="flex:{mk.poolBlue}">{fmt(mk.poolBlue)}</div>{/if}
								{#if mk.poolRed > 0}<div class="sr" style="flex:{mk.poolRed}">{fmt(mk.poolRed)}</div>{/if}
							{/if}
						</div>
						<div class="split-legend">
							<span>{mk.total > 0 ? Math.round((mk.poolBlue / mk.total) * 100) : 0}%</span>
							<span>總獎池 {fmt(mk.total)}</span>
							<span>{mk.total > 0 ? Math.round((mk.poolRed / mk.total) * 100) : 0}%</span>
						</div>
					{/if}

					{#if user && mk}
						{@const mine = myPositions(mk.id)}
						{#if mine.length}
							<div class="bar-mine">
								你已應援
								{#each mine as p, i (p.side)}
									{i > 0 ? '、' : ''}<span class={p.side}>
										{(p.side === 'blue' ? bar.blueName ?? bar.blueFrom : bar.redName ?? bar.redFrom) ??
											(p.side === 'blue' ? '藍方' : '紅方')}
										{fmt(p.amount)}
									</span>
								{/each}
							</div>
						{/if}
					{/if}

					{#if canPick}
						{#if meLoaded && !user}
							<a class="bar-bet" href="/auth/login" data-sveltekit-reload>登入後應援</a>
						{:else}
							<button
								class="bar-bet"
								onclick={() => {
									openBar = expanded ? null : bar.matchId;
									if (!expanded) pickedMarket = mk!.id;
								}}
							>
								{expanded ? '收合' : '應援'}
							</button>
						{/if}
					{:else}
						<!--
							不能應援時也佔住按鈕的位置：同一排的卡片底部才會對齊，
							觀眾也看得到「為什麼不能應援」，而不是按鈕憑空消失。
						-->
						<div class="bar-bet off">
							{#if mk?.state === 'void'}已取消，應援金額已全數退還
							{:else if mk?.state === 'settled'}已發放
							{:else if mk}已關閉應援，等待賽果
							{:else}尚未開放應援{/if}
						</div>
					{/if}

					{#if expanded && mk}
						{@const isActive = activeMarket?.id === mk.id}
						<div class="bar-bet-panel">
							<div class="sides">
								<button
									class="side-btn b {isActive && pickedSide === 'blue' ? 'on' : ''}"
									onclick={() => pick(mk.id, 'blue')}
								>
									支持 {bar.blueName ?? bar.blueFrom ?? '藍方'}
								</button>
								<button
									class="side-btn r {isActive && pickedSide === 'red' ? 'on' : ''}"
									onclick={() => pick(mk.id, 'red')}
								>
									支持 {bar.redName ?? bar.redFrom ?? '紅方'}
								</button>
							</div>

							{#if isActive && pickedSide}
								<div class="chips">
									{#each CHIPS as v (v)}
										<button class="chip-btn" disabled={stake + v > balance} onclick={() => addChip(v)}>
											+{v >= 1000 ? `${v / 1000}K` : v}
										</button>
									{/each}
									<button class="chip-btn" disabled={balance <= 0} onclick={() => (stake = balance)}>
										全部
									</button>
									<button class="chip-btn clear" onclick={() => (stake = 0)}>清除</button>
								</div>

								<div class="stake">
									<input
										class="n"
										type="text"
										inputmode="numeric"
										placeholder="0"
										aria-label="應援金額"
										value={stakeText}
										oninput={(e) => typeStake(e.currentTarget)}
									/>
									<span class="est">
										{#if stakeBelowMin}
											<span class="too-low">最低 {fmt(MIN_STAKE)} 狗狗幣</span>
										{:else if stake > 0}
											預估獲得 {fmt(estimate)}{#if stakeClamped}・已是全部狗狗幣{/if}
										{:else}
											可直接輸入，最低 {fmt(MIN_STAKE)} 狗狗幣
										{/if}
									</span>
								</div>

								<button class="submit" disabled={!canBet} onclick={() => (confirming = true)}>
									送出應援
								</button>
								{#if balance < MIN_STAKE}
									<p class="too-low" style="margin:8px 0 0;text-align:center">
										持有不足 {fmt(MIN_STAKE)} 狗狗幣，無法應援
									</p>
								{/if}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
			</div>
		</div>
	{/if}

	<!-- ── 排行榜獎品（後台 /admin/prizes 編輯）────────── -->
	{#if data.prizes.length}
		<div class="prize-list">
			{#each data.prizes as prize (prize.id)}
				<PrizeCard {prize} />
			{/each}
		</div>
	{/if}

	<!-- ── 排行榜與個人紀錄 ──────────────────────────── -->
	<div class="cols">
		<div class="card2">
			<h2>狗狗幣排行榜 TOP 5</h2>
			{#each leaderboard as r (r.rank)}
				<div class="rank-row" class:prized={r.rank <= 3}>
					<span class="r">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span>
					<span>{r.displayName}</span>
					<span class="v">{fmt(r.balance)}</span>
				</div>
			{:else}
				<p style="margin:0;color:var(--muted)">還沒有人參加。</p>
			{/each}
			<p style="margin:12px 0 0;font-size:12px;color:var(--muted)">每分鐘更新一次</p>
		</div>

		<div class="card2">
			<h2>我的應援紀錄</h2>
			{#if meLoaded && !user}
				<p style="margin:0;color:var(--muted)">登入後顯示。</p>
			{:else}
				{#each myBets as b (b.id)}
					<div class="bet-row">
						<div>
							<div>第 {b.matchOrderNo} 場・{b.label}</div>
							<div class="meta">
								應援 {b.side === 'blue' ? '藍方' : '紅方'} {fmt(b.amount)}
								{#if b.state === 'pending'}・等待賽果
								{:else if b.state === 'won'}・獲勝（已發放）
								{:else if b.state === 'lost'}・失敗
								{:else}・已退還{/if}
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
					<p style="margin:0;color:var(--muted)">還沒有應援紀錄。</p>
				{/each}
				<p style="margin:12px 0 0;font-size:12px">
					<a href="/coins">看完整的狗狗幣紀錄 →</a>
				</p>
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

	<!-- ── 活動注意事項 ───────────────────────────────
	     主辦方 10-10 提供的正式條文，<strong>一字不改</strong>。
	     要修改請回頭跟主辦方要新版，不要自行潤飾 —— 這是對觀眾的規則承諾。 -->
	<div class="foot">
		<h3 class="foot-h">活動注意事項</h3>
		<ol class="foot-list">
			<li>本活動以娛樂、賽事互動及觀眾應援為目的，參與活動即表示已閱讀並同意本活動相關規則。</li>
			<li>狗狗幣為本活動限定之娛樂性虛擬點數，不具現金價值，不得兌換現金、商品、折扣或其他經濟利益，亦不得私下交易、出售或轉讓。</li>
			<li>每個 Discord 帳號僅限建立一個活動帳號，禁止使用多重帳號或其他方式影響活動公平性。</li>
			<li>參加者應自行確認應援對象、投入狗狗幣數量及場次。應援成功送出後，除系統異常或活動規則另有規定外，不得取消、減少、轉移或要求返還。</li>
			<li>各場次應援截止時間由主台於直播中宣布，截止後將不再接受新的應援或追加狗狗幣。</li>
			<li>賽事結果經主辦方確認後，將依活動規則進行狗狗幣結算及派發。如遇重賽、賽事取消或無效場次，依活動公告及相關規則處理。</li>
			<li>排行榜依參加者最終持有之狗狗幣數量排名；最終場次完成結算及派發後，排行榜結果即不再更新。若多人狗狗幣數量相同，則並列相同名次。</li>
			<li>排行榜前三名可獲得活動限定愛心水晶紀念獎座。獎座不得折換現金、商品或其他替代獎勵，詳細內容依「應援獎勵」規則辦理。</li>
			<li>得獎者須於主辦方公告之期限內，透過指定方式完成聯繫及領獎資料確認。逾期未回覆者，主辦方將再次通知；若仍未完成領獎程序，將依事先公告之方式處理。</li>
			<li>愛心水晶紀念獎座為客製化紀念品，製作及寄送需一定作業時間。主辦方將於得獎者確認後另行通知預計寄送時程。</li>
			<li>主辦方蒐集之 Discord 帳號資訊、得獎者姓名及獎品寄送資料，僅用於活動管理、身分確認及獎勵寄送，並依適用個人資料保護法規處理。</li>
			<li>禁止冒用、盜用他人帳號，或利用程式、系統漏洞及其他不正當方式取得狗狗幣或影響活動結果。經查證違規者，主辦方得取消相關紀錄、參加資格及獎勵資格。</li>
			<li>如因網站、伺服器、網路、系統或人工操作異常，造成應援、狗狗幣餘額或排行榜資料錯誤，主辦方得依正確活動紀錄進行查核、修正或重新結算。</li>
			<li>如發生未涵蓋之特殊情況，主辦方將以活動公平性及既有規則為原則進行處理，必要時另行公告。</li>
			<li>獎池分配制：你可領回 = 總獎池 × 你投入的金額 ÷ 獲勝方總投入，除不盡無條件捨去。</li>
			<li>獲勝方若無人應援，該場獎池全數由系統回收，不分配也不退還。</li>
			<li>平局、比賽取消或選手退賽時，該場應援全額退還。</li>
			<li>活動規則如有調整或補充，將以主辦方正式公告為準；涉及參加者權益之重大變更，將公告變更內容及適用時間。</li>
		</ol>
	</div>
</div>

<!-- ── 二次確認彈窗 ──────────────────────────────────── -->
{#if confirming && activeMarket && activeTarget && pickedSide}
	{@const nm = pickedSide === 'blue' ? activeTarget.blueName : activeTarget.redName}
	<div class="backdrop">
		<!-- 點背景關閉。用 button 而非在 div 上掛 onclick，鍵盤才能操作 -->
		<button class="backdrop-close" aria-label="關閉應援確認" onclick={() => (confirming = false)}
		></button>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1">
			<h3 id="confirm-title">確認應援</h3>
			<dl>
				<dt>場次</dt>
				<dd>{activeTarget.title}</dd>
				<dt>項目</dt>
				<dd>{activeMarket.label}</dd>
				<dt>應援</dt>
				<dd style="color:{pickedSide === 'blue' ? 'var(--blue)' : 'var(--red)'}">{nm}</dd>
				<dt>金額</dt>
				<dd>{fmt(stake)}</dd>
				<dt>預估獲得</dt>
				<dd>{fmt(estimate)}</dd>
			</dl>
			<p class="fine">
				應援後<strong>無法取消或更改</strong>。預估獲得會隨其他人應援而變動，最終金額依關閉應援後的獎池計算。
				單筆最低 {fmt(MIN_STAKE)} 狗狗幣。
			</p>
			<form method="POST" action="?/bet" use:enhance class="modal-actions">
				<input type="hidden" name="marketId" value={activeMarket.id} />
				<input type="hidden" name="side" value={pickedSide} />
				<input type="hidden" name="amount" value={stake} />
				<input type="hidden" name="idempotencyKey" value={idemKey} />
				<button type="button" class="no" onclick={() => (confirming = false)}>再想想</button>
				<button type="submit" class="yes">確認應援</button>
			</form>
		</div>
	</div>
{/if}
