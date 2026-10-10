<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/**
	 * 應援場的即時狀態。刻意只更新顯示，不重載整頁 ——
	 * 操作員可能正在輸入比分，整頁重載會把輸入框蓋掉。
	 */
	let live = $state<{ now: string; markets: PageData['markets'] } | null>(null);
	let clockSkew = $state(0);
	let tick = $state(Date.now());

	const shownMarkets = $derived(live?.markets ?? data.markets);

	function remaining(lockAt: string | Date | null): number | null {
		if (!lockAt) return null;
		const ms = new Date(lockAt).getTime() - (tick + clockSkew);
		return ms > 0 ? Math.ceil(ms / 1000) : 0;
	}

	function mmss(sec: number) {
		return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
	}

	onMount(() => {
		let lastStates = '';

		const poll = setInterval(async () => {
			try {
				const r = await fetch(`/api/admin/match/${data.match.id}`);
				if (!r.ok) return;
				const j = await r.json();
				live = j;
				clockSkew = new Date(j.now).getTime() - Date.now();

				// 應援場狀態改變時（例如倒數到期自動關閉）才重載，
				// 好讓按鈕換成對應的動作。獎池變動不需要重載。
				const states = j.markets.map((m: { id: number; state: string }) => `${m.id}:${m.state}`).join(',');
				if (lastStates && states !== lastStates) invalidateAll();
				lastStates = states;
			} catch {
				// 瞬斷不必打擾操作員，下次輪詢會補上
			}
		}, 3000);

		const clock = setInterval(() => (tick = Date.now()), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(clock);
		};
	});

	const fmt = (n: number) => n.toLocaleString('zh-TW');
	const sideName = (s: string) => (s === 'blue' ? '藍方' : '紅方');

	const STATE_LABEL: Record<string, string> = {
		pending: '未建立',
		open: '開放應援',
		locked: '已關閉應援',
		settled: '已結算',
		void: '已取消'
	};

	const blueName = $derived(
		data.participants.find((p) => p.id === data.match.blueParticipantId)?.name ?? '藍方'
	);
	const redName = $derived(
		data.participants.find((p) => p.id === data.match.redParticipantId)?.name ?? '紅方'
	);

	/** 已建立的應援場，依 gameNo 對應。優先用輪詢到的即時資料。 */
	const marketOf = (gameNo: number) => shownMarkets.find((m) => m.gameNo === gameNo);

	/**
	 * 要顯示哪幾張應援場卡片。
	 *
	 * 這次的玩法一場只開一個應援場（看整場勝負），所以預設只出現一張，
	 * 名稱直接用場次名 —— 卡片上寫「整場應援」、頁面標題寫「場次 3」，
	 * 操作員要自己對應，容易按錯（主辦方 10-10 回報）。
	 *
	 * 單局的卡片<u>只有在那個應援場已經建立過時才出現</u>：
	 * 不主動提供，但已經開過的要能繼續關閉、判定、發放，不能讓它變成孤兒。
	 */
	const slots = $derived([
		{ gameNo: 0, label: `第 ${data.match.orderNo} 場・${data.match.roundLabel}` },
		...Array.from({ length: data.maxGames }, (_, i) => i + 1)
			.filter((gameNo) => marketOf(gameNo))
			.map((gameNo) => ({ gameNo, label: `第 ${gameNo} 局` }))
	]);
</script>

<p style="margin:0 0 10px"><a href="/admin">← 回場次總覽</a></p>

