<script lang="ts">
	import type { PageData } from './$types';
	import './handbook.css';

	let { data }: { data: PageData } = $props();

	const fmt = (n: number) => n.toLocaleString('zh-TW');
</script>

<p style="margin:0 0 10px"><a href="/admin/coins">← 回狗狗幣發放</a></p>
<h1>周邊發幣作業手冊</h1>
<p class="hint">
	給負責對帳與發幣的人。照著做就好，每一步都可以停下來確認，
	<strong>沒有任何一步會在你按下確認之前動到資料。</strong>
</p>

<!-- ── 全貌 ────────────────────────────────────────── -->
<h2>一、整件事的全貌</h2>
<div class="panel">
	<p class="lede">
		觀眾買周邊 → 我們知道那筆訂單是誰的 → 依金額換成狗狗幣發給他。
		唯一的難題是<strong>「怎麼知道這筆訂單是誰的」</strong>，
		因為賣貨便與綠界不會告訴我們對方的 Discord 帳號。
	</p>

	<div class="path">
		<div class="path-card main">
			<span class="path-tag">主線・九成的訂單走這裡</span>
			<ol>
				<li>觀眾登入網站，在「獲得狗狗幣」頁面看到自己的<b>訂單備註碼</b>（6 碼，例如 <code>K7M2QX</code>）</li>
				<li>下單時把這組碼填進<b>訂單備註欄</b></li>
				<li>你匯出訂單 CSV，貼進後台</li>
				<li>系統自動比對備註碼 → 找到帳號 → 一鍵發幣</li>
			</ol>
		</div>

		<div class="path-card alt">
			<span class="path-tag">補救・買家忘了填或填錯</span>
			<ol>
				<li>後台產生一張<b>兌換券</b>，面額就開他該拿的數字</li>
				<li>用<b>該平台的訂單留言</b>把券碼發給他</li>
				<li>他在網站上自己輸入，立刻入帳</li>
			</ol>
			<p class="path-note">
				這條路刻意<strong>不需要知道買家是誰</strong> ——
				你不必要到他的 Discord、也不必碰任何個資。
			</p>
		</div>
	</div>
</div>

<!-- ── 要跟觀眾說什麼 ──────────────────────────────── -->
<h2>二、要請觀眾提供什麼</h2>
<div class="panel">
	<p class="lede">
		答案是：<strong>什麼都不用另外提供</strong>。他只要在下單時把備註碼填進備註欄就好。
		這是刻意的設計 —— 只要開口跟觀眾要「Discord 帳號」「姓名」「訂單截圖」，
		就會有一半的人嫌麻煩不做，而且我們也不想保管那些資料。
	</p>

	<div class="say">
		<span class="say-tag">可以直接複製去公告或商品說明的文案</span>
		<pre>購買本次大賽周邊，可依訂單金額獲得狗狗幣參加賭盤。

做法：
1. 到活動網站用 Discord 登入
2. 進入「獲得狗狗幣」頁面，複製你的 6 位訂單備註碼
3. 下單時把這組碼貼進「訂單備註」欄位

NT$1 = {fmt(data.rate)} 狗狗幣，對帳後統一發放。
忘記填也沒關係，跟主辦方說一聲，我們會補一張兌換券給你。</pre>
	</div>

	<div class="warn-box">
		<span class="warn-title">絕對不要請觀眾提供的東西</span>
		<ul>
			<li><b>密碼</b>　網站用 Discord 登入，我們從頭到尾沒有密碼這種東西。任何人跟觀眾要密碼都是詐騙。</li>
			<li><b>身分證、地址、電話</b>　發幣完全用不到。</li>
			<li><b>他的兌換券碼</b>　券碼等同現金，只該由你發給他，不該倒過來要。</li>
		</ul>
	</div>
</div>

<!-- ── 主線操作 ────────────────────────────────────── -->
<h2>三、主線：匯入訂單 CSV</h2>
<div class="panel">
	<ol class="steps">
		<li>
			<b>從平台匯出訂單</b><br />
			賣貨便或綠界後台都可以匯出 CSV／Excel。需要的欄位只有三個：
			<span class="need">訂單編號</span>
			<span class="need">訂單金額</span>
			<span class="need">買家備註</span>
		</li>
		<li>
			<b>貼進後台</b><br />
			到<a href="/admin/coins">狗狗幣發放</a>，選來源平台，把 CSV 內容整段貼進文字框。
			Excel 的話另存成 CSV 再用記事本打開複製即可。
		</li>
		<li>
			<b>對好欄位位置</b><br />
			「訂單編號欄／金額欄／備註欄」填的是<strong>第幾欄，從 0 開始數</strong>。
			最左邊那欄是 0、第二欄是 1，以此類推。
			若第一列是欄位名稱（訂單編號、金額…），把「第一列是標題」勾起來。
		</li>
		<li>
			<b>按「預覽比對結果」</b><br />
			<strong>這一步不會發任何幣。</strong>它只是把結果算給你看：誰拿多少、哪幾筆有問題。
			看不順眼就改欄位號碼重按，按幾次都沒關係。
		</li>
		<li>
			<b>確認金額總數，再按確認發放</b><br />
			畫面會顯示「共 N 筆、合計 X 狗狗幣」。<u>數字對了再按。</u>
		</li>
	</ol>

	<div class="tip">
		<span class="tip-title">同一份 CSV 匯入兩次會怎樣？</span>
		<p>
			<strong>不會重複發幣。</strong>訂單編號在資料庫裡是唯一的，
			第二次匯入時那些訂單會顯示「已發放過」並自動跳過。
			所以<b>不確定上次有沒有匯成功時，直接再匯一次是安全的</b>。
		</p>
	</div>
