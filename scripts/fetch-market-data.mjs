import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sources = {
  twse: "https://www.twse.com.tw/rwd/zh/stock/warrantStock?response=json",
  tpexIssues: "https://www.tpex.org.tw/openapi/v1/tpex_warrant_issue",
  tpexQuotes: "https://www.tpex.org.tw/openapi/v1/tpex_warrant_daily_quts",
};

async function fetchJson(key, url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`${key} ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

const entries = [];
for (const [key, url] of Object.entries(sources)) entries.push([key, await fetchJson(key, url)]);
const raw = Object.fromEntries(entries);
const compact = {
  twse: {
    stat: raw.twse?.stat,
    date: raw.twse?.date,
    data: (raw.twse?.data ?? []).map((row) => {
      const selected = [];
      for (const index of [0, 1, 2, 4, 5, 6, 8, 13, 14, 15]) selected[index] = row[index];
      return selected;
    }),
  },
  tpexIssues: (raw.tpexIssues ?? []).map((row) => ({
    Date: row.Date, Code: row.Code, Name: row.Name, ExpiryDate: row.ExpiryDate,
    UnderlyingStockCode: row.UnderlyingStockCode, UnderlyingStock: row.UnderlyingStock,
    Type: row.Type, LatestExercisePrice: row.LatestExercisePrice,
    "Latest ExerciseRatio": row["Latest ExerciseRatio"],
  })),
  tpexQuotes: (raw.tpexQuotes ?? []).map((row) => ({
    Code: row.Code, Close: row.Close, UnderlyingStockClosePrice: row.UnderlyingStockClosePrice,
  })),
};

const target = path.resolve("public/market-data.json");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify({ fetchedAt: new Date().toISOString(), ...compact }));
console.log(`Official market snapshot written to ${target}`);
