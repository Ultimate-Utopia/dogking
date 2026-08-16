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