</div>

<!-- ── 問題列 ──────────────────────────────────────── -->
<h2>四、預覽畫面上的五種狀態</h2>
<div class="panel">
	<div class="scrollable">
		<table>
			<thead>
				<tr><th>狀態</th><th>意思</th><th>怎麼處理</th></tr>
			</thead>
			<tbody>
				<tr>
					<td><span class="st ready">可發放</span></td>
					<td>備註碼對到了帳號</td>
					<td>不用做什麼，按確認就會發</td>
				</tr>
				<tr>
					<td><span class="st bad">沒填代碼</span></td>
					<td>備註欄裡找不到 6 碼</td>
					<td>走補救路徑：產生兌換券，用訂單留言發給他</td>
				</tr>
				<tr>
					<td><span class="st bad">代碼查無此人</span></td>
					<td>填了碼，但沒有這個帳號</td>
					<td>多半是抄錯（<code>0</code> 與 <code>O</code> 已排除，但仍可能少一碼）。同樣走兌換券</td>
				</tr>
				<tr>
					<td><span class="st bad">金額異常</span></td>
					<td>金額欄不是正數</td>
					<td>通常是欄位號碼填錯了。回上一步改欄位號碼重新預覽</td>
				</tr>
				<tr>
					<td><span class="st done">已發放過</span></td>
					<td>這筆訂單先前匯入過了</td>
					<td>不用理它，系統會跳過</td>
				</tr>
			</tbody>
		</table>
	</div>
</div>

<!-- ── 兌換券 ──────────────────────────────────────── -->
<h2>五、補救：發兌換券</h2>
<div class="panel">
	<ol class="steps">
		<li>
			<b>算出面額</b><br />
			訂單金額 × {fmt(data.rate)}。例如 NT$300 的訂單就開 <code>{fmt(300 * data.rate)}</code>。
		</li>
		<li>
			<b>產生券</b><br />
			在<a href="/admin/coins">狗狗幣發放</a>頁下方「產生兌換券」，填組數與面額。
			<span class="need">對應訂單編號</span>建議一定要填 —— 日後有爭議時才查得出這張券是為哪筆訂單開的。
		</li>
		<li>
			<b>立刻複製保存</b><br />
			<strong>券碼只在產生的當下完整顯示一次。</strong>
			之後只會出現在「未使用的兌換券」清單裡，用掉就不再顯示。
		</li>
		<li>
			<b>用訂單留言發給買家</b><br />
			在賣貨便／綠界該筆訂單的留言功能貼給他。
			<u>不要貼在公開的地方</u> —— 券碼等同現金，誰先輸入誰拿到。
		</li>
	</ol>

	<div class="tip">
		<span class="tip-title">一張券只能用一次</span>
		<p>
			系統會擋。同一張券被輸入第二次會顯示「無效或已被使用」，
			不會有人靠轉貼券碼重複領。
		</p>
	</div>
</div>

<!-- ── 原則 ────────────────────────────────────────── -->
<h2>六、四條原則</h2>
<div class="panel">
	<ul class="rules">
		<li>
			<b>先預覽，再確認。</b>
			發幣之後要收回很麻煩（得用人工調整倒扣，而且觀眾可能已經押出去了）。
			預覽不用錢，多按幾次。
		</li>
		<li>
			<b>不確定就再匯一次。</b>
			重複匯入被資料庫擋著，不會有人拿雙倍。反而是「怕重複而不敢補匯」會漏掉人。
		</li>
		<li>
			<b>你做的每一步都有記錄。</b>
			匯入、發券、人工調整全部寫進後台操作紀錄，含時間與操作者。
			這是保護你 —— 有爭議時查得出來到底發生什麼事。
		</li>
		<li>
			<b>活動當天不要做大批匯入。</b>
			對帳留到賽前完成。比賽進行中後台要忙開盤封盤派彩，
			這時候再插進來一批發幣，容易按錯。
		</li>
	</ul>
</div>

<!-- ── 常見狀況 ────────────────────────────────────── -->
<h2>七、觀眾可能會問的</h2>
<div class="panel">
	<div class="qa">
		<p class="q">我買了但沒看到狗狗幣？</p>
		<p class="a">發放是對帳後統一處理，不是即時的。先確認他有沒有在備註填碼；沒填就補發兌換券。</p>

		<p class="q">我的備註碼在哪裡看？</p>
		<p class="a">網站登入後 → 右上角「獲得狗狗幣」→ 最上面那組大字，旁邊有複製按鈕。</p>

		<p class="q">我可以把狗狗幣送給朋友嗎？</p>
		<p class="a">不行，系統沒有轉帳功能。這是刻意的。</p>

		<p class="q">狗狗幣可以換現金或實體獎品嗎？</p>
		<p class="a">不行。純娛樂用途、不可轉讓、活動結束後全數回收，商品頁與網站頁尾都有寫。</p>

		<p class="q">我押輸了可以退嗎？</p>
		<p class="a">不行。但如果是<strong>比賽取消或判定有誤</strong>，後台可以整個盤口「取消並退款」，該盤所有人原額退回。</p>
	</div>
</div>

<p class="foot-note">
	這份手冊跟著網站一起更新。操作介面若和這裡寫的對不上，以介面為準並回報。
</p>
