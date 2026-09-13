<script lang="ts">
	/**
	 * 排行榜獎品示意。
	 *
	 * 企劃書說排行榜「只是優越感」，但主辦方後來加了實體獎品 ——
	 * 這是推動觀眾買周邊換狗狗幣的主要誘因，所以放在排行榜正上方。
	 * 內容來自 src/lib/data/prizes.js。
	 */
	import { TOP_HOLDER_PRIZE as prize } from '$lib/data/prizes.js';
</script>

<div class="prize">
	<div class="prize-media">
		{#if prize.image}
			<img src={prize.image} alt="{prize.name}示意圖" loading="lazy" />
		{:else}
			<div class="prize-placeholder" aria-hidden="true">
				<span class="gem">💎</span>
				<span class="ph-text">示意圖準備中</span>
			</div>
		{/if}
	</div>

	<div class="prize-body">
		<span class="prize-ranks">🏆 {prize.ranks}獎勵</span>
		<h3 class="prize-name">{prize.name}</h3>
		<ul class="prize-features">
			{#each prize.features as f (f)}
				<li>{f}</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.prize {
		display: grid;
		grid-template-columns: 148px 1fr;
		gap: 18px;
		align-items: center;
		background: var(--surface);
		border: 1px solid var(--line);
		border-left: 4px solid var(--ok);
		border-radius: 10px;
		padding: 14px 18px 14px 14px;
	}

	.prize-media img,
	.prize-placeholder {
		width: 148px;
		height: 148px;
		border-radius: 8px;
		object-fit: cover;
		display: block;
	}
	.prize-placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: var(--paper);
		border: 1px dashed var(--line);
	}
	.gem {
		font-size: 38px;
		line-height: 1;
	}
	.ph-text {
		font-size: 11.5px;
		color: var(--muted);
	}

	.prize-ranks {
		display: inline-block;
		font-size: 12px;
		font-weight: 700;
		color: var(--ok);
		background: color-mix(in srgb, var(--ok) 12%, transparent);
		padding: 3px 9px;
		border-radius: 5px;
	}
	.prize-name {
		margin: 8px 0 8px;
		font-size: 22px;
		font-weight: 800;
		line-height: 1.3;
	}
	.prize-features {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 8px;
	}
	.prize-features li {
		font-size: 13.5px;
		padding: 3px 10px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--paper);
		white-space: nowrap;
	}

	/* 手機：圖放上面，文字在下 */
	@media (max-width: 520px) {
		.prize {
			grid-template-columns: 1fr;
			padding: 14px;
		}
		.prize-media img,
		.prize-placeholder {
			width: 100%;
			height: 180px;
		}
	}
</style>
