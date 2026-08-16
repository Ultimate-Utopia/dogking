<script lang="ts">
	import '../../app.css';
	import '../board.css';
	import './coins.css';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let copied = $state(false);

	const fmt = (n: number) => n.toLocaleString('zh-TW');

	async function copyCode() {
		if (!data.user.publicCode) return;
		try {
			await navigator.clipboard.writeText(data.user.publicCode);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// 沒有剪貼簿權限就算了，代碼本來就看得到
		}
	}
</script>

<svelte:head>
	<title>獲得狗狗幣 — 終焉狗王大賽</title>
</svelte:head>

<div class="topbar">
	<div class="topbar-in">
		<a class="brand" href="/">終焉狗王大賽</a>
		<div class="purse">
			<span class="who">{data.user.displayName}</span>
			<span class="coins">{fmt(data.balance)}</span>
			<span class="who">狗狗幣</span>
		</div>
	</div>
</div>

<div class="board">
	<p style="margin:0 0 14px"><a href="/">← 回賭盤</a></p>
	<h1 style="font-size:24px;margin:0 0 6px">獲得狗狗幣</h1>
	<p style="color:var(--muted);margin:0 0 24px">
		購買本次大賽的合作周邊，即可依訂單金額等比例獲得狗狗幣。
	</p>

	{#if form?.success}<div class="msg-ok">{form.success}</div>{/if}
	{#if form?.error}<div class="msg-err">{form.error}</div>{/if}

	<!-- ── 我的代碼 ──────────────────────────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>你的專屬代碼</h2>
		<p style="margin:0 0 14px;color:var(--muted);font-size:14px">
			下單時請把這組代碼填進<strong>訂單備註欄</strong>，我們才知道要把狗狗幣發給誰。
		</p>

		<div class="code-box">
			<span class="code">{data.user.publicCode ?? '產生中…'}</span>
			<button class="copy" onclick={copyCode}>{copied ? '已複製' : '複製'}</button>
		</div>

		<p class="warn-line">
			填錯或忘記填也沒關係 —— 跟主辦方聯繫，我們會補一組兌換碼給你。
		</p>
	</div>

	<!-- ── 換算與步驟 ────────────────────────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>換算方式</h2>
		<div class="rate">
			<span class="rate-a">NT$ 1</span>
			<span class="rate-eq">=</span>
			<span class="rate-b">{data.rate} 狗狗幣</span>
		</div>
		<div class="examples">
			<div><span>NT$ 300</span><b>{fmt(300 * data.rate)}</b></div>
			<div><span>NT$ 500</span><b>{fmt(500 * data.rate)}</b></div>
			<div><span>NT$ 1,000</span><b>{fmt(1000 * data.rate)}</b></div>
		</div>

		<ol class="steps">
			<li>到賣貨便或綠界商店下單購買周邊</li>
			<li>在<strong>訂單備註</strong>填上你的專屬代碼</li>
			<li>主辦方核對訂單後發放，通常在對帳作業後統一處理</li>
		</ol>
	</div>

	<!-- ── 兌換碼 ────────────────────────────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>使用兌換碼</h2>
		<p style="margin:0 0 14px;color:var(--muted);font-size:14px">
			如果主辦方給了你一組兌換碼，在這裡輸入即可入帳。
		</p>
		<form method="POST" action="?/redeem" class="redeem-row">
			<input
				name="code"
				type="text"
				placeholder="XXXX-XXXX-XXXX"
				autocomplete="off"
				spellcheck="false"
			/>
			<button type="submit">兌換</button>
		</form>
	</div>

	<div class="foot">
		<strong>狗狗幣無實際金錢價值，僅供娛樂用途。</strong>
		不可轉讓、不可兌換現金，活動結束後全數回收。<br />
		購買周邊獲得的狗狗幣，不影響周邊本身的出貨與售後。
	</div>
</div>
