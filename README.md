# 終焉狗王大賽 — 下注網站

SvelteKit + PostgreSQL + Discord OAuth。

規格見「狗王賭盤規格書」。本 README 只講怎麼把專案跑起來。

---

## 需求

| 項目 | 版本 | 說明 |
| --- | --- | --- |
| Node.js | **22 LTS 以上** | Node 21 已 EOL，且現行 Vite 不支援 21.x |
| Docker | 任意近期版本 | 只用來跑本地 Postgres |

> **Docker 需要 CPU 虛擬化。** Windows 上若 Docker Desktop 顯示
> 「Virtualization support not detected」，代表 BIOS/UEFI 裡的
> Intel VT-x（AMD 則是 SVM）沒開啟。重開機進 BIOS →
> Advanced → CPU Configuration → Intel Virtualization Technology → Enabled。
>
> 不想動 BIOS 的話，本機直接裝 PostgreSQL 也可以，
> 只要 `.env` 的 `DATABASE_URL` 指得到就行，其餘程式碼不用改。

---

## 第一次啟動

```bash
# 1. 安裝套件
npm install

# 2. 啟動本地資料庫（背景執行）
npm run db:up

# 3. 設定環境變數
cp .env.example .env
#    → 編輯 .env，填入 Discord 的 CLIENT_ID 與 CLIENT_SECRET（見下一節）

# 4. 建立資料表
npm run db:generate
npm run db:migrate

# 5. 啟動
npm run dev
```

開 http://localhost:5173 ，按「使用 Discord 登入」。

首次登入會自動建立帳號並發放 1,000 狗狗幣，畫面上應該看得到餘額與一筆「註冊贈送」紀錄。

---

## 設定 Discord 應用程式

1. 到 https://discord.com/developers/applications ，按 **New Application**
2. 左側 **OAuth2** 頁籤
3. **Redirects** 新增：`http://localhost:5173/auth/callback`
4. 複製 **Client ID** 與 **Client Secret**，填進 `.env`

> **不要勾選 `email` scope。** 本專案刻意只索取 `identify`，
> 我們拿得到 Discord ID、暱稱、頭像，拿不到 email、真名或任何聯絡方式。
> 這是規格書 §02 的明確決策，請勿變更。

之後上線時，記得回來把正式網址的 redirect 也加進去。

---

## 部署到 Netlify

### 1. 建立雲端資料庫

