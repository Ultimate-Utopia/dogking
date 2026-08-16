<script lang="ts">
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
<p class="hint">點任一場次進入控制台。開盤、封盤、判定勝負與派彩都在裡面。</p>

{#if form?.error}
	<div class="err">{form.error}</div>
{/if}

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
						<span>盤口 {m.marketCount}</span>
					{/if}
					{#if m.pooled > 0}
						<span>彩池 {fmt(m.pooled)}</span>
					{/if}
				</div>
			</div>
			<div style="display:flex;gap:6px;align-items:center">
				{#if m.openCount > 0}
					<span class="tag t-open">開放下注 {m.openCount}</span>
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
