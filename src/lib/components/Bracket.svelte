<script lang="ts">
	/**
	 * 賽程樹。
	 *
	 * 版面是 CSS grid：欄位由伺服器算好（見 board.ts 的 assignColumns），
	 * 勝部排在上排、敗部下排、決賽自己一格。
	 *
	 * 連線刻意「量了才畫」而不是用 CSS 偽元素拼 —— 雙敗淘汰的線會跨排
	 * （勝部的敗者掉到敗部），還會跨好幾欄，用偽元素接不出來。
	 * 量完實際座標畫在一張 SVG 上，賽程換了也不必重調樣式。
	 */

	interface Advance {
		matchNo: number;
		slot: string;
	}
	interface Node {
		orderNo: number;
		roundLabel: string;
		format: string;
		state: string;
		bracket: string;
		roundNo: number;
		blueName: string | null;
		redName: string | null;
		blueDoro: string | null;
		redDoro: string | null;
		scoreBlue: number;
		scoreRed: number;
		winnerSide: string | null;
		hasOpenMarket: boolean;
		col: number;
		winnerTo: Advance | null;
		loserTo: Advance | null;
	}
	interface BracketData {
		nodes: Node[];
		cols: number;
		championCol: number;
		champion: { name: string; doro: string | null } | null;
		pendingReset: boolean;
	}

	let { bracket }: { bracket: BracketData } = $props();

	/** 一格＝同一排、同一欄的那幾場。勝部在上排、敗部在下排、決賽自成一排。 */
	const LANES = [
		{ key: 'winners', row: 'w' },
		{ key: 'losers', row: 'l' },
		{ key: 'final', row: 'f' }
	] as const;

	const cells = $derived.by(() => {
		const out: Array<{ id: string; row: string; col: number; label: string; nodes: Node[] }> = [];
		for (const lane of LANES) {
			const inLane = bracket.nodes.filter((n) => n.bracket === lane.key);
			for (const col of [...new Set(inLane.map((n) => n.col))].sort((a, b) => a - b)) {
				const nodes = inLane.filter((n) => n.col === col);
				out.push({
					id: `${lane.key}-${col}`,
					row: lane.row,
					col,
					label: nodes[0]?.roundLabel ?? '',
					nodes
				});
			}
		}
		return out;
	});

	function doroSrc(slug: string | null) {
		return slug ? `/participants/${slug}-sm.webp` : null;
	}

	/** 比完了才分勝負；還沒比一律中性，免得空著的場次看起來像有人贏了。 */
	function slotClass(n: Node, side: 'blue' | 'red') {
		const base = side === 'blue' ? 'b' : 'r';
		if (!n.winnerSide) return base;
		return `${base} ${n.winnerSide === side ? 'won' : 'lost'}`;
	}

	// ── 連線 ────────────────────────────────────────────
	interface Line {
		d: string;
		kind: 'win' | 'lose' | 'champ';
	}

	let grid = $state<HTMLElement | null>(null);
	let lines = $state<Line[]>([]);
	let size = $state({ w: 0, h: 0 });

	/**
	 * 量出每個節點的位置後畫線。
	 *
	 * 線從來源場次的右緣出發，接到目標場次「該側那一列」的左緣 ——
	 * 接到藍方就對著上面那格、紅方對著下面那格，觀眾一眼看得出人會落在哪一邊。
	 * 轉折走「先橫、再直、再橫」，也就是一般賽程表的直角折線。
	 */
	function drawLines() {
		const el = grid;
		if (!el) return;

		const base = el.getBoundingClientRect();
		size = { w: el.scrollWidth, h: el.scrollHeight };

		// 座標一律換算成「相對於 grid 左上角」。
		// 橫向捲動的是外層的 .bracket-wrap，grid 與節點會一起位移，
		// 相減之後自然抵消，不需要再加捲動量。
		const box = (sel: string) => {
			const t = el.querySelector(sel);
			if (!t) return null;
			const r = t.getBoundingClientRect();
			return {
				left: r.left - base.left,
				right: r.right - base.left,
				mid: r.top + r.height / 2 - base.top
			};
		};

		const elbow = (from: NonNullable<ReturnType<typeof box>>, to: NonNullable<ReturnType<typeof box>>) => {
			const gap = to.left - from.right;

			/**
			 * 轉彎的位置。
			 *
			 * 相鄰兩欄就折在中點，這是一般賽程表的樣子。
			 *
			 * 跨好幾欄的線（例如勝部決賽的敗者要一路掉到敗部決賽）則改成
			 * 「靠近目標才轉彎」。折在中點的話，垂直那段正好穿過中間欄位的
			 * 場次方塊（實測會穿過場次 12），看起來像是接到那一場。
			 * 晚一點轉，橫走的那段就留在自己那一排的空白處。
			 */
			const mx = gap > 90 ? to.left - 14 : from.right + gap / 2;

			return `M ${from.right} ${from.mid} H ${mx} V ${to.mid} H ${to.left}`;
		};

		const next: Line[] = [];

		for (const n of bracket.nodes) {
			const from = box(`[data-no="${n.orderNo}"]`);
			if (!from) continue;

			for (const [adv, kind] of [
				[n.winnerTo, 'win'],
				[n.loserTo, 'lose']
			] as const) {
				if (!adv) continue;
				const to = box(`[data-no="${adv.matchNo}"] [data-slot="${adv.slot}"]`);
				if (!to) continue;
				next.push({ d: elbow(from, to), kind });
			}
		}

		// 最後一場決賽 → 冠軍
		const finals = bracket.nodes.filter((n) => n.bracket === 'final');
		const last = finals.length ? finals.reduce((a, b) => (b.orderNo > a.orderNo ? b : a)) : null;
		if (last) {
			const from = box(`[data-no="${last.orderNo}"]`);
			const to = box('[data-champ]');
			if (from && to) next.push({ d: elbow(from, to), kind: 'champ' });
		}

		lines = next;
	}

	$effect(() => {
		// 讀一下 cells，資料換了要重畫
		cells;
		if (!grid) return;

		// 等版面排完再量。字型載入與圖片解碼都會改變高度。
		const raf = requestAnimationFrame(drawLines);

		const ro = new ResizeObserver(drawLines);
		ro.observe(grid);

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
	});
