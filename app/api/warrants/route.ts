import { NextRequest, NextResponse } from "next/server";
import { pickInitialCandidates as selectWithLevels, type Warrant } from "@/lib/warrant-engine";

export const runtime = "edge";

type Raw = Record<string, unknown>;
type Strategy = "balanced" | "lowCost" | "longTerm" | "aggressive" | "stockLike";
type Candidate = {
  id: string;
  code: string;
  name: string;
  issuer: string | null;
  expiry: string | null;
  days: number | null;
  strike: number | null;
  ratio: number | null;
  underlyingCode: string | null;
  underlyingName: string | null;
  underlyingPrice: number | null;
  lastPrice: number | null;
  moneyness: number | null;
  kind: "call" | "put" | null;
  score: number;
  source: string;
};

const ISSUERS = ["元大", "凱基", "群益", "永豐", "統一", "國泰", "國票", "中信", "富邦", "元富", "兆豐", "華南", "第一金", "台新", "康和", "玉山", "聯邦", "合庫", "中國信託"];

const tidy = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => {
  const n = Number(tidy(value).replace(/[%,$，]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const key = (value: string) => value.toLowerCase().replace(/[\s_()（）/／%-]/g, "");

function valueOf(row: Raw, aliases: string[], fuzzy: string[] = []) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const hit = entries.find(([k]) => key(k) === key(alias));
    if (hit && tidy(hit[1])) return hit[1];
  }
  for (const token of fuzzy) {
    const hit = entries.find(([k]) => key(k).includes(key(token)));
    if (hit && tidy(hit[1])) return hit[1];
  }
  return null;
}

function parseDate(value: unknown) {
  const raw = tidy(value).replace(/[.]/g, "/").replace(/[年月]/g, "/").replace(/日/g, "");
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    const date = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{7}$/.test(raw)) {
    const date = new Date(Date.UTC(Number(raw.slice(0, 3)) + 1911, Number(raw.slice(3, 5)) - 1, Number(raw.slice(5, 7))));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parts = raw.split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return null;
  const year = parts[0] < 1911 ? parts[0] + 1911 : parts[0];
  const date = new Date(Date.UTC(year, parts[1] - 1, parts[2]));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function json(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Taiwan-Warrant-Screener/1.0" },
    cf: { cacheTtl: 900, cacheEverything: true },
  } as RequestInit & { cf: Record<string, unknown> });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function rowsOf(payload: unknown): Raw[] {
  if (Array.isArray(payload)) return payload.filter((x): x is Raw => !!x && typeof x === "object");
  if (payload && typeof payload === "object") {
    for (const k of ["data", "result", "records", "aaData"]) {
      const value = (payload as Raw)[k];
      if (Array.isArray(value)) return value.filter((x): x is Raw => !!x && typeof x === "object");
    }
  }
  return [];
}

async function loadTwseWarrants() {
  const endpoint = "/rwd/zh/stock/warrantStock?response=json";
  const payload = await json(`https://www.twse.com.tw${endpoint}`) as Raw;
  const data = Array.isArray(payload.data) ? payload.data : [];
  const rows = data.filter(Array.isArray).map((row) => ({
    "權證代號": row[0],
    "權證名稱": row[1],
    "標的證券代號": row[4],
    "標的證券名稱": row[5],
    "標的收盤價": row[6],
    "權證類型": row[8],
    "權證收盤價": row[2],
    "到期日": row[13],
    "行使比例": row[14],
    "履約價格": row[15],
  }));
  if (!rows.length) throw new Error("證交所收盤彙總表暫時沒有資料");
  return { rows, endpoint, date: tidy(payload.date) || null };
}

async function loadTpexWarrants() {
  const issueEndpoint = "/openapi/v1/tpex_warrant_issue";
  const quoteEndpoint = "/openapi/v1/tpex_warrant_daily_quts";
  const [issuesPayload, quotesPayload] = await Promise.all([
    json(`https://www.tpex.org.tw${issueEndpoint}`),
    json(`https://www.tpex.org.tw${quoteEndpoint}`),
  ]);
  const issues = rowsOf(issuesPayload);
  const quotes = rowsOf(quotesPayload);
  const quoteByCode = new Map(quotes.map((row) => [tidy(row.Code), row]));
  const rows = issues.map((row) => {
    const quote = quoteByCode.get(tidy(row.Code));
    return {
      ...row,
      UnderlyingPrice: quote?.UnderlyingStockClosePrice ?? null,
      WarrantPrice: quote?.Close ?? null,
    };
  });
  if (!rows.length) throw new Error("櫃買中心權證資料暫時沒有資料");
  return { rows, endpoint: `${issueEndpoint} + ${quoteEndpoint}`, date: tidy(issues[0]?.Date) || null, source: "TPEx" };
}

function normalize(row: Raw, source: string, stockPrice: number | null): Candidate | null {
  const code = tidy(valueOf(row, ["Code", "權證代號", "證券代號"], ["權證代號"]));
  const name = tidy(valueOf(row, ["Name", "權證名稱", "證券名稱"], ["權證名稱"]));
  if (!code || !name) return null;
  const expiryDate = parseDate(valueOf(row, ["ExpiryDate", "到期日", "存續期間屆滿日"], ["到期日"]));
  const expiry = expiryDate ? expiryDate.toISOString().slice(0, 10) : null;
  const days = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null;
  const strike = num(valueOf(row, ["StrikePrice", "LatestExercisePrice", "最新履約價格", "履約價格", "履約價"], ["履約價"]));
  const ratio = num(valueOf(row, ["ConversionRatio", "ExerciseRatio", "Latest ExerciseRatio", "最新行使比例", "行使比例"], ["行使比例"]));
  const underlyingCode = tidy(valueOf(row, ["UnderlyingCode", "UnderlyingStockCode", "標的證券代號", "標的代號"], ["標的證券代號"])) || null;
  const underlyingName = tidy(valueOf(row, ["UnderlyingName", "UnderlyingStock", "標的證券名稱", "標的名稱"], ["標的證券名稱"])) || null;
  const issuerField = tidy(valueOf(row, ["IssuerName", "發行人名稱", "發行證券商", "券商"], ["發行人"]));
  const inferredIssuer = ISSUERS.find((issuer) => name.includes(issuer)) ?? "";
  const issuer = issuerField || inferredIssuer || null;
  const typeText = tidy(valueOf(row, ["Type", "認購售", "認購／認售", "權證類別"], ["認購"]));
  const kind = /認售|put|售/i.test(typeText) || name.includes("售") ? "put" : /認購|call|購/i.test(typeText) || name.includes("購") ? "call" : null;
  const actualStockPrice = stockPrice ?? num(valueOf(row, ["UnderlyingPrice", "UnderlyingStockClosePrice", "標的收盤價", "標的價格"]));
  const lastPrice = num(valueOf(row, ["權證收盤價", "WarrantPrice", "Close", "收盤價"]));
  const moneyness = actualStockPrice && strike
    ? (kind === "put" ? ((strike - actualStockPrice) / strike) * 100 : ((actualStockPrice - strike) / strike) * 100)
    : null;
  return {
    id: code,
    code,
    name,
    issuer,
    expiry,
    days: days !== null && days >= 0 ? days : null,
    strike,
    ratio,
    underlyingCode,
    underlyingName,
    underlyingPrice: actualStockPrice,
    lastPrice,
    moneyness,
    kind,
    score: 0,
    source,
  };
}

function selectCandidates(rows: Candidate[], strategy: Strategy) {
  return selectWithLevels(rows as Warrant[], strategy);
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const kind = request.nextUrl.searchParams.get("kind") === "put" ? "put" : "call";
  const requestedStrategy = request.nextUrl.searchParams.get("strategy");
  const strategy: Strategy = ["balanced", "lowCost", "longTerm", "aggressive", "stockLike"].includes(requestedStrategy ?? "")
    ? requestedStrategy as Strategy
    : "balanced";
  if (!input) return NextResponse.json({ error: "請輸入股票名稱或代號" }, { status: 400 });
  try {
    const results = await Promise.allSettled([loadTwseWarrants(), loadTpexWarrants()]);
    const markets = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (!markets.length) throw new Error("證交所與櫃買中心目前皆無法連線");
    const allRows = markets.flatMap((market) => market.rows.map((row) => ({ row, market })));
    const stockMatch = allRows.find(({ row }) => {
      const code = tidy(valueOf(row, ["UnderlyingStockCode", "標的證券代號"]));
      const name = tidy(valueOf(row, ["UnderlyingStock", "標的證券名稱"]));
      return code === input || name === input || name.replace(/\s/g, "").includes(input.replace(/\s/g, ""));
    });
    const stock = stockMatch ? {
      code: tidy(valueOf(stockMatch.row, ["UnderlyingStockCode", "標的證券代號"])),
      name: tidy(valueOf(stockMatch.row, ["UnderlyingStock", "標的證券名稱"])),
      price: num(valueOf(stockMatch.row, ["UnderlyingPrice", "標的收盤價"])),
    } : null;
    const normalized = allRows
      .map(({ row, market }) => normalize(row, "source" in market ? market.source : "TWSE", stock?.price ?? null))
      .filter((x): x is Candidate => !!x)
      .filter((w) => {
        const match = w.underlyingCode === input || w.underlyingName === input ||
          (!!stock && (w.underlyingCode === stock.code || w.underlyingName === stock.name)) ||
          (!!w.underlyingName && w.underlyingName.includes(input));
        return match && w.kind === kind && (w.days === null || w.days > 0) && !/[牛熊]/.test(w.name);
      });
    const selection = selectCandidates(normalized, strategy);
    const matchedSources = [...new Set(normalized.map((row) => row.source))];
    const marketDates = markets
      .filter((market) => matchedSources.includes("source" in market ? market.source : "TWSE"))
      .map((market) => market.date)
      .filter(Boolean);
    return NextResponse.json({
      candidates: selection.candidates,
      poolSize: selection.poolSize,
      totalMatched: normalized.length,
      stock: stock ?? { code: /^\d{4}$/.test(input) ? input : null, name: /^\d{4}$/.test(input) ? null : input, price: null },
      source: {
        name: matchedSources.includes("TPEx") ? "證交所／櫃買中心官方資料" : "臺灣證券交易所官方收盤彙總表",
        endpoint: markets.map((market) => market.endpoint).join(" ; "),
        marketDate: marketDates[0] ?? null,
        fetchedAt: new Date().toISOString(),
      },
      warning: selection.candidates.length ? null : "官方資料中找不到符合條件的未到期權證，可改用手動匯入。",
    });
  } catch (error) {
    return NextResponse.json({
      error: "目前無法可靠取得官方權證資料",
      detail: error instanceof Error ? error.message : "來源回應異常",
      candidates: [],
    }, { status: 503 });
  }
}
