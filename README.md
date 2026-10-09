# 台股權證篩選器

以元大權證搜尋的全發行人快照自動補入 Delta、買／賣 IV、Bid、Ask、掛單量、在外流通比與實質槓桿；臺灣證券交易所及櫃買中心資料作為基本資料備援。使用者仍可以三竹等來源手動覆寫自動值。

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

GitHub Pages 版本是純靜態網站。GitHub Actions 在平日台灣時間 15:00 建置時擷取元大全發行人快照，依標的拆成小型 JSON，使用者搜尋時只會下載單一標的的資料。若元大資料暫時無法取得，網站會改用 TWSE／TPEx，不會伪造缺少欄位。

## 建置

```bash
# GitHub Pages 靜態版本
pnpm build:github

# Sites / Cloudflare Worker 版本
pnpm build
```

## 資料說明

- YUANTA：元大權證搜尋快照，查詢時不帶發行人條件，因此並非只有元大發行的權證
- AUTO：TWSE／TPEx 盤後基本資料備援
- MANUAL：使用者輸入
- CALCULATED：網站計算
- 元大快照缺少的 IV、報價或掛單深度會顯示待補，不會猜測或補造
- 分數為候選間的策略適配度，不是報酬預測或買進建議

## 篩選與評分模型

- 硬性排除：剩餘天數少於 45 天、在外流通比達 80%、價格低於 0.5 元，或價外／Delta 達極端風險區。
- 四層篩選：Level 1 最理想，Level 2 輕微放寬，Level 3 再放寬，Level 4 僅排除重大風險。先依天期、價內外、價格與策略結構保留最多 50 檔，再以原結構條件 35%、同群相對 IV 25%、標準化 Delta 20%、造市品質 20% 縮成 20 檔品質池，最後保留約 5～10 檔（預設 8 檔）。
- 綜合分數：造市品質 30%、IV 價格與穩定度 20%、Delta／價內外 15%、實質槓桿 15%、剩餘天數 10%、在外流通比 5%、成交活躍度 5%。
- 成交量只作輔助，不是硬性排除條件。買賣價差、Spread Tick、買一掛單金額、深度及 IV 穩定性優先。
- IV 採相對比較：僅與同標的、相近日數、Delta 與價內外程度的候選比較中位數；相似樣本不足時顯示待補，不以固定 IV 上限代替。
- 實質槓桿由網站以同一價格口徑自行計算：Bid／Ask 完整時採中間價，任一缺失時改採成交價並標示「成交價推算」；連成交價也沒有才顯示「報價不完整」。元大原始槓桿欄位不直接用於排序。
- Delta 可由使用者填入三竹數值；若未填但已有 IV、標的價、履約價與天期，系統會用 Black–Scholes 自動估算，並標示為 `MODEL`。無風險利率與股息率是假設值、可在畫面調整；人工 Delta 永遠優先。
- 積極槓桿型初篩會先計算理論槓桿（標的價 × 行使比例 ÷ 權證價），再以目標 Delta 區間推估實質槓桿潛力；目標為 5～7 倍。若候選均未達標，畫面會明確警告，不把低槓桿備選宣稱為積極型達標。
- 缺少資料不會補成中性分數；系統會降低資料完整度與可信分數，並保留欄位供使用者補齊。

所有權重與策略乘數集中於 `lib/warrant-engine.ts` 的 `MODEL_WEIGHTS` 與 `STRATEGIES`，方便後續校準。

## 測試

```bash
pnpm test:engine
pnpm exec tsc --noEmit
pnpm build:github
```
