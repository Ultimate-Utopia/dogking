<script lang="ts">
	/**
	 * 賽程樹。
	 *
	 * 版面照主辦方的賽程圖：勝部在上、敗部在下，中間一條分隔線，
	 * 總決賽與冠軍在最右邊、壓在分隔線上。欄位與垂直位置由伺服器算好
	 * （見 board.ts 的 layoutLane），這裡只負責換算成像素。
	 *
	 * 連線只畫同一排內的「勝者晉級」。敗者從勝部掉到敗部是跨排的，
	 * 畫成線會往回走，所以跟賽程圖一樣改在空位上寫「M1 敗者」。
	 */

	type From = { matchNo: number; kind: 'win' | 'lose' } | null;
	interface Node {
		orderNo: number;
		roundLabel: string;
		format: string;
		state: string;
		bracket: string;
		blueName: string | null;
		redName: string | null;
		blueDoro: string | null;
		redDoro: string | null;
		scoreBlue: number;
		scoreRed: number;
		winnerSide: string | null;
		hasOpenMarket: boolean;
		col: number;
		y: number;
		winnerTo: { matchNo: number; slot: string } | null;
		blueFrom: From;
		redFrom: From;
	}
	interface BracketData {
		nodes: Node[];
		finalCol: number;
		laneRows: { winners: number; losers: number };
		champion: { name: string; doro: string | null } | null;
	}

	let { bracket }: { bracket: BracketData } = $props();

	// ── 版面尺寸（像素）──────────────────────────────
	// PITCH 要比一格場次的實際高度（約 100px）大，半格位移時才不會疊到
	const COL_W = 172;
	const COL_GAP = 34;
	const PITCH = 116;
	const HEAD = 30;
	/** 勝部與敗部之間的空隙。要放得下分隔線上下兩個標籤，少於 52 會壓到敗部的欄位標題 */
	const DIVIDE = 60;
	/** 總決賽方塊高度的一半，用來讓它的中心壓在分隔線上 */
	const HALF_NODE = 50;

	const xOf = (col: number) => col * (COL_W + COL_GAP);

	const winnersH = $derived(HEAD + bracket.laneRows.winners * PITCH);
	const losersTop = $derived(winnersH + DIVIDE);
	const totalH = $derived(losersTop + HEAD + bracket.laneRows.losers * PITCH);
	const totalW = $derived(xOf(bracket.finalCol + 1) + COL_W);
	const dividerY = $derived(winnersH + DIVIDE / 2);

	function topOf(n: Node) {
		if (n.bracket === 'winners') return HEAD + n.y * PITCH;
		if (n.bracket === 'losers') return losersTop + HEAD + n.y * PITCH;
		return dividerY - HALF_NODE;
	}

	/** 每一排每一欄的標題（輪次名稱） */
	const heads = $derived.by(() => {
		const out: Array<{ id: string; left: number; top: number; text: string }> = [];
		for (const lane of ['winners', 'losers', 'final'] as const) {
			const seen = new Set<number>();
			for (const n of bracket.nodes.filter((x) => x.bracket === lane)) {
				if (seen.has(n.col)) continue;
				seen.add(n.col);
				const top =
					lane === 'winners' ? 0 : lane === 'losers' ? losersTop : dividerY - HALF_NODE - HEAD;
				out.push({ id: `${lane}-${n.col}`, left: xOf(n.col), top, text: n.roundLabel });
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

	/** 空位寫「M2 勝者」「M1 敗者」，種子位寫「待定」—— 跟賽程圖一樣的標法 */
	function placeholder(from: From) {
		if (!from) return '待定';
		return `M${from.matchNo} ${from.kind === 'win' ? '勝者' : '敗者'}`;
	}

	// ── 連線 ────────────────────────────────────────────
	let canvas = $state<HTMLElement | null>(null);
	let lines = $state<Array<{ d: string; champ: boolean }>>([]);

	/**
	 * 量出節點實際位置後畫線。節點位置雖然是算好的，但高度取決於字型，
	 * 所以接點仍然用量的：從來源右緣中間，接到目標「該側那一列」的左緣。
	 * 轉折固定在欄與欄的間隙中間，垂直段就不會穿過任何場次方塊。
	 */
	function drawLines() {
		const el = canvas;
		if (!el) return;
		const base = el.getBoundingClientRect();

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

		type Box = NonNullable<ReturnType<typeof box>>;
		const elbow = (a: Box, b: Box) => {
			// 幾乎同高（M7→M11 這種）就拉一條直線，否則會出現幾 px 的小階梯
			if (Math.abs(a.mid - b.mid) < 10) return `M ${a.right} ${b.mid} H ${b.left}`;
			const mx = b.left - COL_GAP / 2;
			return `M ${a.right} ${a.mid} H ${mx} V ${b.mid} H ${b.left}`;
		};

		const next: typeof lines = [];
		for (const n of bracket.nodes) {
			if (!n.winnerTo) continue;
			const a = box(`[data-no="${n.orderNo}"]`);
			const b = box(`[data-no="${n.winnerTo.matchNo}"] [data-slot="${n.winnerTo.slot}"]`);
			if (a && b) next.push({ d: elbow(a, b), champ: false });
		}

		const final = bracket.nodes.find((n) => n.bracket === 'final' && n.col === bracket.finalCol);
		if (final) {
			const a = box(`[data-no="${final.orderNo}"]`);
			const b = box('[data-champ]');
			if (a && b) next.push({ d: elbow(a, b), champ: true });
		}
		lines = next;
	}

	$effect(() => {
		// 資料換了要重畫
		void bracket;
		if (!canvas) return;

		// $effect 在 DOM 更新後才跑，量座標會強制排版，直接畫即可。
		// 不要改成等 requestAnimationFrame —— 分頁在背景時瀏覽器不給 frame，
		// 線就一直不出現（實測在隱藏的預覽視窗裡是 0 條）。
		drawLines();

		const ro = new ResizeObserver(drawLines);
		ro.observe(canvas);
		return () => ro.disconnect();
	});
</script>

<div class="bracket-wrap">
	<div class="bracket-canvas" style="width:{totalW}px;height:{totalH}px" bind:this={canvas}>
		<svg class="bracket-lines" width={totalW} height={totalH} aria-hidden="true">
			{#each lines as l, i (i)}
				<path class="ln" class:champ={l.champ} d={l.d} />
			{/each}
		</svg>

		<!-- 勝部與敗部之間的分隔線，到總決賽前停下 -->
		<div class="divider" style="top:{dividerY}px;width:{xOf(bracket.finalCol) - COL_GAP}px"></div>
		<div class="lane-tag w" style="top:{dividerY - 22}px">▲ 勝部</div>
		<div class="lane-tag l" style="top:{dividerY + 5}px">▼ 敗部・再輸就淘汰</div>

		{#each heads as h (h.id)}
			<div class="col-head" style="left:{h.left}px;top:{h.top}px;width:{COL_W}px">{h.text}</div>
		{/each}

		{#each bracket.nodes as n (n.orderNo)}
			<div
				class="node"
				class:live={n.hasOpenMarket}
				data-no={n.orderNo}
				style="left:{xOf(n.col)}px;top:{topOf(n)}px;width:{COL_W}px"
			>
				<div class="node-top">
					<span>M{n.orderNo}・{n.format}</span>
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
						{#if name}
							<span class="nm">{name}</span>
						{:else}
							<span class="nm tbd">{placeholder(side === 'blue' ? n.blueFrom : n.redFrom)}</span>
						{/if}
						<span class="sc">{side === 'blue' ? n.scoreBlue : n.scoreRed}</span>
					</div>
				{/each}
			</div>
		{/each}

		<!-- ── 冠軍 ────────────────────────────────────── -->
		<div
			class="col-head"
			style="left:{xOf(bracket.finalCol + 1)}px;top:{dividerY - 30 - HEAD}px;width:{COL_W}px"
		>
			冠軍
		</div>
		<div
			class="champ"
			class:decided={!!bracket.champion}
			data-champ
			style="left:{xOf(bracket.finalCol + 1)}px;top:{dividerY - 30}px;width:{COL_W}px"
		>
			<span class="crown">🏆</span>
			{#if bracket.champion}
				{#if bracket.champion.doro}
					<img src={doroSrc(bracket.champion.doro)} alt="" width="30" height="30" />
				{/if}
				<span class="champ-name">{bracket.champion.name}</span>
			{:else}
				<span class="champ-name tbd">未定</span>
			{/if}
		</div>
	</div>
</div>

<p class="bracket-hint">
	雙敗淘汰：勝部輸一場掉到敗部，敗部再輸一場就淘汰。空位上的「M1
	敗者」表示由第 1 場的敗者補上。
</p>
