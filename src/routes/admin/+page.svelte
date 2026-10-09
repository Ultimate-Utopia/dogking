<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const nextOrderNo = $derived(Math.max(0, ...data.matches.map((m) => m.orderNo)) + 1);

	const fmt = (n: number) => n.toLocaleString('zh-TW');

	const when = (d: Date | string) =>
		new Date(d).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

	const STATE_LABEL: Record<string, string> = {
		pending: '未開始',
		live: '進行中',
		done: '已結束',
		void: '已取消'
	};
</script>

<h1>場次總覽</h1>
<p class="hint">點任一場次進入控制台。開放應援、關閉應援、判定勝負與發放都在裡面。</p>

{#if form && 'error' in form && form.error}
	<div class="err">{form.error}</div>
{/if}
{#if form && 'success' in form && form.success}
	<div class="ok-msg">{form.success}</div>
{/if}

<div class="panel">
	<p class="hint" style="margin:0 0 12px">
		<strong>活動開始前按一次「開放全部場次」。</strong>
		這次的玩法是所有場次一開場就能應援（連還沒確定對手的也能應援），
		主持人在每場開打前約一分鐘進去那一場按「關閉應援」或設 60 秒倒數。
		<u>已經關閉應援或已發放的場次不會被重新打開。</u>
	</p>
	<form
		method="POST"
		action="?/openAll"
		use:enhance={({ cancel }) => {
			if (!confirm('要開放所有還沒開放的場次嗎？開放後觀眾就能開始應援。')) cancel();
		}}
	>
		<button class="b b-go" style="flex:0" type="submit">開放全部場次的整場應援</button>
	</form>
</div>

<div class="match-list">
	{#each data.matches as m (m.id)}
		<a class="match-row" href="/admin/matches/{m.id}">
			<div class="match-no">{m.orderNo}</div>
			<div>
				<div class="match-vs">
					{#if m.blueName && m.redName}
						{m.blueName} <span style="color:var(--muted)">vs</span> {m.redName}
					{:else}
						<span style="color:var(--muted)">對戰組合待定</span>
					{/if}
				</div>
				<div class="match-meta">
					<span>{m.roundLabel}</span>
					<span>{m.format}</span>
					{#if m.isElimination}<span>輸者淘汰</span>{/if}
					{#if m.marketCount > 0}
						<span>應援場 {m.marketCount}</span>
					{/if}
					{#if m.pooled > 0}
						<span>獎池 {fmt(m.pooled)}</span>
					{/if}
				</div>
			</div>
			<div style="display:flex;gap:6px;align-items:center">
				{#if m.openCount > 0}
					<span class="tag t-open">開放應援 {m.openCount}</span>
				{:else if m.lockedCount > 0}
					<span class="tag t-locked">待結算 {m.lockedCount}</span>
				{:else}
					<span class="tag t-{m.state}">{STATE_LABEL[m.state] ?? m.state}</span>
				{/if}
			</div>
		</a>
	{/each}
</div>

<h2>新增場次</h2>
<p class="hint">
	賽程比預期長時使用（例如需要補一場勝部決賽）。企劃書的場次數與 9 人雙敗淘汰所需的場數對不上，見規格書 §06。
</p>
<div class="panel">
	<form method="POST" action="?/createMatch" class="field-row">
		<div class="field">
			<label for="on">場次編號</label>
			<input id="on" name="orderNo" type="number" min="1" value={nextOrderNo} style="width:110px" />
		</div>
		<div class="field" style="flex:1;min-width:200px">
			<label for="nrl">輪次名稱</label>
			<input id="nrl" name="roundLabel" type="text" placeholder="例：勝部決賽" style="width:100%" />
		</div>
		<div class="field">
			<label for="nfm">賽制</label>
			<select id="nfm" name="format">
				<option value="BO1">BO1</option>
				<option value="BO3" selected>BO3</option>
				<option value="BO5">BO5</option>
			</select>
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">新增</button>
	</form>
</div>

<h2>預測戰績</h2>
<p class="hint">
	依猜中場次數排序，<b>全部列出</b>（{data.predictions.length} 人）。名字就是 Discord 顯示名稱。
	只算<b>已結算</b>的應援 —— 還沒開賽的不算（不然剛應援的人看起來很準），
	整場取消退還的也不算（那不是猜錯）。
	<b>不論投入多少、什麼時候應援，猜中一次就是一次</b>，所以次數相同即為並列，抽獎時機會一樣。
</p>
{#if data.predictions.length === 0}
	<p class="hint">還沒有任何已結算的應援。</p>
{:else}
	<div class="panel" style="overflow-x:auto">
		<table class="pred">
			<thead>
				<tr>
					<th>名次</th>
					<th>觀眾（Discord）</th>
					<th class="n">猜中</th>
					<th class="n">已結算</th>
					<th class="n">命中率</th>
					<th class="n">投入</th>
					<th class="n">領回</th>
					<th class="n">淨損益</th>
				</tr>
			</thead>
			<tbody>
				{#each data.predictions as p (p.displayName)}
					<tr class:tied={p.rank === 1}>
						<td>{p.rank}</td>
						<td>{p.displayName}</td>
						<td class="n"><b>{p.won}</b></td>
						<td class="n">{p.total}</td>
						<td class="n">{p.rate}%</td>
						<td class="n">{fmt(p.staked)}</td>
						<td class="n">{fmt(p.returned)}</td>
						<td class="n" class:up={p.net > 0} class:down={p.net < 0}>
							{p.net > 0 ? '+' : ''}{fmt(p.net)}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>近期操作紀錄</h2>
{#if data.logs.length === 0}
	<p class="hint">還沒有任何操作。</p>
{:else}
	<div class="panel log">
		{#each data.logs as l (l.id)}
			<div>{when(l.createdAt)} &nbsp; <b>{l.adminName}</b> &nbsp; {l.action} &nbsp; {l.target ?? ''}</div>
		{/each}
	</div>
{/if}