<h1>場次 {data.match.orderNo}・{data.match.roundLabel}</h1>
<p class="hint">
	{data.match.format}
	{#if data.match.isElimination}・輸者淘汰{/if}
	・目前比分 {data.match.scoreBlue} - {data.match.scoreRed}
</p>

{#if form?.error}
	<div class="err">{form.error}</div>
{/if}
{#if form?.success}
	<div class="ok-msg">{form.success}</div>
{/if}

<!-- ── 發放確認：不可逆，先讓操作員看見後果 ───────────── -->
{#if data.preview}
	{@const p = data.preview}
	<div class="confirm">
		<h3>確認發放：{sideName(p.side)}獲勝</h3>
		<p class="warn">
			{#if p.willForfeit}
				{p.reason}
			{:else}
				發放會立即寫入帳本，<strong>無法復原</strong>。請確認勝方正確後再按下確認。
			{/if}
		</p>

		{#if p.rows.length === 0}
			<p class="warn">這個應援場沒有任何應援，結算後不會有任何金額變動。</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>觀眾</th>
						<th>應援</th>
						<th style="text-align:right">金額</th>
						<th style="text-align:right">領回</th>
						<th>結果</th>
					</tr>
				</thead>
				<tbody>
					{#each p.rows as r, i (i)}
						<tr>
							<td>{r.displayName}</td>
							<td>{sideName(r.side)}</td>
							<td class="n">{fmt(r.amount)}</td>
							<td class="n">{r.payout > 0 ? fmt(r.payout) : '—'}</td>
							<td>{r.result}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<p class="warn">
				總獎池 {fmt(p.totalPool)}　→　派出 {fmt(p.totalPayout)}
				{#if p.willForfeit}（整池 {fmt(p.remainder)} 由系統回收，不退還）
				{:else if p.remainder > 0}（除不盡餘 {fmt(p.remainder)} 留在系統）{/if}
			</p>
		{/if}

		<div class="actions">
			<form method="POST" action="?/settle">
				<input type="hidden" name="marketId" value={p.marketId} />
				<input type="hidden" name="side" value={p.side} />
				<button class="b {p.side === 'blue' ? 'b-blue' : 'b-red'}" type="submit">
					確認發放給{sideName(p.side)}
				</button>
			</form>
			<a class="b b-quiet" style="text-align:center;text-decoration:none;line-height:1.6" href="/admin/matches/{data.match.id}">
				取消
			</a>
		</div>
	</div>
{/if}

<!-- ── 賽制資訊 ──────────────────────────────────────── -->
<h2>賽制資訊</h2>
<p class="hint">
	企劃書的賽程表有無法自洽的地方（見規格書 §06），所以這些欄位都可以隨時修改。
</p>
<div class="panel">
	<form method="POST" action="?/updateMeta" class="field-row">
		<div class="field" style="flex:1;min-width:220px">
			<label for="rl">輪次名稱</label>
			<input id="rl" name="roundLabel" type="text" value={data.match.roundLabel} style="width:100%" />
		</div>
		<div class="field">
			<label for="fm">賽制</label>
			<select id="fm" name="format">
				<option value="BO1" selected={data.match.format === 'BO1'}>BO1</option>
				<option value="BO3" selected={data.match.format === 'BO3'}>BO3</option>
				<option value="BO5" selected={data.match.format === 'BO5'}>BO5</option>
			</select>
		</div>
		<div class="field">
			<label for="el">輸者淘汰</label>
			<label style="display:flex;align-items:center;gap:7px;height:39px;font-size:14px">
				<input id="el" name="isElimination" type="checkbox" checked={data.match.isElimination} />
				是
			</label>
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">儲存</button>
	</form>
	<p class="hint" style="margin:14px 0 0">
		改賽制會影響單局應援的數量（BO1 一局、BO3 三局、BO5 五局）。已開的應援場不會被刪除。
	</p>
</div>

<!-- ── 對戰組合 ──────────────────────────────────────── -->
<h2>對戰組合</h2>
<div class="panel">
	<form method="POST" action="?/setParticipants" class="field-row">
		<div class="field">
			<label for="blue">藍方</label>
			<select id="blue" name="blue">
				<option value="">未定</option>
				{#each data.participants as p (p.id)}
					<option value={p.id} selected={p.id === data.match.blueParticipantId}>{p.name}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="red">紅方</label>
			<select id="red" name="red">
				<option value="">未定</option>
				{#each data.participants as p (p.id)}
					<option value={p.id} selected={p.id === data.match.redParticipantId}>{p.name}</option>
				{/each}
			</select>
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">儲存</button>
	</form>
</div>

<!-- ── 比分與賽事狀態 ────────────────────────────────── -->
<h2>比分與賽事狀態</h2>
<div class="panel">
	<form method="POST" action="?/updateScore" class="field-row">
		<div class="field">
			<label for="sb">{blueName}</label>
			<input id="sb" name="scoreBlue" type="number" min="0" value={data.match.scoreBlue} style="width:90px" />
		</div>
		<div class="field">
			<label for="sr">{redName}</label>
			<input id="sr" name="scoreRed" type="number" min="0" value={data.match.scoreRed} style="width:90px" />
		</div>
		<div class="field">
			<label for="st">賽事狀態</label>
			<select id="st" name="state">
				<option value="pending" selected={data.match.state === 'pending'}>未開始</option>
				<option value="live" selected={data.match.state === 'live'}>進行中</option>
				<option value="done" selected={data.match.state === 'done'}>已結束</option>
				<option value="void" selected={data.match.state === 'void'}>已取消</option>
			</select>
		</div>
		<div class="field">
			<label for="ws">整場勝方</label>
			<select id="ws" name="winnerSide">
				<option value="">未定</option>
				<option value="blue" selected={data.match.winnerSide === 'blue'}>{blueName}</option>
				<option value="red" selected={data.match.winnerSide === 'red'}>{redName}</option>
			</select>
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">儲存</button>
	</form>
</div>

<!-- ── 應援場 ─────────────────────────────────────────── -->
<h2>應援場</h2>
<p class="hint">
	流程：開放應援 → 關閉應援 → 判定勝方 → 發放。
	<br />
	這次的玩法一場只開一個應援場（看整場勝負），所以下面只有一張卡片。
	<u>關閉應援之後，前台會停在這一場</u>，直到你在上面把場次狀態改成「已結束」才會換下一場。
</p>

<div class="market-grid">
	{#each slots as slot (slot.gameNo)}
		{@const m = marketOf(slot.gameNo)}
		{@const state = m?.state ?? 'pending'}
		<div class="market {state === 'open' ? 'is-open' : ''} {state === 'locked' ? 'is-locked' : ''}">
			<div class="market-head">
				<span class="market-title">{slot.label}</span>
				<span style="display:flex;gap:8px;align-items:center">
					{#if m}
						{@const secs = remaining(m.lockAt)}
						{#if state === 'open' && secs !== null && secs > 0}
							<span class="cd">{mmss(secs)}</span>
						{/if}
					{/if}
					<span class="tag t-{state}">{STATE_LABEL[state]}</span>
				</span>
			</div>

			{#if m}
				{@const total = m.poolBlue + m.poolRed}
				<div class="pools">
					{#if total === 0}
						<div class="pool-empty">尚無應援</div>
					{:else}
						{#if m.poolBlue > 0}
							<div class="pool-b" style="flex:{m.poolBlue}">{fmt(m.poolBlue)}</div>
						{/if}
						{#if m.poolRed > 0}
							<div class="pool-r" style="flex:{m.poolRed}">{fmt(m.poolRed)}</div>
						{/if}
					{/if}
				</div>
				<div class="pool-legend">
					<span>{blueName} {m.odds.blue ? m.odds.blue.toFixed(2) : '—'}</span>
					<span>池 {fmt(total)}</span>
					<span>{m.odds.red ? m.odds.red.toFixed(2) : '—'} {redName}</span>
				</div>
			{:else}
				<div class="pools"><div class="pool-empty">尚未開放應援</div></div>
				<div class="pool-legend"><span></span><span>—</span><span></span></div>
			{/if}

			<div class="actions">
				{#if state === 'pending' || !m}
					<form method="POST" action="?/openMarket">
						<input type="hidden" name="gameNo" value={slot.gameNo} />
						<button class="b b-go" type="submit">開放應援</button>
					</form>
				{:else if state === 'open'}
					<form method="POST" action="?/lockMarket">
						<input type="hidden" name="marketId" value={m.id} />
						<button class="b b-lock" type="submit">立即關閉應援</button>
					</form>
					<form method="POST" action="?/scheduleLock">
						<input type="hidden" name="marketId" value={m.id} />
						<input type="hidden" name="seconds" value="60" />
						<button class="b b-quiet" type="submit">60 秒後關閉應援</button>
					</form>
				{:else if state === 'locked'}
					<a class="b b-blue" style="text-align:center;text-decoration:none;line-height:1.6"
						href="?confirm={m.id}&side=blue">{blueName}獲勝</a>
					<a class="b b-red" style="text-align:center;text-decoration:none;line-height:1.6"
						href="?confirm={m.id}&side=red">{redName}獲勝</a>
					<form method="POST" action="?/voidMarket">
						<input type="hidden" name="marketId" value={m.id} />
						<input type="hidden" name="reason" value="平局或賽事取消" />
						<button class="b b-quiet" type="submit">取消並退還</button>
					</form>
				{:else}
					<span class="hint" style="margin:0">
						{#if m?.winnerSide}
							{sideName(m.winnerSide)}獲勝・已完成
						{:else}
							已取消，全數退還
						{/if}
					</span>
				{/if}
			</div>
		</div>
	{/each}
</div>

<!-- ── 刪除場次 ──────────────────────────────────────── -->
<h2>刪除場次</h2>
<div class="panel">
	<p class="hint" style="margin:0 0 12px">
		只有在還沒有人應援時才能刪除。已經有應援紀錄的場次請改用應援場的「取消並退還」。
	</p>
	<form method="POST" action="?/deleteMatch">
		<button class="b b-quiet" style="flex:0;color:var(--red);border-color:var(--red)" type="submit">
			刪除場次 {data.match.orderNo}
		</button>
	</form>
</div>
