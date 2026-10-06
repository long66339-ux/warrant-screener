# 台股權證篩選器

以臺灣證券交易所「上市認購（售）權證每日收盤行情資訊彙總表」及櫃買中心 OpenAPI 進行盤後初篩，再由使用者補入 IV、Delta、Bid、Ask、掛單量與在外流通比，評估權證本身的交易品質後再比較策略適配度。

## 本機執行

需要 Node.js 22 與 pnpm。

```bash
pnpm install
pnpm dev
```

## 部署到 GitHub Pages

1. 在 GitHub 建立新 repository。
2. 將本專案全部檔案推送到 `main` branch。
3. 到 repository 的 **Settings → Pages**。
4. 在 **Build and deployment** 將 Source 設為 **GitHub Actions**。
5. 等待 `Deploy GitHub Pages` workflow 完成，Pages 頁面會顯示網址。

GitHub Pages 版本是純靜態網站，開啟時直接向證交所取得每日盤後資料；若官方端點暫時無法從瀏覽器連線，仍可使用畫面中的 CSV／試算表貼上匯入。

## 建置

```bash
# GitHub Pages 靜態版本
pnpm build:github

# Sites / Cloudflare Worker 版本
pnpm build
```

## 資料說明

- AUTO：臺灣證券交易所／櫃買中心盤後資料（代號、名稱、標的、收盤價、到期日、履約價、行使比例）
- MANUAL：使用者輸入
- CALCULATED：網站計算
- IV、Delta、即時造市報價、在外流通比與掛單深度不會由網站猜測或補造
- 分數為候選間的策略適配度，不是報酬預測或買進建議

## 篩選與評分模型

- 硬性排除：剩餘天數少於 45 天、在外流通比達 80%、價格低於 0.5 元，或價外／Delta 達極端風險區。
- 四層篩選：Level 1 最理想，Level 2 輕微放寬，Level 3 再放寬，Level 4 僅排除重大風險；目標保留 8 檔。
- 綜合分數：造市品質 30%、IV 價格與穩定度 20%、Delta／價內外 15%、實質槓桿 15%、剩餘天數 10%、在外流通比 5%、成交活躍度 5%。
- 成交量只作輔助，不是硬性排除條件。買賣價差、Spread Tick、買一掛單金額、深度及 IV 穩定性優先。
- IV 採相對比較：僅與同標的、相近日數、Delta 與價內外程度的候選比較中位數；相似樣本不足時顯示待補，不以固定 IV 上限代替。
- 缺少資料不會補成中性分數；系統會降低資料完整度與可信分數，並保留欄位供使用者補齊。

所有權重與策略乘數集中於 `lib/warrant-engine.ts` 的 `MODEL_WEIGHTS` 與 `STRATEGIES`，方便後續校準。

## 測試

```bash
pnpm test:engine
pnpm exec tsc --noEmit
pnpm build:github
```
