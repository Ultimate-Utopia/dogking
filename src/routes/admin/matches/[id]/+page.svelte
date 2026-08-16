<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const fmt = (n: number) => n.toLocaleString('zh-TW');
	const sideName = (s: string) => (s === 'blue' ? '藍方' : '紅方');

	const STATE_LABEL: Record<string, string> = {
		pending: '未建立',
		open: '開放下注',
		locked: '已封盤',
		settled: '已結算',
		void: '已取消'
	};

	const blueName = $derived(
		data.participants.find((p) => p.id === data.match.blueParticipantId)?.name ?? '藍方'
	);
	const redName = $derived(
		data.participants.find((p) => p.id === data.match.redParticipantId)?.name ?? '紅方'
	);

	/** 已建立的盤口，依 gameNo 對應 */
	const marketOf = (gameNo: number) => data.markets.find((m) => m.gameNo === gameNo);

	/** 整場盤 + 該賽制的所有小局 */
	const slots = $derived([
		{ gameNo: 0, label: '整場盤' },
		...Array.from({ length: data.maxGames }, (_, i) => ({
			gameNo: i + 1,
			label: `第 ${i + 1} 局`
		}))
	]);
</script>

<p style="margin:0 0 10px"><a href="/admin">← 回場次總覽</a></p>