</script>

<div class="bracket-wrap">
	<div class="bracket-grid" style="--cols:{bracket.cols + 1}" bind:this={grid}>
		<!-- 線畫在節點底下，也不能吃掉點擊 -->
		<svg class="bracket-lines" width={size.w} height={size.h} aria-hidden="true">
			{#each lines as l, i (i)}
				<path class="ln {l.kind}" d={l.d} />
			{/each}
		</svg>

		{#each cells as c (c.id)}
			<div class="cell {c.row}" style="grid-column:{c.col + 1}">
				<div class="cell-head">{c.label}</div>
				{#each c.nodes as n (n.orderNo)}
					<div class="node" class:live={n.hasOpenMarket} data-no={n.orderNo}>
						<div class="node-top">
							<span>#{n.orderNo}・{n.format}</span>
							{#if n.hasOpenMarket}<span class="live-tag">下注中</span>{/if}
						</div>
						{#each ['blue', 'red'] as const as side (side)}
							{@const name = side === 'blue' ? n.blueName : n.redName}
							{@const doro = doroSrc(side === 'blue' ? n.blueDoro : n.redDoro)}
							<div class="slot {slotClass(n, side)}" data-slot={side}>
								<span class="pip"></span>
								{#if doro}
									<img src={doro} alt="" width="22" height="22" loading="lazy" />
								{/if}
								<span class="nm">{name ?? ''}{#if !name}<span class="tbd">待定</span>{/if}</span>
								<span class="sc">{side === 'blue' ? n.scoreBlue : n.scoreRed}</span>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		{/each}

		<!-- ── 冠軍 ────────────────────────────────────── -->
		<div class="cell f champ-cell" style="grid-column:{bracket.championCol + 1}">
			<div class="cell-head">冠軍</div>
			<div class="champ" class:decided={!!bracket.champion} data-champ>
				<span class="crown">🏆</span>
				{#if bracket.champion}
					{#if bracket.champion.doro}
						<img src={doroSrc(bracket.champion.doro)} alt="" width="30" height="30" />
					{/if}
					<span class="champ-name">{bracket.champion.name}</span>
				{:else if bracket.pendingReset}
					<span class="champ-name tbd">待加賽</span>
				{:else}
					<span class="champ-name tbd">未定</span>
				{/if}
			</div>
		</div>
	</div>
</div>

<p class="bracket-hint">
	<span class="key"><i class="s win"></i>勝者晉級</span>
	<span class="key"><i class="s lose"></i>敗者落入敗部</span>
	雙敗淘汰：勝部輸一場掉到敗部，敗部再輸一場就淘汰。
	若敗部冠軍在總決賽擊敗勝部冠軍，會加賽一場決定冠軍。
</p>
