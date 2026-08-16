<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TYPE_LABEL: Record<string, string> = {
		signup: '註冊贈送',
		purchase: '周邊訂單',
		bet: '下注',
		payout: '派彩',
		refund: '退款',
		adjust: '人工調整'
	};

	const fmt = (n: number) => n.toLocaleString('zh-TW');

	const when = (d: Date | string) =>
		new Date(d).toLocaleString('zh-TW', {
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<svelte:head>
	<title>終焉狗王大賽</title>
</svelte:head>

<h1>終焉狗王大賽</h1>

{#if !data.user}
	<div class="card">
		<p>用 Discord 登入即可領取 1,000 狗狗幣。</p>
		<p class="label">僅索取 IDENTIFY 權限，不會取得你的 EMAIL 或任何聯絡方式</p>
		<p><a class="btn" href="/auth/login" data-sveltekit-reload>使用 Discord 登入</a></p>
	</div>
{:else}
	<div class="card">
		<div class="row">
			{#if data.user.avatarUrl}
				<img class="avatar" src={data.user.avatarUrl} alt="" />
			{/if}
			<div>
				<div class="label">目前登入</div>
				<strong>{data.user.displayName}</strong>
				{#if data.user.isAdmin}<span class="label">・管理員</span>{/if}
				{#if data.user.isParticipant}<span class="label">・參賽者</span>{/if}
			</div>
		</div>
	</div>

	<div class="card">
		<div class="label">我的狗狗幣</div>
		<div class="balance">{fmt(data.balance)}</div>
		<p class="label">餘額由帳本加總得出，非儲存欄位</p>
	</div>

	<div class="card">
		<div class="label" style="margin-bottom:10px">交易紀錄</div>
		{#if data.history.length === 0}
			<p>還沒有任何紀錄。</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>時間</th>
						<th>類型</th>
						<th>說明</th>
						<th style="text-align:right">增減</th>
						<th style="text-align:right">餘額</th>
					</tr>
				</thead>
				<tbody>
					{#each data.history as row (row.id)}
						<tr>
							<td>{when(row.createdAt)}</td>
							<td>{TYPE_LABEL[row.type] ?? row.type}</td>
							<td>{row.note ?? ''}</td>
							<td class="num {row.amount >= 0 ? 'pos' : 'neg'}">
								{row.amount >= 0 ? '+' : ''}{fmt(row.amount)}
							</td>
							<td class="num">{fmt(row.balanceAfter)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<form method="POST" action="/auth/logout">
		<button class="btn ghost" type="submit">登出</button>
	</form>
{/if}
