<script lang="ts">
	/**
	 * 導覽列上的「身分卡」：頭像、名稱、持有狗狗幣、訂單備註碼放在同一格。
	 *
	 * 主辦方回饋：觀眾要買周邊時得先找到自己的備註碼，原本要另外點進
	 * 「獲得狗狗幣」頁才看得到。放到一直都看得到的導覽列上，點一下就複製。
	 *
	 * ⚠️ 這裡全是個人資料。首頁 HTML 會被 CDN 快取，所以這個元件在首頁
	 * 只能吃 /api/me（no-store）的資料，不能從伺服器端渲染帶進來。
	 */
	let {
		displayName,
		avatarUrl,
		balance,
		publicCode
	}: {
		displayName: string;
		avatarUrl: string | null;
		balance: number;
		publicCode: string | null;
	} = $props();

	let copied = $state(false);

	async function copy() {
		if (!publicCode) return;
		try {
			await navigator.clipboard.writeText(publicCode);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			// 沒有剪貼簿權限就算了，碼本來就顯示在畫面上
		}
	}
</script>

<div class="idcard">
	{#if avatarUrl}
		<img class="idcard-avatar" src={avatarUrl} alt="" width="34" height="34" />
	{/if}
	<div class="idcard-body">
		<div class="idcard-row">
			<span class="idcard-name">{displayName}</span>
			<span class="idcard-coins">{balance.toLocaleString('zh-TW')}<small>狗狗幣</small></span>
		</div>
		<div class="idcard-row">
			<span class="idcard-label">訂單備註碼</span>
			{#if publicCode}
				<button
					type="button"
					class="idcard-code"
					onclick={copy}
					title="點一下複製，下單時貼進訂單備註欄"
				>
					<span class="code">{publicCode}</span>
					<span class="hint">{copied ? '已複製' : '複製'}</span>
				</button>
			{:else}
				<span class="idcard-label">產生中…</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.idcard {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px 6px 7px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		min-width: 0;
	}
	.idcard-avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		flex: none;
		background: var(--line);
	}
	.idcard-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.idcard-row {
		display: flex;
		align-items: baseline;
		gap: 10px;
		justify-content: space-between;
		min-width: 0;
	}
	.idcard-name {
		font-size: 14px;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.idcard-coins {
		font-family: var(--mono);
		font-size: 16px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.idcard-coins small {
		font-family: inherit;
		font-size: 11px;
		font-weight: 500;
		color: var(--muted);
		margin-left: 4px;
	}
	.idcard-label {
		font-size: 11.5px;
		color: var(--muted);
		white-space: nowrap;
	}
	.idcard-code {
		display: inline-flex;
		align-items: baseline;
		gap: 7px;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		font: inherit;
		color: inherit;
	}
	.idcard-code .code {
		font-family: var(--mono);
		font-size: 14px;
		font-weight: 800;
		letter-spacing: 0.12em;
		color: var(--blue);
	}
	.idcard-code .hint {
		font-size: 11px;
		color: var(--muted);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.idcard-code:hover .hint {
		color: var(--blue);
	}
	.idcard-code:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
		border-radius: 4px;
	}
</style>