到 [Supabase](https://supabase.com) 或 [Neon](https://neon.tech) 開一個免費專案，地區選 **Tokyo 或 Singapore**。

> ⚠️ **一定要用「連線池（pooler / pooled）」那組連線字串**，不是 direct connection。
> Netlify Functions 每次呼叫都可能是獨立執行環境，各自開連線，
> 直連很快就會打爆資料庫的連線上限。
> Supabase 的 pooler 是 **6543 埠**（direct 是 5432）。
>
> 程式已針對這種連線池模式設定 `prepare: false`（見 `src/lib/server/db/index.ts` 的註解）。

### 2. 建立資料表

在本機對正式資料庫跑 migration：

```bash
DATABASE_URL="<正式站的連線字串>" npx drizzle-kit migrate
```

再建立參賽者與場次：

```bash
node scripts/seed.mjs --url "<正式站的連線字串>"
```

> Migration 刻意**不放進 Netlify 的建置流程**。建置可能同時跑好幾個、
> 也可能被回滾，讓它動結構是自找麻煩。手動執行才看得到結果。

### 3. Discord 應用程式

到 [Discord Developers](https://discord.com/developers/applications) → 你的應用程式 → OAuth2：

1. **Redirects** 新增正式站網址：`https://<你的站>.netlify.app/auth/callback`
   （本機那組 `http://localhost:5173/auth/callback` 保留，兩個可以並存）
2. 按 **Reset Secret** 產生新的 Client Secret

> 🔑 **上線用的 Secret 必須是新的一組。** 開發期間用過的那組不要沿用到正式站。

### 4. Netlify 設定

建立站台後，到 **Site configuration → Environment variables** 填入：

| 變數 | 值 |
| --- | --- |
| `DATABASE_URL` | 步驟 1 的**連線池**字串 |
| `DISCORD_CLIENT_ID` | Discord 應用程式的 Client ID |
| `DISCORD_CLIENT_SECRET` | 步驟 3 **重置後**的新 Secret |
| `DISCORD_REDIRECT_URI` | `https://<你的站>.netlify.app/auth/callback` |
| `SIGNUP_BONUS` | `1000` |

`netlify.toml` 已經設好建置指令與 Node 版本，不需要在介面上另外指定。

### 5. 部署

```bash
npx netlify-cli deploy --prod
```

或把專案推上 GitHub，在 Netlify 連結該儲存庫 —— 之後每次 push 就自動部署，長期比較好用。

### 6. 指定第一位管理員

正式站上 `/dev/make-admin` 會回 404（刻意的）。請本人先用 Discord 登入一次，然後：

```bash
node scripts/seed.mjs --url "<正式站連線字串>" --admin "<你的 Discord 使用者 ID>"
```

Discord 使用者 ID 的取得方式：Discord 設定 → 進階 → 開啟開發者模式，
然後在自己的名字上按右鍵 → 複製使用者 ID。

### 上線後檢查

| 檢查項目 | 預期 |
| --- | --- |
| `/` | 看得到賽事看板與立繪 |
| `/auth/login` | 導向 Discord 且能登入回來 |
| `/dev/seed`、`/dev/demo`、`/dev/selftest` | **全部 404** |
| `/overlay` | 疊圖正常，背景透明 |
| `/api/board` 的回應標頭 | 含 `Cache-Control: public, max-age=3` |
| `/api/me` 的回應標頭 | 含 `private, no-store` |

---

## 直播疊圖（OBS）

副台解說賭盤時用的透明疊圖，網址是 `/overlay`。

**在 OBS 裡的設定步驟**

1. 來源 → 新增 → **瀏覽器**
2. 網址填 `http://localhost:5173/overlay`（上線後換成正式網址）
3. 寬 **1920**、高 **1080**
4. **不要**勾「關閉來源時關閉」，讓它持續更新
5. 確定後用滑鼠拖曳／縮放到想要的位置

背景本來就是透明的，不需要做色鍵去背。

**網址參數**

| 參數 | 值 | 說明 |
| --- | --- | --- |
| `view` | `board`（預設）／`leaderboard` | 顯示賭盤或籌碼排行榜 |
| `anchor` | `tl` `tr` `bl` `br` `tc` `bc` | 貼齊哪個角落，預設左上 |
| `scale` | 數字，例如 `1.4` | 整體縮放 |
| `game` | `0`＝整場、`1`＝第一局… | 固定顯示某個盤口 |
| `debug` | `1` | 顯示金色外框，方便對位 |

範例：`/overlay?anchor=br&scale=1.3` 貼右下角並放大 1.3 倍。

**不指定 `game` 時的自動選擇順序**：正在倒數的盤口 → 其他開放中的 → 待結算的 → 最後一個。
把「正在倒數的」排第一，是因為那是主播當下在講、觀眾最需要看到剩幾秒的盤口。

> 排行榜可以另外開一個瀏覽器來源指向 `?view=leaderboard`，
> 在賽事空檔切換顯示。

---

## 開發用端點

僅在開發模式存在，正式環境一律回 404。

| 端點 | 用途 |
| --- | --- |
| `/dev/seed` | 建立 9 位參賽者與 13 個場次骨架（可重複執行） |
| `/dev/make-admin` | 把目前登入的使用者設為管理員 |
| `/dev/demo` | **一鍵準備測試場景**：對戰組合、兩個開放盤口、示範帳號的彩池、180 秒倒數，並把自己補到 20,000 狗狗幣 |
| `/dev/demo?reset=1` | 清空所有盤口與下注，帳本只留註冊贈送與人工調整 |
| `/dev/selftest` | 執行 12 項自我測試，結束後自行清除測試資料 |

`/dev/demo` 也適合拿來做練習賽直播前的彩排。

---

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 開發伺服器 |
| `npm run check` | TypeScript / Svelte 型別檢查 |
| `npm run build` | 產出正式版 |
| `npm run db:up` / `db:down` | 啟動 / 停止本地 Postgres |
| `npm run db:generate` | 改完 schema 後產生 migration |
| `npm run db:migrate` | 套用 migration |
| `npm run db:studio` | 開瀏覽器介面看資料庫內容 |

---

## 專案結構

```
src/
├─ hooks.server.ts              每個請求先解析 session，結果放進 locals
├─ app.css                      開發階段的最小樣式
├─ lib/server/
│  ├─ db/schema.ts              八張表，規格書 §07
│  ├─ db/index.ts               連線池
│  ├─ auth.ts                   session 建立/解析/銷毀、首次登入發幣
│  ├─ discord.ts                OAuth2 流程（手寫，只要 identify）
│  └─ ledger.ts                 餘額計算、帳本寫入、資料列鎖定
└─ routes/
   ├─ +page.svelte              驗證用畫面：登入狀態、餘額、交易紀錄
   ├─ +page.server.ts
   └─ auth/{login,callback,logout}/+server.ts
```

---

## 關於 `npm audit` 的警告

`npm audit` 會報 7 個弱點。**兩個來源都已評估過，不要修。**

| 來源 | 判斷 |
| --- | --- |
| `cookie <0.7.0`（經 @sveltejs/kit） | SvelteKit 已是最新版，上游尚未更新此相依。`audit fix --force` 會把 kit 降到 **0.0.30**，等於砍掉整個專案。 |
| `esbuild <=0.24.2`（經 drizzle-kit） | 這是**開發伺服器**的弱點，drizzle-kit 是 devDependency，只在本機跑 migration，不會進正式版。`audit fix --force` 會把 drizzle-kit 降到 **0.18.1**。 |

**請勿執行 `npm audit fix --force`。** 等上游更新後再跟著升版即可。

---

## 給後續開發者的三個地雷

**1. 餘額不要存成欄位。**
`users` 表沒有 balance 欄位，這是刻意的。餘額一律用 `getBalance()` 由 `ledger` 加總。
所有幣的增減都必須走 `lib/server/ledger.ts`，不要在別處直接 insert 帳本。

**2. 下注一定要鎖資料列。**
扣款流程必須是：開交易 → `lockUser()` → 檢查餘額 → 寫 bet → 寫 ledger → 更新彩池。
少了 `lockUser()`，兩筆同時進來的下注會各自讀到舊餘額，造成負餘額。

**3. 公開資料端點一定要加 CDN 快取。**
看板每 3 秒輪詢一次。Netlify 依函式呼叫次數計費，沒有快取的話一個下午就會爆掉額度
（規格書 §09 有試算）。彩池、賠率、比分對所有人都相同，回應請加上：

```
Cache-Control: public, max-age=3, stale-while-revalidate=10
```

封盤判定在伺服器端執行，所以畫面延遲 3 秒不會讓人下到封盤後的注。

---

## 目前進度

- [x] 專案骨架、本地資料庫
- [x] 八張表的 schema
- [x] Discord 登入、session
- [x] 帳本與餘額、註冊發幣
- [ ] 賽程與盤口
- [ ] 下注與彩池結算
- [ ] 後台
- [ ] 排行榜
- [ ] 正式視覺
- [ ] OBS overlay
