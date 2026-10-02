# 台股權證篩選器

以臺灣證券交易所「上市認購（售）權證每日收盤行情資訊彙總表」進行初篩，再由使用者補入 IV、Delta、Bid、Ask 與掛單量，計算策略適配分數、有效槓桿、溢價率及造市品質。

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

- AUTO：臺灣證券交易所取得
- MANUAL：使用者輸入
- CALCULATED：網站計算
- IV、Delta 與造市報價不會由網站猜測或補造
- 分數為候選間的策略適配度，不是報酬預測或買進建議