<h1>場次 {data.match.orderNo}・{data.match.roundLabel}</h1>
<p class="hint">
	{data.match.format}
	{#if data.match.isElimination}・輸者淘汰{/if}
	・目前比分 {data.match.scoreBlue} - {data.match.scoreRed}
</p>

{#if form?.error}
	<div class="err">{form.error}</div>
{/if}
{#if form?.success}
	<div class="ok-msg">{form.success}</div>
{/if}

<!-- ── 派彩確認：不可逆，先讓操作員看見後果 ───────────── -->
{#if data.preview}
	{@const p = data.preview}
	<div class="confirm">
		<h3>確認派彩：{sideName(p.side)}獲勝</h3>
		<p class="warn">
			{#if p.willRefund}
				{p.reason}
			{:else}
				派彩會立即寫入帳本，<strong>無法復原</strong>。請確認勝方正確後再按下確認。
			{/if}
		</p>

		{#if p.rows.length === 0}
			<p class="warn">這個盤口沒有任何下注，結算後不會有任何金額變動。</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>觀眾</th>
						<th>押注</th>
						<th style="text-align:right">金額</th>
						<th style="text-align:right">領回</th>
						<th>結果</th>
					</tr>
				</thead>
				<tbody>
					{#each p.rows as r, i (i)}
						<tr>
							<td>{r.displayName}</td>
							<td>{sideName(r.side)}</td>
							<td class="n">{fmt(r.amount)}</td>
							<td class="n">{r.payout > 0 ? fmt(r.payout) : '—'}</td>
							<td>{r.result}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<p class="warn">
				總彩池 {fmt(p.totalPool)}　→　派出 {fmt(p.totalPayout)}
				{#if p.remainder > 0}（除不盡餘 {fmt(p.remainder)} 留在系統）{/if}
			</p>
		{/if}

		<div class="actions">
			<form method="POST" action="?/settle">
				<input type="hidden" name="marketId" value={p.marketId} />
				<input type="hidden" name="side" value={p.side} />
				<button class="b {p.side === 'blue' ? 'b-blue' : 'b-red'}" type="submit">
					確認派彩給{sideName(p.side)}
				</button>
			</form>
			<a class="b b-quiet" style="text-align:center;text-decoration:none;line-height:1.6" href="/admin/matches/{data.match.id}">
				取消
			</a>
		</div>
	</div>
{/if}

<!-- ── 賽制資訊 ──────────────────────────────────────── -->
<h2>賽制資訊</h2>
<p class="hint">
	企劃書的賽程表有無法自洽的地方（見規格書 §06），所以這些欄位都可以隨時修改。
</p>
<div class="panel">
	<form method="POST" action="?/updateMeta" class="field-row">
		<div class="field" style="flex:1;min-width:220px">
			<label for="rl">輪次名稱</label>
			<input id="rl" name="roundLabel" type="text" value={data.match.roundLabel} style="width:100%" />
		</div>
		<div class="field">
			<label for="fm">賽制</label>
			<select id="fm" name="format">
				<option value="BO1" selected={data.match.format === 'BO1'}>BO1</option>
				<option value="BO3" selected={data.match.format === 'BO3'}>BO3</option>
				<option value="BO5" selected={data.match.format === 'BO5'}>BO5</option>
			</select>
		</div>
		<div class="field">
			<label for="el">輸者淘汰</label>
			<label style="display:flex;align-items:center;gap:7px;height:39px;font-size:14px">
				<input id="el" name="isElimination" type="checkbox" checked={data.match.isElimination} />
				是
			</label>
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">儲存</button>
	</form>
	<p class="hint" style="margin:14px 0 0">
		改賽制會影響小局盤的數量（BO1 一局、BO3 三局、BO5 五局）。已開的盤口不會被刪除。
	</p>
</div>

<!-- ── 對戰組合 ──────────────────────────────────────── -->
<h2>對戰組合</h2>
<div class="panel">
	<form method="POST" action="?/setParticipants" class="field-row">
		<div class="field">
			<label for="blue">藍方</label>
			<select id="blue" name="blue">
				<option value="">未定</option>
				{#each data.participants as p (p.id)}
					<option value={p.id} selected={p.id === data.match.blueParticipantId}>{p.name}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="red">紅方</label>
			<select id="red" name="red">
				<option value="">未定</option>
				{#each data.participants as p (p.id)}
					<option value={p.id} selected={p.id === data.match.redParticipantId}>{p.name}</option>
				{/each}
			</select>
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">儲存</button>
	</form>
</div>

<!-- ── 比分與賽事狀態 ────────────────────────────────── -->
<h2>比分與賽事狀態</h2>
<div class="panel">
	<form method="POST" action="?/updateScore" class="field-row">
		<div class="field">
			<label for="sb">{blueName}</label>
			<input id="sb" name="scoreBlue" type="number" min="0" value={data.match.scoreBlue} style="width:90px" />
		</div>
		<div class="field">
			<label for="sr">{redName}</label>
			<input id="sr" name="scoreRed" type="number" min="0" value={data.match.scoreRed} style="width:90px" />
		</div>
		<div class="field">
			<label for="st">賽事狀態</label>
			<select id="st" name="state">
				<option value="pending" selected={data.match.state === 'pending'}>未開始</option>
				<option value="live" selected={data.match.state === 'live'}>進行中</option>
				<option value="done" selected={data.match.state === 'done'}>已結束</option>
				<option value="void" selected={data.match.state === 'void'}>已取消</option>
			</select>
		</div>
		<div class="field">
			<label for="ws">整場勝方</label>
			<select id="ws" name="winnerSide">
				<option value="">未定</option>
				<option value="blue" selected={data.match.winnerSide === 'blue'}>{blueName}</option>
				<option value="red" selected={data.match.winnerSide === 'red'}>{redName}</option>
			</select>
		</div>
		<button class="b b-quiet" style="flex:0" type="submit">儲存</button>
	</form>
</div>

<!-- ── 盤口 ─────────────────────────────────────────── -->
<h2>盤口</h2>
<p class="hint">
	整場盤賭這一場的勝負，小局盤賭單一局。每個盤口的流程都是：開盤 → 封盤 → 判定勝方 → 派彩。
</p>

<div class="market-grid">
	{#each slots as slot (slot.gameNo)}
		{@const m = marketOf(slot.gameNo)}
		{@const state = m?.state ?? 'pending'}
		<div class="market {state === 'open' ? 'is-open' : ''} {state === 'locked' ? 'is-locked' : ''}">
			<div class="market-head">
				<span class="market-title">{slot.label}</span>
				<span class="tag t-{state}">{STATE_LABEL[state]}</span>
			</div>

			{#if m}
				{@const total = m.poolBlue + m.poolRed}
				<div class="pools">
					{#if total === 0}
						<div class="pool-empty">尚無下注</div>
					{:else}
						{#if m.poolBlue > 0}
							<div class="pool-b" style="flex:{m.poolBlue}">{fmt(m.poolBlue)}</div>
						{/if}
						{#if m.poolRed > 0}
							<div class="pool-r" style="flex:{m.poolRed}">{fmt(m.poolRed)}</div>
						{/if}
					{/if}
				</div>
				<div class="pool-legend">
					<span>{blueName} {m.odds.blue ? m.odds.blue.toFixed(2) : '—'}</span>
					<span>池 {fmt(total)}</span>
					<span>{m.odds.red ? m.odds.red.toFixed(2) : '—'} {redName}</span>
				</div>
			{:else}
				<div class="pools"><div class="pool-empty">尚未開盤</div></div>
				<div class="pool-legend"><span></span><span>—</span><span></span></div>
			{/if}

			<div class="actions">
				{#if state === 'pending' || !m}
					<form method="POST" action="?/openMarket">
						<input type="hidden" name="gameNo" value={slot.gameNo} />
						<button class="b b-go" type="submit">開盤</button>
					</form>
				{:else if state === 'open'}
					<form method="POST" action="?/lockMarket">
						<input type="hidden" name="marketId" value={m.id} />
						<button class="b b-lock" type="submit">立即封盤</button>
					</form>
					<form method="POST" action="?/scheduleLock">
						<input type="hidden" name="marketId" value={m.id} />
						<input type="hidden" name="seconds" value="60" />
						<button class="b b-quiet" type="submit">60 秒後封盤</button>
					</form>
				{:else if state === 'locked'}
					<a class="b b-blue" style="text-align:center;text-decoration:none;line-height:1.6"
						href="?confirm={m.id}&side=blue">{blueName}獲勝</a>
					<a class="b b-red" style="text-align:center;text-decoration:none;line-height:1.6"
						href="?confirm={m.id}&side=red">{redName}獲勝</a>
					<form method="POST" action="?/voidMarket">
						<input type="hidden" name="marketId" value={m.id} />
						<input type="hidden" name="reason" value="平局或賽事取消" />
						<button class="b b-quiet" type="submit">取消並退款</button>
					</form>
				{:else}
					<span class="hint" style="margin:0">
						{#if m?.winnerSide}
							{sideName(m.winnerSide)}獲勝・已完成
						{:else}
							已取消，全數退款
						{/if}
					</span>
				{/if}
			</div>
		</div>
	{/each}
</div>

<!-- ── 刪除場次 ──────────────────────────────────────── -->
<h2>刪除場次</h2>
<div class="panel">
	<p class="hint" style="margin:0 0 12px">
		只有在還沒有人下注時才能刪除。已經有注單的場次請改用盤口的「取消並退款」。
	</p>
	<form method="POST" action="?/deleteMatch">
		<button class="b b-quiet" style="flex:0;color:var(--red);border-color:var(--red)" type="submit">
			刪除場次 {data.match.orderNo}
		</button>
	</form>
</div>
