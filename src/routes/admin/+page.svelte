<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
