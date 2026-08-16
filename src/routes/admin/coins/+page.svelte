<script lang="ts">
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
		'bad-amount': { label: '金額有問題', cls: 't-void' }
	};

	const ctx = $derived(form && 'imported' in form ? form.imported : null);
	const preview = $derived(ctx?.preview ?? null);
	const readyRows = $derived(preview?.filter((r) => r.status === 'ready') ?? []);
	const readyChips = $derived(readyRows.reduce((a, r) => a + r.chips, 0));
	const problemRows = $derived(preview?.filter((r) => r.status !== 'ready') ?? []);
</script>

<p style="margin:0 0 10px"><a href="/admin">← 回場次總覽</a></p>
<h1>狗狗幣發放</h1>
<p class="hint">
	換算比例 NT$1 = {data.rate} 狗狗幣。主線是匯入訂單 CSV 自動比對，
	買家漏填代碼時改用兌換碼補救。
</p>

{#if form?.error}<div class="err">{form.error}</div>{/if}
{#if form?.success}<div class="ok-msg">{form.success}</div>{/if}

<!-- ── 產生出來的兌換碼 ──────────────────────────────── -->
{#if form && 'codes' in form && form.codes}
	<div class="panel" style="border-color:var(--ok)">
		<h2 style="margin:0 0 10px">新產生的兌換碼</h2>
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
		<p class="warn">
			共 {preview.length} 筆，其中 <strong>{readyRows.length} 筆可發放</strong>，
			合計 <strong>{fmt(readyChips)}</strong> 狗狗幣。
			{#if problemRows.length}另有 {problemRows.length} 筆需要處理。{/if}
		</p>

		<div style="max-height:340px;overflow:auto;margin-bottom:16px">
			<table>
				<thead>
					<tr>
						<th>訂單編號</th>
						<th>金額</th>
						<th>備註中的代碼</th>
						<th>對應帳號</th>
						<th style="text-align:right">狗狗幣</th>
						<th>狀態</th>
					</tr>
				</thead>
				<tbody>
					{#each preview as r, i (i)}
						<tr>
							<td style="font-family:var(--mono);font-size:12.5px">{r.orderRef}</td>
							<td class="n">{r.amountTwd}</td>
							<td style="font-family:var(--mono)">{r.code ?? '—'}</td>
							<td>{r.displayName ?? '—'}</td>
							<td class="n">{r.status === 'ready' ? fmt(r.chips) : '—'}</td>
							<td><span class="tag {STATUS[r.status]?.cls}">{STATUS[r.status]?.label}</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if problemRows.length}
			<p class="warn">
				對不到帳號的訂單，請用下方「產生兌換碼」開對應面額的碼，再用訂單留言發給買家。
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
<h2>匯入訂單 CSV</h2>
<div class="panel">
	<p class="hint" style="margin:0 0 14px">
		從賣貨便或綠界後台匯出訂單，用試算表打開後<strong>整份複製貼上</strong>即可 ——
		這樣不會有編碼問題。下方的欄位順序請對照你貼上的內容調整（第一欄是 0）。
	</p>

	<form method="POST" action="?/preview">
		<div class="field-row" style="margin-bottom:12px">
			<div class="field">
				<label for="pf">來源平台</label>
				<select id="pf" name="platform">
					<option value="賣貨便">賣貨便</option>
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

		<textarea
			name="csv"
			class="csv-in"
			rows="8"
			placeholder="訂單編號,金額,備註&#10;A20261011001,300,K7M2QX&#10;A20261011002,500,我的代碼 P4TR9N"
		></textarea>

		<button class="b b-quiet" style="flex:0;margin-top:12px" type="submit">預覽比對結果</button>
	</form>
</div>

<!-- ── 兌換碼 ────────────────────────────────────────── -->
<h2>產生兌換碼</h2>
<div class="panel">
	<p class="hint" style="margin:0 0 14px">
		給漏填代碼的買家用。這條路徑不需要知道買家是誰 —— 直接用訂單留言把碼發給他即可。
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

<!-- ── 未使用的兌換碼 ────────────────────────────────── -->
{#if data.codes.length}
	<h2>未使用的兌換碼</h2>
	<div class="panel">
		<div class="scrollable">
			<table>
				<thead>
					<tr><th>兌換碼</th><th style="text-align:right">面額</th><th>對應訂單</th><th>產生時間</th></tr>
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
		公開代碼是在註冊時產生的。若有帳號因為某些原因還沒有代碼，用這個補發。
	</p>
	<form method="POST" action="?/backfill">
		<button class="b b-quiet" style="flex:0" type="submit">補發公開代碼</button>
	</form>
</div>
