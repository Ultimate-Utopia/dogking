<script lang="ts">
	import '../../app.css';
	import '../board.css';
	import './coins.css';
	import IdCard from '$lib/components/IdCard.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let copied = $state(false);

	const fmt = (n: number) => n.toLocaleString('zh-TW');

	type Row = PageData['history'][number];

	/**
	 * 一筆紀錄的說明文字。
	 *
	 * 下注與派彩一定要講出是哪一場哪一局 ——
	 * 不然整列都是「下注 −500」，觀眾根本對不上賬。
	 * note 是後台寫的（訂單編號、兌換券碼等），沒場次時拿它頂。
	 */
	function describe(h: Row) {
		if (h.matchOrderNo !== null) {
			const game = h.gameNo === 0 ? '整場勝負' : `第 ${h.gameNo} 局`;
			return `第 ${h.matchOrderNo} 場・${h.roundLabel}・${game}`;
		}
		return h.note ?? '';
	}

	/** 下注是支出，人工調整用中性色提醒要多看一眼，其餘都是入帳。 */
	function tagClass(type: string) {
		if (type === 'bet') return 'down';
		if (type === 'adjust') return 'note';
		return 'up';
	}

	/** 活動只跑一個下午，「月/日 時:分」就夠讀。 */
	function when(iso: string) {
		const d = new Date(iso);
		const p2 = (n: number) => String(n).padStart(2, '0');
		return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
	}

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
			<IdCard
				displayName={data.user.displayName}
				avatarUrl={data.user.avatarUrl}
				balance={data.balance}
				publicCode={data.user.publicCode}
			/>
		</div>
	</div>
</div>

<div class="board">
	<p style="margin:0 0 14px"><a href="/">← 回賭盤</a></p>
	<h1 style="font-size:24px;margin:0 0 6px">獲得狗狗幣</h1>
	<p style="color:var(--muted);margin:0 0 14px;line-height:1.85">
		在本次指定活動賣場「終焉狗王大賽」購買活動周邊，即可獲贈狗狗幣。<br />
		符合資格商品贈送比例每消費 NT$1 獲贈 {data.rate} 狗狗幣（不包含運費）。
	</p>
	<p style="margin:0 0 24px">
		<a class="shop-link" href="https://bowwowking.cashier.ecpay.com.tw/" target="_blank" rel="noopener noreferrer">
			<span aria-hidden="true">🛒</span> 前往活動賣場「終焉狗王大賽」
		</a>
	</p>

	{#if form?.success}<div class="msg-ok">{form.success}</div>{/if}
	{#if form?.error}<div class="msg-err">{form.error}</div>{/if}

	<!-- ── 我的代碼 ──────────────────────────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>你的訂單備註碼</h2>
		<ol class="note-list" style="margin:0 0 14px">
			<li>結帳時請務必將「訂單備註碼」填入「訂單備註」欄位，以利系統連結活動帳號。</li>
			<li>請妥善保管訂單號碼、訂單備註碼，並勿分享他人。</li>
		</ol>

		<div class="code-box">
			<span class="code">{data.user.publicCode ?? '產生中…'}</span>
			<button class="copy" onclick={copyCode}>{copied ? '已複製' : '複製'}</button>
		</div>

		<ol class="note-list" style="margin:14px 0 0">
			<li>英文大小寫將影響派發，請務必正確填寫。</li>
			<li>備註欄位請填寫「訂單備註碼」即可，填寫額外資訊皆會造成派發失敗。</li>
			<li>若因誤填寫他人的訂單備註碼，致狗狗幣已贈送至他活動帳號，主辦不再補發。</li>
			<li>填寫錯誤或忘記填寫，請至 DC 應援客服中心回報。</li>
		</ol>
	</div>

	<!-- ── 換算與步驟 ────────────────────────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>狗狗幣贈送比例</h2>
		<div class="rate">
			<span class="rate-b">每消費 NT$1 獲贈 {data.rate} 狗狗幣</span>
		</div>

		<ol class="steps">
			<li>活動期間至指定活動商店「終焉狗王大賽」購買活動周邊</li>
			<li>付款時將「訂單備註碼」填入「訂單備註」欄位</li>
			<li>應援活動期間內「付款成功」訂單方符合派發資格</li>
			<li>主辦方核對訂單後批次更新，更新時間為每日晚間 21:00，比賽當天約 15 分鐘更新一次</li>
			<li>英文大小寫將影響派發，請務必正確填寫</li>
			<li>若因誤填寫他人的訂單備註碼，致狗狗幣已贈送至他活動帳號，主辦不再補發</li>
			<li>填寫錯誤或忘記填寫，請至 DC 應援客服中心回報</li>
		</ol>
	</div>

	<!-- ── 兌換券 ────────────────────────────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>兌換狗狗幣</h2>
		<p style="margin:0 0 14px;color:var(--muted);font-size:14px">
			如果主辦方給了你一張兌換券，在這裡輸入即可入帳。
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

	<!-- ── 狗狗幣紀錄（企劃書 §一）─────────────── -->
	<div class="card2" style="margin-bottom:16px">
		<h2>狗狗幣紀錄</h2>
		<p style="margin:0 0 14px;color:var(--muted);font-size:14px">
			每一筆進出都在這裡，新的在上面。最多顯示最近 60 筆。
		</p>

		{#if data.history.length}
			<div class="hist">
				{#each data.history as h (h.id)}
					<div class="hist-row">
						<span class="hist-tag {tagClass(h.type)}">{h.label}</span>
						<span class="hist-what">{describe(h)}</span>
						<span class="hist-amt {h.amount > 0 ? 'up' : h.amount < 0 ? 'down' : ''}">
							{h.amount > 0 ? '+' : ''}{fmt(h.amount)}
						</span>
						<span class="hist-after">餘 {fmt(h.balanceAfter)}</span>
						<span class="hist-time">{when(h.createdAt)}</span>
					</div>
				{/each}
			</div>
		{:else}
			<p style="margin:0;color:var(--muted)">還沒有任何紀錄。</p>
		{/if}
	</div>

	<div class="card2">
		<h2>狗狗幣取得注意事項</h2>
		<ol class="note-list">
			<li>狗狗幣為《終焉狗王大賽》限定之娛樂性虛擬點數，不具有現金價值，不得出售、轉讓或兌換現金。</li>
			<li>購買活動指定商品，可依實際商品付款金額（不含運費）獲贈狗狗幣，贈送比例為每消費 NT$1 獲贈 {data.rate} 狗狗幣。</li>
			<li>狗狗幣於訂單付款成功並符合活動資格後發放，實際入帳時間依主辦方公告為準。</li>
			<li>訂單備註碼為辨識活動帳號之依據，請於結帳時正確填寫，並妥善保管，不得提供他人使用。</li>
			<li>如未填寫或錯誤填寫備註碼，請聯繫主辦方客服協助處理。</li>
			<li>訂單如發生取消、退款或判定無效，主辦方得取消該筆訂單贈送之狗狗幣，並依活動紀錄調整相關餘額。</li>
			<li>最終場次開始後，透過活動商城消費所獲贈之狗狗幣將不再更新，請留意主辦方公告之截止時間。</li>
			<li>狗狗幣僅限本次活動使用，活動結束後剩餘點數即失效，不得要求折現或轉移至其他活動。</li>
			<li>如發現狗狗幣發放異常、訂單對應錯誤或紀錄有誤，請透過指定客服管道聯繫主辦方查詢。</li>
		</ol>
	</div>
</div>
