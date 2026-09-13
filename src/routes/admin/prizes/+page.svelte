<script lang="ts">
	import { enhance } from '$app/forms';
	import PrizeCard from '$lib/components/PrizeCard.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** 圖片長邊上限。前台最大只顯示到 148px（手機全寬約 360px），800px 已經很夠 */
	const MAX_EDGE = 800;

	/** 每個獎品各自的圖片處理狀態，key 是獎品 id */
	let busy = $state<Record<number, string>>({});

	/**
	 * 在瀏覽器裡把圖片縮小、轉成 WebP，再放進隱藏欄位送出。
	 *
	 * 直接傳原圖的話，手機拍的照片動輒 3～5MB，會超過伺服器上限，
	 * 而且每個觀眾開首頁都要載一次。先縮再傳，伺服器端也不需要影像處理套件。
	 * 不支援輸出 WebP 的瀏覽器（舊版 Safari）會自動改用 JPEG。
	 */
	async function pickImage(e: Event, id: number) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		busy[id] = '處理圖片中…';
		try {
			const bitmap = await createImageBitmap(file);
			const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);
			canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

			let url = canvas.toDataURL('image/webp', 0.85);
			if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);

			const hidden = document.getElementById(`img-${id}`) as HTMLInputElement;
			hidden.value = url;
			busy[id] = '';
			hidden.form!.requestSubmit();
		} catch {
			busy[id] = '這個檔案讀不出來，請換一張 JPG 或 PNG';
		} finally {
			input.value = '';
		}
	}
</script>

<p style="margin:0 0 10px"><a href="/admin">← 回場次總覽</a></p>
<h1>獎品設定</h1>
<p class="hint">
	顯示在前台排行榜上方。存檔後首頁幾秒內就會更新。
	可以設多項，例如「第 1 名」與「第 2～3 名」分開列。
</p>

{#if form?.error}<div class="err">{form.error}</div>{/if}
{#if form?.success}<div class="ok-msg">{form.success}</div>{/if}

{#each data.prizes as p (p.id)}
	<div class="panel prize-edit">
		<div class="prize-cols">
			<!-- 左：文字欄位 -->
			<form method="POST" action="?/update" use:enhance class="prize-form">
				<input type="hidden" name="id" value={p.id} />
				<div class="field-row">
					<div class="field" style="flex:1;min-width:200px">
						<label for="n-{p.id}">品名</label>
						<input id="n-{p.id}" name="name" value={p.name} maxlength="40" required />
					</div>
					<div class="field" style="width:90px">
						<label for="o-{p.id}">顯示順序</label>
						<input id="o-{p.id}" name="sortOrder" type="number" value={p.sortOrder} />
					</div>
				</div>
				<div class="field">
					<label for="r-{p.id}">適用名次</label>
					<input id="r-{p.id}" name="ranksLabel" value={p.ranksLabel} maxlength="30" required />
					<span class="hint" style="margin:0">前台會顯示成「🏆 {p.ranksLabel}獎勵」</span>
				</div>
				<div class="field">
					<label for="f-{p.id}">特色（一行一項，最多 8 項）</label>
					<textarea id="f-{p.id}" name="features" rows="4">{p.features.join('\n')}</textarea>
				</div>
				<div class="actions">
					<button class="b b-go" type="submit">儲存文字</button>
				</div>
			</form>

			<!-- 右：圖片與預覽 -->
			<div class="prize-side">
				<div class="field">
					<span class="side-label">前台預覽（存檔後更新）</span>
					<PrizeCard prize={p} />
				</div>

				<form method="POST" action="?/setImage" use:enhance>
					<input type="hidden" name="id" value={p.id} />
					<input type="hidden" name="image" id="img-{p.id}" />
					<label class="b b-quiet file-btn">
						{p.imageUrl ? '更換圖片' : '上傳圖片'}
						<input
							type="file"
							accept="image/jpeg,image/png,image/webp"
							onchange={(e) => pickImage(e, p.id)}
						/>
					</label>
				</form>
				{#if busy[p.id]}<span class="hint" style="margin:0">{busy[p.id]}</span>{/if}

				<div class="actions">
					{#if p.imageUrl}
						<form method="POST" action="?/clearImage" use:enhance>
							<input type="hidden" name="id" value={p.id} />
							<button class="b b-quiet" type="submit">移除圖片</button>
						</form>
					{/if}
					<form
						method="POST"
						action="?/delete"
						use:enhance={({ cancel }) => {
							if (!confirm(`確定刪除「${p.name}」？前台會立刻不再顯示。`)) cancel();
						}}
					>
						<input type="hidden" name="id" value={p.id} />
						<button class="b b-quiet danger" type="submit">刪除這項獎品</button>
					</form>
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="panel"><p class="hint" style="margin:0">目前沒有獎品，前台不會顯示獎品區塊。</p></div>
{/each}

<h2>新增獎品</h2>
<div class="panel">
	<form method="POST" action="?/create" use:enhance class="prize-form">
		<div class="field-row">
			<div class="field" style="flex:1;min-width:200px">
				<label for="new-name">品名</label>
				<input id="new-name" name="name" maxlength="40" required />
			</div>
			<div class="field" style="width:90px">
				<label for="new-order">顯示順序</label>
				<input id="new-order" name="sortOrder" type="number" value={data.prizes.length + 1} />
			</div>
		</div>
		<div class="field">
			<label for="new-ranks">適用名次</label>
			<input id="new-ranks" name="ranksLabel" maxlength="30" placeholder="例如：第 1 名" required />
		</div>
		<div class="field">
			<label for="new-features">特色（一行一項）</label>
			<textarea id="new-features" name="features" rows="3"></textarea>
		</div>
		<p class="hint" style="margin:0">圖片在新增之後上傳。</p>
		<div class="actions">
			<button class="b b-go" type="submit">新增</button>
		</div>
	</form>
</div>

<style>
	.prize-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 24px;
	}
	@media (max-width: 760px) {
		.prize-cols {
			grid-template-columns: 1fr;
		}
	}
	.prize-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.prize-side {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.side-label {
		font-family: var(--mono);
		font-size: 10.5px;
		letter-spacing: 0.12em;
		color: var(--muted);
	}
	textarea {
		font-family: inherit;
		font-size: 15px;
		padding: 8px 10px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--surface);
		color: inherit;
		resize: vertical;
	}
	/* 把原生的檔案選擇器藏在按鈕底下，按鈕文字才看得懂 */
	.file-btn {
		position: relative;
		display: inline-block;
		text-align: center;
		overflow: hidden;
	}
	.file-btn input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.danger {
		color: var(--red);
		border-color: var(--red);
	}
</style>
