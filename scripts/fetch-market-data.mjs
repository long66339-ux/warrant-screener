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
      console.log(`Fetching ${key} (attempt ${attempt}/4)...`);
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          "user-agent": "tw-warrant-screener/1.0 (+https://github.com/long66339-ux/warrant-screener)",
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`${key} ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`${key} attempt ${attempt} failed: ${error?.message ?? error}`);
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

// An official endpoint occasionally resets long-lived connections. Keep the
// deployment usable with whichever official snapshots succeeded; the UI
// explicitly marks unavailable fields instead of inventing data.
const results = await Promise.allSettled(
  Object.entries(sources).map(async ([key, url]) => [key, await fetchJson(key, url)]),
);
const entries = results
  .filter((result) => result.status === "fulfilled")
  .map((result) => result.value);
const raw = Object.fromEntries(entries);

for (const result of results) {
  if (result.status === "rejected") {
    console.warn(`Official source unavailable for this build: ${result.reason?.message ?? result.reason}`);
  }
}

if (!entries.length) {
  console.warn("All official sources are temporarily unavailable; writing an empty, non-fabricated snapshot.");
}
const compact = {
  twse: {
    stat: raw.twse?.stat ?? "unavailable",
    date: raw.twse?.date ?? null,
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
