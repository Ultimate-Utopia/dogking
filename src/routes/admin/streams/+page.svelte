<script lang="ts">
	import { enhance } from '$app/forms';
	import { youTubeThumbUrl, youTubeWatchUrl } from '$lib/youtube';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<p style="margin:0 0 10px"><a href="/admin">← 回場次總覽</a></p>
<h1>實況影片</h1>
<p class="hint">
	顯示在前台「選手實況回顧」。觀眾可以先看選手過去的表現，再決定要應援誰。
	<strong>YouTube 的網址直接貼上就好</strong> —— 影片、直播、Shorts、手機分享的短網址都認得。
	存檔後首頁幾秒內就會更新。
</p>

{#if form?.error}<div class="err">{form.error}</div>{/if}
{#if form?.success}<div class="ok-msg">{form.success}</div>{/if}

{#each data.streams as s (s.id)}
	<div class="panel">
		<div class="stream-row">
			<a class="stream-thumb" href={youTubeWatchUrl(s.videoId)} target="_blank" rel="noopener noreferrer">
				<img src={youTubeThumbUrl(s.videoId)} alt="" width="160" height="90" loading="lazy" />
			</a>

			<form method="POST" action="?/update" use:enhance class="stream-form">
				<input type="hidden" name="id" value={s.id} />
				<div class="field-row">
					<div class="field" style="flex:1;min-width:220px">
						<label for="t-{s.id}">標題</label>
						<input id="t-{s.id}" name="title" value={s.title} maxlength="80" required />
					</div>
					<div class="field" style="width:150px">
						<label for="p-{s.id}">選手</label>
						<select id="p-{s.id}" name="participantId">
							<option value="">（不指定）</option>
							{#each data.people as p (p.id)}
								<option value={p.id} selected={p.name === s.who}>{p.name}</option>
							{/each}
						</select>
					</div>
					<div class="field" style="width:90px">
						<label for="o-{s.id}">順序</label>
						<input id="o-{s.id}" name="sortOrder" type="number" value={s.sortOrder} />
					</div>
				</div>
				<div class="field">
					<label for="u-{s.id}">YouTube 網址</label>
					<input id="u-{s.id}" name="url" value={youTubeWatchUrl(s.videoId)} required />
				</div>
				<div class="actions">
					<button class="b b-go" type="submit">儲存</button>
					<!-- 刪除按鈕屬於下面那個表單（HTML 不能把表單疊在表單裡） -->
					<button class="b b-quiet danger" type="submit" form="del-{s.id}">刪除</button>
				</div>
			</form>

			<form
				method="POST"
				action="?/delete"
				id="del-{s.id}"
				use:enhance={({ cancel }) => {
					if (!confirm(`確定刪除「${s.title}」？前台會立刻不再顯示。`)) cancel();
				}}
			>
				<input type="hidden" name="id" value={s.id} />
			</form>
		</div>
	</div>
{:else}
	<div class="panel">
		<p class="hint" style="margin:0">目前沒有影片，前台不會顯示這個區塊。</p>
	</div>
{/each}

<h2>新增影片</h2>
<div class="panel">
	<form method="POST" action="?/create" use:enhance class="stream-form">
		<div class="field">
			<label for="new-url">YouTube 網址</label>
			<input id="new-url" name="url" placeholder="https://www.youtube.com/watch?v=..." required />
		</div>
		<div class="field-row">
			<div class="field" style="flex:1;min-width:220px">
				<label for="new-title">標題</label>
				<input id="new-title" name="title" maxlength="80" placeholder="例如：呦呦 上次 Bow-wow 大亂鬥" required />
			</div>
			<div class="field" style="width:150px">
				<label for="new-p">選手</label>
				<select id="new-p" name="participantId">
					<option value="">（不指定）</option>
					{#each data.people as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
			<div class="field" style="width:90px">
				<label for="new-o">順序</label>
				<input id="new-o" name="sortOrder" type="number" value={data.streams.length + 1} />
			</div>
		</div>
		<div class="actions">
			<button class="b b-go" type="submit">新增</button>
		</div>
	</form>
</div>

<style>
	.stream-row {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.stream-thumb {
		flex: none;
		line-height: 0;
	}
	.stream-thumb img {
		width: 160px;
		height: 90px;
		object-fit: cover;
		border-radius: 7px;
		border: 1px solid var(--line);
		/* hqdefault 縮圖上下有黑邊，放大裁掉 */
		transform: scale(1.35);
		clip-path: inset(13% 0);
	}
	.stream-form {
		flex: 1;
		min-width: 280px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.danger {
		color: var(--red);
		border-color: var(--red);
	}
</style>
