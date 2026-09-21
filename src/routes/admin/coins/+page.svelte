<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import { readXlsx, toCsv, XlsxError } from '$lib/xlsx';
	import { parseCsv, stripUnusedColumns, detectFormat } from '$lib/order-formats';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const fmt = (n: number) => n.toLocaleString('zh-TW');
	const when = (d: Date | string) =>
		new Date(d).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

	const STATUS: Record<string, { label: string; cls: string }> = {
		ready: { label: '可發放', cls: 't-open' },
		'no-code': { label: '沒填代碼', cls: 't-locked' },
		'unknown-code': { label: '查無此代碼', cls: 't-void' },
		'already-credited': { label: '已發放過', cls: 't-settled' },
		'bad-amount': { label: '金額有問題', cls: 't-void' },
		'not-paid': { label: '尚未付款', cls: 't-settled' },
		'voucher-issued': { label: '已開兌換券', cls: 't-locked' },
		'voucher-used': { label: '券已兌換', cls: 't-settled' },
		cancelled: { label: '已取消', cls: 't-settled' },
		merged: { label: '已併入其他訂單', cls: 't-settled' }
	};

	/** 這幾種是平台上的狀態造成的，不是操作員要處理的問題，等付款後重匯即可 */
	const WAITING = new Set([
		'not-paid',
		'cancelled',
		'merged',
		'already-credited',
		'voucher-issued',
		'voucher-used'
	]);

	/** 需要開券的：已付款、但代碼對不到帳號 */
	const NEEDS_VOUCHER = new Set(['no-code', 'unknown-code']);

	let csvText = $state('');
	let fileName = $state('');
	let fileError = $state('');

	/**
	 * 讀取選擇的檔案，放進下方的文字框。
	 *
	 * 先當 UTF-8 解，解不開再試 Big5 —— 賣貨便的 CSV 是 UTF-8，
	 * 但舊版 Excel 另存的 CSV 常常是 Big5，直接當 UTF-8 讀會變亂碼。
	 * 伺服器端完全不變：拿到的一樣是文字，和手動貼上走同一條路。
	 */
	let previewForm = $state<HTMLFormElement | null>(null);
	let reading = $state(false);

	/** 檔案裡認出的格式，顯示給操作員確認 */
	const FORMAT_LABEL: Record<string, string> = {
		myship: '賣貨便',
		ecpay: '綠界商店',
		'ecpay-donation': '綠界贊助頁（不能用）',
		columns: '未知格式'
	};
	let fileFormat = $state('');

	/**
	 * 讀取選擇的檔案 → 在瀏覽器裡拿掉個資欄位 → 自動送出預覽。
	 *
	 * 主辦方要能用手機操作，所以步驟壓到最少：選檔之後就直接出現預覽，
	 * 不必再按一次「預覽」。預覽本身不會發任何幣。
	 *
	 * Excel（.xlsx）在瀏覽器裡直接讀，不必先轉 CSV —— 綠界的 CSV 匯出會亂序，
	 * 只有 Excel 版是對的。CSV 則先當 UTF-8 解，解不開再試 Big5（舊版 Excel 另存的常見編碼）。
	 *
	 * 送到伺服器的仍然是 CSV 文字，伺服器端完全不用區分檔案類型。
	 */
	async function readFile(e: Event) {
		fileError = '';
		fileFormat = '';
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		reading = true;
		try {
			let rows: string[][];
			if (/\.xlsx$/i.test(file.name)) {
				if (typeof DecompressionStream === 'undefined') {
					throw new XlsxError('這個瀏覽器太舊，讀不了 Excel。請更新瀏覽器，或改用電腦操作。');
				}
				rows = await readXlsx(await file.arrayBuffer());
			} else if (/\.xls$/i.test(file.name)) {
				throw new XlsxError('這是舊版 Excel（.xls）。請用 Excel 另存為 .xlsx 或 CSV 再選一次。');
			} else {
				const bytes = new Uint8Array(await file.arrayBuffer());
				let text: string;
				try {
					text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
				} catch {
					text = new TextDecoder('big5').decode(bytes);
				}
				rows = parseCsv(text);
			}

			if (!rows.length) throw new XlsxError('檔案裡沒有任何資料');

			const format = detectFormat(rows);
			fileFormat = FORMAT_LABEL[format] ?? format;
			csvText = toCsv(stripUnusedColumns(rows));
			fileName = file.name;

			// 認得出格式才自動預覽；認不出來要先讓操作員指定欄位
			if (format !== 'columns') {
				await tick();
				previewForm?.requestSubmit();
			}
		} catch (err) {
			fileError = err instanceof XlsxError ? err.message : '檔案讀不出來，請確認是從平台匯出的 Excel 或 CSV';
			csvText = '';
			fileName = '';
		} finally {
			reading = false;
			// 清掉選擇，同一個檔案改過之後再選一次也會觸發
			input.value = '';
		}
	}

	const ctx = $derived(form && 'imported' in form ? form.imported : null);
	const issued = $derived(ctx?.issued ?? null);
	const preview = $derived(ctx?.preview ?? null);
	const readyRows = $derived(preview?.filter((r) => r.status === 'ready') ?? []);
	const readyChips = $derived(readyRows.reduce((a, r) => a + r.chips, 0));
	const problemRows = $derived(
		preview?.filter((r) => r.status !== 'ready' && !WAITING.has(r.status)) ?? []
	);
	const waitingRows = $derived(preview?.filter((r) => WAITING.has(r.status)) ?? []);
