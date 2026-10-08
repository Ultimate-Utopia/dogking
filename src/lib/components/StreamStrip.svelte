<script lang="ts">
	/**
	 * 選手實況輪播。內容由後台「實況影片」編輯（/admin/streams）。
	 *
	 * ⚠️ 刻意不直接放 iframe，而是先放縮圖，按下播放才換成 iframe。
	 *
	 * 十幾支影片若一開頁就全部嵌入，等於每位觀眾開首頁都要向 YouTube 發出
	 * 十幾個請求、載入它的播放器程式，手機上會明顯變慢，而且還沒看就被放了追蹤 cookie。
	 * 播放時用 youtube-nocookie 網域。
	 */
	import { youTubeEmbedUrl, youTubeThumbUrl } from '$lib/youtube';

	let {
		streams
	}: {
		streams: Array<{
			id: number;
			videoId: string;
			title: string;
			who: string | null;
			whoDoro: string | null;
		}>;
	} = $props();

	/** 正在播放的那一支。一次只播一支，不然會好幾個聲音同時出來。 */
	let playing = $state<number | null>(null);

	/**
	 * 縮圖載不出來的影片。影片被刪掉或改成私人時，YouTube 的縮圖會回 404，
	 * 卡片就會變成一個空白方塊 —— 改成顯示標題，至少看得出那是什麼。
	 */
	let noThumb = $state<Record<number, boolean>>({});
</script>

<div class="strip-wrap">
	<div class="strip">
		{#each streams as s (s.id)}
			<div class="clip" class:on={playing === s.id}>
				{#if playing === s.id}
					<div class="clip-frame">
						<iframe
							src={youTubeEmbedUrl(s.videoId)}
							title={s.title}
							loading="lazy"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
							referrerpolicy="strict-origin-when-cross-origin"
							allowfullscreen
						></iframe>
					</div>
				{:else}
					<button class="clip-cover" onclick={() => (playing = s.id)}>
						{#if noThumb[s.id]}
							<span class="clip-fallback">{s.title}</span>
						{:else}
							<img
								src={youTubeThumbUrl(s.videoId)}
								alt=""
								loading="lazy"
								width="320"
								height="180"
								onerror={() => (noThumb[s.id] = true)}
							/>
						{/if}
						<span class="play" aria-hidden="true">▶</span>
						<span class="sr">播放：{s.title}</span>
					</button>
				{/if}

				<div class="clip-meta">
					{#if s.who}
						<span class="clip-who">
							{#if s.whoDoro}
								<img src="/participants/{s.whoDoro}-sm.webp" alt="" width="20" height="20" />
							{/if}
							{s.who}
						</span>
					{/if}
					<span class="clip-title">{s.title}</span>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	/* 橫向捲動的一排影片。手機上用手指滑，桌機用滑鼠拖或滾輪。 */
	.strip-wrap {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		padding-bottom: 6px;
	}
	.strip {
		display: flex;
		gap: 12px;
		min-width: min-content;
	}

	.clip {
		width: 260px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	/* 播放中的那一支放大，看得比較清楚 */
	.clip.on {
		width: 420px;
	}
	@media (max-width: 560px) {
		.clip,
		.clip.on {
			width: 272px;
		}
	}

	.clip-cover,
	.clip-frame {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 9px;
		overflow: hidden;
		border: 1px solid var(--line);
		background: var(--paper);
		padding: 0;
	}
	.clip-cover {
		cursor: pointer;
		display: block;
	}
	.clip-cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	/* YouTube 的 hqdefault 縮圖上下會有黑邊，用 scale 裁掉 */
	.clip-cover img {
		transform: scale(1.35);
	}
	.clip-cover .play {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 34px;
		color: #fff;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
		background: rgba(0, 0, 0, 0.25);
		transition: background 0.15s ease;
	}
	.clip-cover:hover .play {
		background: rgba(0, 0, 0, 0.1);
	}
	/* 縮圖載不出來時的替代畫面 */
	.clip-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 28px 14px;
		font-size: 13px;
		line-height: 1.6;
		text-align: center;
		color: var(--muted);
		background: var(--paper);
	}

	.clip-frame iframe {
		width: 100%;
		height: 100%;
		border: 0;
		display: block;
	}

	.clip-meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.clip-who {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		font-weight: 700;
	}
	.clip-who img {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--paper);
	}
	.clip-title {
		font-size: 12.5px;
		color: var(--muted);
		line-height: 1.5;
		/* 標題最多兩行，卡片高度才整齊 */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* 只給螢幕閱讀器的文字 */
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
