<script lang="ts">
	/**
	 * 型別刻意寫在這裡、不從 $lib/server/board 匯入。
	 * 那是伺服器模組，SvelteKit 禁止前端程式碼引用它；
	 * 只要欄位對得起來，這裡自己描述形狀最單純。
	 */
	interface Node {
		orderNo: number;
		roundLabel: string;
		format: string;
		state: string;
		blueName: string | null;
		redName: string | null;
		blueDoro: string | null;
		redDoro: string | null;
		scoreBlue: number;
		scoreRed: number;
		winnerSide: string | null;
		hasOpenMarket: boolean;
	}
	interface Round {
		roundNo: number;
		label: string;
		matches: Node[];
	}
	interface BracketData {
		winners: Round[];
		losers: Round[];
		final: Round[];
	}

	let { bracket }: { bracket: BracketData } = $props();

	/** 一組（勝部／敗部／決賽）的標題與色點 */
	const GROUPS = [
		{ key: 'winners' as const, cls: 'w', title: '勝部' },
		{ key: 'losers' as const, cls: 'l', title: '敗部（輸了就淘汰）' },
		{ key: 'final' as const, cls: 'f', title: '總決賽' }
	];

	/**
	 * 一側的樣式：比完了就分出勝負，沒比完一律中性。
	 * 沒有人的空位（還沒晉級上來）顯示「待定」。
	 */
	function slotClass(n: Node, side: 'blue' | 'red') {
		const base = side === 'blue' ? 'b' : 'r';
		if (!n.winnerSide) return base;
		return `${base} ${n.winnerSide === side ? 'won' : 'lost'}`;
	}

	function doroSrc(slug: string | null) {
		return slug ? `/participants/${slug}-sm.webp` : null;
	}
</script>

<div class="bracket-wrap">
	{#each GROUPS as g (g.key)}
		{#if bracket[g.key].length}
			<div class="bracket-group">
				<h3 class="bracket-title {g.cls}"><span class="side-dot"></span>{g.title}</h3>
				<div class="rounds">
					{#each bracket[g.key] as round (round.roundNo)}
						<div class="round-col">
							<div class="round-head">{round.label}</div>
							{#each round.matches as n (n.orderNo)}
								<div class="node" class:live={n.hasOpenMarket}>
									<div class="node-top">
										<span>#{n.orderNo}・{n.format}</span>
										{#if n.hasOpenMarket}<span class="live-tag">下注中</span>{/if}
									</div>
									{#each ['blue', 'red'] as const as side (side)}
										{@const name = side === 'blue' ? n.blueName : n.redName}
										{@const doro = doroSrc(side === 'blue' ? n.blueDoro : n.redDoro)}
										<div class="slot {slotClass(n, side)}">
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
				</div>
			</div>
		{/if}
	{/each}
</div>

<p class="bracket-hint">
	雙敗淘汰制：勝部輸一場會掉到敗部，敗部再輸一場就淘汰。
	若敗部冠軍在總決賽擊敗勝部冠軍，會加賽一場決定冠軍。
</p>