</script>

<p style="margin:0 0 10px"><a href="/admin">← 回場次總覽</a>　<a href="/admin/handbook">發幣作業手冊</a></p>
<h1>狗狗幣發放</h1>
<p class="hint">
	換算比例 NT$1 = {data.rate} 狗狗幣。主線是匯入訂單 CSV 自動比對，
	買家漏填備註碼時改發兌換券補救。
</p>

{#if form?.error}<div class="err">{form.error}</div>{/if}
{#if form?.success}<div class="ok-msg">{form.success}</div>{/if}
{#if issued}
	<div class="panel" style="border-color:var(--ok)">
		<h2 style="margin:0 0 8px">
			{issued.reused ? '這張訂單先前已經開過券' : '已為訂單開出兌換券'}
		</h2>
		<p class="hint" style="margin:0 0 10px">
			訂單 <code>{issued.orderRef}</code>　面額 <b>{fmt(issued.amount)}</b> 狗狗幣。
			請用該平台的<strong>訂單留言</strong>把券碼發給買家，不要貼在公開的地方。
		</p>
		<textarea class="codes-out" readonly rows="1">{issued.code}</textarea>
	</div>
{/if}

<!-- ── 產生出來的兌換券 ──────────────────────────────── -->
{#if form && 'codes' in form && form.codes}
	<div class="panel" style="border-color:var(--ok)">
		<h2 style="margin:0 0 10px">新產生的兌換券</h2>
		<p class="hint" style="margin:0 0 12px">
			請立刻複製保存 —— 這是唯一一次完整顯示的機會，之後只會列在下方未使用清單。
		</p>
		<textarea class="codes-out" readonly rows={Math.min(form.codes.length + 1, 12)}
			>{form.codes.join('\n')}</textarea>
	</div>
{/if}

<!-- ── 匯入預覽 ──────────────────────────────────────── -->
{#if preview}
	<div class="confirm">
		<h3>匯入預覽 —— 尚未發放</h3>
		{#if ctx?.format === 'myship'}
			<p class="hint" style="margin:0 0 8px">
				已辨識為<strong>賣貨便匯出檔</strong>：只發放已付款的訂單，計幣金額<strong>不含運費</strong>。
			</p>
		{/if}
		<p class="warn">
			共 {preview.length} 筆，其中 <strong>{readyRows.length} 筆可發放</strong>，
			合計 <strong>{fmt(readyChips)}</strong> 狗狗幣。
			{#if problemRows.length}有 {problemRows.length} 筆需要處理。{/if}
			{#if waitingRows.length}
				另有 {waitingRows.length} 筆未付款、已取消、已合併或已發過，這次不會發，之後重匯同一份檔案也不會重複。
			{/if}
		</p>

		<div style="max-height:340px;overflow:auto;margin-bottom:16px">
			<table>
				<thead>
					<tr>
						<th>訂單編號</th>
						<th>平台狀態</th>
						<th>計幣金額</th>
						<th>備註中的代碼</th>
						<th>對應帳號</th>
						<th style="text-align:right">狗狗幣</th>
						<th>狀態</th>
						<th>處理</th>
					</tr>
				</thead>
				<tbody>
					{#each preview as r, i (i)}
						<tr>
							<td style="font-family:var(--mono);font-size:12.5px">{r.orderRef}</td>
							<td style="font-size:12.5px;white-space:nowrap">{r.statusText || '—'}</td>
							<td class="n" title={r.totalTwd !== r.amountTwd ? `實付 ${r.totalTwd}（含運費）` : ''}>
								{Number.isFinite(r.amountTwd) ? fmt(r.amountTwd) : '—'}
							</td>
							<td style="font-family:var(--mono)">{r.code ?? '—'}</td>
							<td>{r.displayName ?? '—'}</td>
							<td class="n">{r.status === 'ready' ? fmt(r.chips) : '—'}</td>
							<td><span class="tag {STATUS[r.status]?.cls}">{STATUS[r.status]?.label}</span></td>
							<td>
								{#if NEEDS_VOUCHER.has(r.status)}
									<form method="POST" action="?/issueCode" use:enhance>
										<input type="hidden" name="orderRef" value={r.orderRef} />
										<input type="hidden" name="amountTwd" value={r.amountTwd} />
										<input type="hidden" name="platform" value={ctx?.platform ?? ''} />
										<input type="hidden" name="csv" value={ctx?.csv ?? ''} />
										{#if ctx?.hasHeader}<input type="hidden" name="hasHeader" value="on" />{/if}
										<input type="hidden" name="colOrderRef" value={ctx?.cols.orderRef ?? 0} />
										<input type="hidden" name="colAmount" value={ctx?.cols.amount ?? 1} />
										<input type="hidden" name="colNote" value={ctx?.cols.note ?? 2} />
										<button class="b b-quiet" style="flex:0;padding:5px 10px;font-size:12.5px" type="submit">
											開兌換券
										</button>
									</form>
								{:else if r.voucher}
									<span class="voucher-cell">
										<code>{r.voucher.code}</code>
										{r.voucher.used ? '已兌換' : '未兌換'}
									</span>
								{:else}
									—
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if problemRows.length}
			<p class="warn">
				對不到帳號的訂單，請用下方「產生兌換券」開對應面額的券，再用訂單留言發給買家。
			</p>
		{/if}

		<div class="actions">
			<!-- 帶回原始 CSV 而非預覽結果：伺服器端會重新推導一次，
			     避免預覽到確認之間資料已經被別人改過 -->
			<form method="POST" action="?/commit">
				<input type="hidden" name="platform" value={ctx?.platform ?? ''} />
				<input type="hidden" name="csv" value={ctx?.csv ?? ''} />
				{#if ctx?.hasHeader}
					<input type="hidden" name="hasHeader" value="on" />
				{/if}
				<input type="hidden" name="colOrderRef" value={ctx?.cols.orderRef ?? 0} />
				<input type="hidden" name="colAmount" value={ctx?.cols.amount ?? 1} />
				<input type="hidden" name="colNote" value={ctx?.cols.note ?? 2} />
				<button class="b b-go" type="submit" disabled={readyRows.length === 0}>
					確認發放 {readyRows.length} 筆
				</button>
			</form>
			<a class="b b-quiet" style="text-align:center;text-decoration:none;line-height:1.6" href="/admin/coins">
				取消
			</a>
		</div>
	</div>
{/if}

<!-- ── 匯入表單 ──────────────────────────────────────── -->
<h2>匯入訂單</h2>
<div class="panel">
	<p class="hint" style="margin:0 0 14px">
		選擇平台匯出的檔案，<strong>選完就會自動出現預覽</strong>，確認數字後按「確認發放」。
		<strong>綠界請用 Excel（.xlsx）</strong>，它的 CSV 欄位會亂序；賣貨便的 Excel 或 CSV 都可以。
		預覽不會發任何幣，同一份檔案重複匯入也不會重複發。
	</p>

	<form method="POST" action="?/preview" bind:this={previewForm}>
		<label class="b b-go upload-btn">
			{reading ? '讀取中…' : '選擇訂單檔（Excel 或 CSV）'}
			<input
				type="file"
				accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				onchange={readFile}
				disabled={reading}
			/>
		</label>
		{#if fileName}
			<p class="hint" style="margin:10px 0 0">
				已讀取：{fileName}{#if fileFormat}　·　辨識為 <strong>{fileFormat}</strong>{/if}
			</p>
		{/if}
		{#if fileError}<div class="err" style="margin:12px 0">{fileError}</div>{/if}
		<div style="height:12px"></div>
		{#if fileError}<div class="err" style="margin-bottom:12px">{fileError}</div>{/if}

		<details style="margin-bottom:12px">
			<summary class="hint" style="cursor:pointer;margin:0">
				不是賣貨便的檔案？手動指定欄位，或直接貼上內容
			</summary>
			<p class="hint" style="margin:10px 0">
				認不出格式時才會用到這裡。欄位位置從 0 開始數（最左邊那欄是 0）。
				<strong>這種模式看不到付款狀態，請先自行篩出已付款的訂單。</strong>
			</p>
			<div class="field-row" style="margin-bottom:12px">
				<div class="field">
					<label for="pf">來源平台</label>
					<select id="pf" name="platform">
						<option value="綠界">綠界</option>
						<option value="其他">其他</option>
					</select>
				</div>
				<div class="field">
					<label for="c1">訂單編號欄</label>
					<input id="c1" name="colOrderRef" type="number" min="0" value="0" style="width:110px" />
				</div>
				<div class="field">
					<label for="c2">金額欄</label>
					<input id="c2" name="colAmount" type="number" min="0" value="1" style="width:110px" />
				</div>
				<div class="field">
					<label for="c3">備註欄</label>
					<input id="c3" name="colNote" type="number" min="0" value="2" style="width:110px" />
				</div>
				<div class="field">
					<label for="hh">第一列是標題</label>
					<label style="display:flex;align-items:center;gap:7px;height:39px;font-size:14px">
						<input id="hh" name="hasHeader" type="checkbox" checked /> 是
					</label>
				</div>
			</div>
		</details>

		<textarea
			name="csv"
			class="csv-in"
			rows="6"
			bind:value={csvText}
			placeholder="選擇檔案後內容會出現在這裡；也可以直接貼上"
		></textarea>

		<button class="b b-quiet" style="flex:0;margin-top:12px" type="submit" disabled={!csvText.trim()}>
			預覽比對結果
		</button>
	</form>
</div>

<!-- ── 兌換券 ────────────────────────────────────────── -->
<h2>產生兌換券</h2>
<div class="panel">
	<p class="hint" style="margin:0 0 14px">
		給漏填備註碼的買家用。這條路徑不需要知道買家是誰 —— 直接用訂單留言把券碼發給他即可。
	</p>
	<form method="POST" action="?/makeCodes" class="field-row">
		<div class="field">
			<label for="cn">組數</label>
			<input id="cn" name="count" type="number" min="1" max="200" value="1" style="width:100px" />
		</div>
		<div class="field">
			<label for="ca">每組面額</label>
			<input id="ca" name="amount" type="number" min="1" value="30000" style="width:140px" />
		</div>
		<div class="field" style="flex:1;min-width:180px">
			<label for="co">對應訂單編號（選填）</label>
			<input id="co" name="orderRef" type="text" placeholder="供日後對帳" style="width:100%" />
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">產生</button>
	</form>

	<div class="stat-row">
		<span>已產生 <b>{data.stats.total}</b> 組</span>
		<span>已使用 <b>{data.stats.used}</b> 組</span>
		<span>未使用面額合計 <b>{fmt(data.stats.unusedValue)}</b></span>
	</div>
</div>

<!-- ── 未使用的兌換券 ────────────────────────────────── -->
{#if data.codes.length}
	<h2>未使用的兌換券</h2>
	<div class="panel">
		<div class="scrollable">
			<table>
				<thead>
					<tr><th>兌換券碼</th><th style="text-align:right">面額</th><th>對應訂單</th><th>產生時間</th></tr>
				</thead>
				<tbody>
					{#each data.codes as c (c.code)}
						<tr>
							<td style="font-family:var(--mono)">{c.code}</td>
							<td class="n">{fmt(c.amount)}</td>
							<td>{c.orderRef ?? '—'}</td>
							<td>{when(c.createdAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

<!-- ── 已發放的訂單 ──────────────────────────────────── -->
<h2>已發放的訂單</h2>
<div class="panel">
	{#if data.orders.length === 0}
		<p class="hint" style="margin:0">還沒有任何訂單發幣紀錄。</p>
	{:else}
		<div class="scrollable">
			<table>
				<thead>
					<tr>
						<th>時間</th><th>平台</th><th>訂單編號</th><th>帳號</th>
						<th style="text-align:right">金額</th><th style="text-align:right">狗狗幣</th>
					</tr>
				</thead>
				<tbody>
					{#each data.orders as o (o.id)}
						<tr>
							<td>{when(o.createdAt)}</td>
							<td>{o.platform}</td>
							<td style="font-family:var(--mono);font-size:12.5px">{o.orderRef}</td>
							<td>{o.displayName}</td>
							<td class="n">{o.amountTwd}</td>
							<td class="n">{fmt(o.chips)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- ── 維護 ──────────────────────────────────────────── -->
<h2>維護</h2>
<div class="panel">
	<p class="hint" style="margin:0 0 12px">
		訂單備註碼是在註冊時產生的。若有帳號因為某些原因還沒有代碼，用這個補發。
	</p>
	<form method="POST" action="?/backfill">
		<button class="b b-quiet" style="flex:0" type="submit">補發訂單備註碼</button>
	</form>
</div>
