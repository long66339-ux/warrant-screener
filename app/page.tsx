"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Calculator, CheckCircle2, ChevronDown, Database,
  Eraser, Loader2, RefreshCw, Save, Search, ShieldCheck, Sparkles, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Strategy = "balanced" | "lowCost" | "longTerm" | "aggressive" | "stockLike";

type Warrant = {
  id: string;
  code: string;
  name: string;
  issuer: string | null;
  expiry: string | null;
  days: number | null;
  strike: number | null;
  ratio: number | null;
  underlyingCode?: string | null;
  underlyingName?: string | null;
  underlyingPrice?: number | null;
  lastPrice?: number | null;
  moneyness: number | null;
  kind?: "call" | "put" | null;
  score: number;
  source: string;
  iv?: string;
  delta?: string;
  bid?: string;
  ask?: string;
  bidQty?: string;
  askQty?: string;
  quoteAt?: string;
};

type SavedState = {
  query: string;
  kind: "call" | "put";
  rows: Warrant[];
  analyzed: boolean;
  sourceNote: string;
  stockPrice: number | null;
  strategy?: Strategy;
};

const STORAGE_KEY = "tw-warrant-screener-v1";
const INITIAL_POOL_SIZE = 20;
const FINAL_CANDIDATE_SIZE = 8;
const STRATEGIES: Record<Strategy, { label: string; targetDelta: number; weights: Record<string, number> }> = {
  balanced: { label: "均衡型", targetDelta: 0.55, weights: { days: 20, money: 15, ratio: 8, iv: 18, delta: 17, gearing: 8, premium: 7 } },
  lowCost: { label: "低成本型", targetDelta: 0.6, weights: { days: 15, money: 12, ratio: 6, iv: 25, delta: 15, gearing: 10, premium: 10 } },
  longTerm: { label: "長天期型", targetDelta: 0.55, weights: { days: 28, money: 15, ratio: 7, iv: 14, delta: 15, gearing: 7, premium: 7 } },
  aggressive: { label: "積極槓桿型", targetDelta: 0.4, weights: { days: 10, money: 10, ratio: 8, iv: 10, delta: 18, gearing: 25, premium: 12 } },
  stockLike: { label: "股票替代型", targetDelta: 0.75, weights: { days: 22, money: 14, ratio: 6, iv: 14, delta: 25, gearing: 7, premium: 5 } },
};
const COMPONENT_LABELS: Record<string, string> = {
  days: "天期", money: "價平", ratio: "比例", iv: "IV", delta: "Delta", gearing: "有效槓桿", premium: "溢價",
};
const n = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return null;
  const result = Number(String(value).replace(/[%,$，]/g, ""));
  return Number.isFinite(result) ? result : null;
};
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const fmt = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "待補"
    : value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
const ISSUERS = ["元大", "凱基", "群益", "永豐", "統一", "國泰", "國票", "中信", "富邦", "元富", "兆豐", "華南", "第一金", "台新", "康和", "玉山", "聯邦", "合庫", "中國信託"];
const inferIssuer = (name: string) => ISSUERS.find((issuer) => name.includes(issuer)) ?? null;

function parseRocDate(value: unknown) {
  const raw = String(value ?? "").trim().replace(/[年月.-]/g, "/").replace(/日/g, "");
  const parts = raw.split("/").map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return null;
  const year = parts[0] < 1911 ? parts[0] + 1911 : parts[0];
  const date = new Date(year, parts[1] - 1, parts[2]);
  return Number.isNaN(date.getTime()) ? null : date;
}

function quickScore(row: Warrant) {
  const dayScore = clamp(((row.days ?? 0) - 60) / 300);
  const ratio = row.ratio ?? 0;
  const ratioScore = clamp(ratio / 0.05);
  if (row.moneyness === null) return Math.round((dayScore * 0.62 + ratioScore * 0.38) * 100);
  const distance = Math.abs(row.moneyness);
  const moneyScore = 1 / (1 + Math.pow(distance / 7, 1.6));
  const excessPenalty = Math.max(0, distance - 20) * 1.5;
  return Math.round(clamp(((dayScore * 0.4 + moneyScore * 0.4 + ratioScore * 0.2) * 100 - excessPenalty) / 100) * 100);
}

function refinedCandidateScore(row: Warrant, strategy: Strategy) {
  const dayScore = clamp(((row.days ?? 0) - 90) / 300);
  const ratioScore = clamp((row.ratio ?? 0) / 0.05);
  if (row.moneyness === null) {
    const dayWeight = strategy === "longTerm" ? 0.82 : strategy === "aggressive" ? 0.5 : 0.68;
    return Math.round((dayScore * dayWeight + ratioScore * (1 - dayWeight)) * 100);
  }
  const distance = Math.abs(row.moneyness);
  const moneyScore = 1 / (1 + Math.pow(distance / 6, 1.85));
  const balanceScore = 1 - (Math.max(dayScore, moneyScore, ratioScore) - Math.min(dayScore, moneyScore, ratioScore));
  const excessPenalty = Math.max(0, distance - 20) * 2;
  const premium = premiumRate(row);
  const premiumScore = premium === null ? 0.5 : 1 - clamp(Math.max(0, premium) / 20);
  const price = warrantPrice(row);
  const simpleGearing = price && row.underlyingPrice && row.ratio ? (row.underlyingPrice * row.ratio) / price : null;
  const gearingScore = simpleGearing === null ? 0.45 : clamp((simpleGearing - 1) / 12);
  const aggressiveMoney = 1 / (1 + Math.pow(Math.abs(row.moneyness + 8) / 8, 1.6));
  const stockLikeMoney = 1 / (1 + Math.pow(Math.abs(row.moneyness - 5) / 7, 1.7));
  const raw = strategy === "lowCost"
    ? dayScore * 0.25 + moneyScore * 0.25 + ratioScore * 0.15 + premiumScore * 0.35
    : strategy === "longTerm"
      ? dayScore * 0.6 + moneyScore * 0.2 + ratioScore * 0.15 + balanceScore * 0.05
      : strategy === "aggressive"
        ? dayScore * 0.2 + aggressiveMoney * 0.25 + ratioScore * 0.15 + gearingScore * 0.4
        : strategy === "stockLike"
          ? dayScore * 0.35 + stockLikeMoney * 0.4 + ratioScore * 0.15 + moneyScore * 0.1
          : dayScore * 0.38 + moneyScore * 0.42 + ratioScore * 0.15 + balanceScore * 0.05;
  return Math.round(clamp((raw * 100 - excessPenalty) / 100) * 100);
}

function pickInitialCandidates(rows: Warrant[], strategy: Strategy) {
  const broadScored = rows.map((row) => ({ ...row, score: quickScore(row) }));
  const sort = (a: Warrant, b: Warrant) => b.score - a.score || (b.days ?? 0) - (a.days ?? 0);
  // 第一階段保留較寬鬆的 20 檔池；第二階段才提高價平與整體平衡的權重取 8 檔。
  const pool = broadScored.sort(sort).slice(0, INITIAL_POOL_SIZE);
  const candidates = pool
    .map((row) => ({ ...row, score: refinedCandidateScore(row, strategy) }))
    .sort(sort)
    .slice(0, FINAL_CANDIDATE_SIZE);
  return { poolSize: pool.length, candidates };
}

async function scanOfficialDirect(input: string, kind: "call" | "put", strategy: Strategy) {
  type Snapshot = {
    twse?: { stat?: string; date?: string; data?: unknown[][] };
    tpexIssues?: Record<string, unknown>[];
    tpexQuotes?: Record<string, unknown>[];
  };
  let snapshot: Snapshot | null = null;
  const loadSnapshot = async () => {
    if (snapshot) return snapshot;
    const response = await fetch("./market-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("本地官方資料快照尚未建立");
    snapshot = await response.json() as Snapshot;
    return snapshot;
  };
  let payload: { stat?: string; date?: string; data?: unknown[][] };
  try {
    const response = await fetch("https://www.twse.com.tw/rwd/zh/stock/warrantStock?response=json", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`TWSE ${response.status}`);
    payload = await response.json() as typeof payload;
  } catch {
    payload = (await loadSnapshot()).twse ?? {};
  }
  if (payload.stat !== "OK" || !Array.isArray(payload.data)) throw new Error("官方彙總表格式異常");
  const today = Date.now();
  const matches = payload.data.map((raw): Warrant | null => {
    const code = String(raw[0] ?? "").trim();
    const name = String(raw[1] ?? "").trim();
    const underlyingCode = String(raw[4] ?? "").trim();
    const underlyingName = String(raw[5] ?? "").trim();
    const type = String(raw[8] ?? "").trim();
    const matchesInput = underlyingCode === input || underlyingName === input ||
      underlyingName.replace(/\s/g, "").includes(input.replace(/\s/g, ""));
    const matchesKind = kind === "call" ? type.includes("認購") : type.includes("認售");
    if (!code || !matchesInput || !matchesKind || /[牛熊]/.test(name)) return null;
    const price = n(raw[6]);
    const lastPrice = n(raw[2]);
    const ratio = n(raw[14]);
    const strike = n(raw[15]);
    const expiryDate = parseRocDate(raw[13]);
    const days = expiryDate ? Math.max(0, Math.ceil((expiryDate.getTime() - today) / 86400000)) : null;
    const moneyness = price !== null && strike
      ? (kind === "put" ? ((strike - price) / strike) * 100 : ((price - strike) / strike) * 100)
      : null;
    const issuer = inferIssuer(name);
    return {
      id: code, code, name, issuer,
      expiry: expiryDate ? [expiryDate.getFullYear(), String(expiryDate.getMonth() + 1).padStart(2, "0"), String(expiryDate.getDate()).padStart(2, "0")].join("-") : null,
      days, strike, ratio, underlyingCode, underlyingName, underlyingPrice: price, lastPrice,
      moneyness, kind, score: 0, source: "TWSE",
      iv: "", delta: "", bid: "", ask: "", bidQty: "", askQty: "",
    };
  }).filter((x): x is Warrant => !!x && (x.days === null || x.days > 0));
  if (matches.length) {
    const selection = pickInitialCandidates(matches, strategy);
    return { ...selection, totalMatched: matches.length, date: payload.date ?? null, market: "TWSE" };
  }

  let issues: Record<string, unknown>[];
  let quotes: Record<string, unknown>[];
  try {
    const local = await loadSnapshot();
    if (!local.tpexIssues?.length || !local.tpexQuotes?.length) throw new Error("TPEx snapshot empty");
    issues = local.tpexIssues;
    quotes = local.tpexQuotes;
  } catch {
    const [issueResponse, quoteResponse] = await Promise.all([
      fetch("https://www.tpex.org.tw/openapi/v1/tpex_warrant_issue", { headers: { accept: "application/json" } }),
      fetch("https://www.tpex.org.tw/openapi/v1/tpex_warrant_daily_quts", { headers: { accept: "application/json" } }),
    ]);
    if (!issueResponse.ok || !quoteResponse.ok) throw new Error("TPEx response error");
    issues = await issueResponse.json() as Record<string, unknown>[];
    quotes = await quoteResponse.json() as Record<string, unknown>[];
  }
  const quoteByCode = new Map(quotes.map((row) => [String(row.Code ?? "").trim(), row]));
  const tpexMatches = issues.map((raw): Warrant | null => {
    const code = String(raw.Code ?? "").trim();
    const name = String(raw.Name ?? "").trim();
    const underlyingCode = String(raw.UnderlyingStockCode ?? "").trim();
    const underlyingName = String(raw.UnderlyingStock ?? "").trim();
    const type = String(raw.Type ?? "").trim();
    const matchesInput = underlyingCode === input || underlyingName === input || underlyingName.includes(input);
    const matchesKind = kind === "call" ? type.includes("認購") : type.includes("認售");
    if (!code || !matchesInput || !matchesKind || /[牛熊]/.test(name)) return null;
    const quote = quoteByCode.get(code);
    const spot = n(quote?.UnderlyingStockClosePrice);
    const lastPrice = n(quote?.Close);
    const ratio = n(raw["Latest ExerciseRatio"]);
    const strike = n(raw.LatestExercisePrice);
    const expiryRaw = String(raw.ExpiryDate ?? "").trim();
    const expiryDate = /^\d{8}$/.test(expiryRaw)
      ? new Date(Number(expiryRaw.slice(0, 4)), Number(expiryRaw.slice(4, 6)) - 1, Number(expiryRaw.slice(6, 8)))
      : parseRocDate(expiryRaw);
    const days = expiryDate ? Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / 86400000)) : null;
    const moneyness = spot !== null && strike
      ? (kind === "put" ? ((strike - spot) / strike) * 100 : ((spot - strike) / strike) * 100)
      : null;
    return {
      id: code, code, name, issuer: inferIssuer(name),
      expiry: expiryDate ? [expiryDate.getFullYear(), String(expiryDate.getMonth() + 1).padStart(2, "0"), String(expiryDate.getDate()).padStart(2, "0")].join("-") : null,
      days, strike, ratio, underlyingCode, underlyingName, underlyingPrice: spot, lastPrice,
      moneyness, kind, score: 0, source: "TPEx",
      iv: "", delta: "", bid: "", ask: "", bidQty: "", askQty: "",
    };
  }).filter((x): x is Warrant => !!x && (x.days === null || x.days > 0));
  const selection = pickInitialCandidates(tpexMatches, strategy);
  return { ...selection, totalMatched: tpexMatches.length, date: String(issues[0]?.Date ?? "") || null, market: "TPEx" };
}

function standardDelta(row: Warrant) {
  const delta = n(row.delta);
  const ratio = n(row.ratio);
  return delta !== null && ratio && ratio > 0 ? Math.abs(delta) / ratio : null;
}

function warrantPrice(row: Warrant) {
  const bid = n(row.bid); const ask = n(row.ask);
  if (bid !== null && ask !== null && ask >= bid) return (bid + ask) / 2;
  return row.lastPrice ?? null;
}

function effectiveGearing(row: Warrant) {
  const price = warrantPrice(row); const spot = row.underlyingPrice ?? null; const delta = n(row.delta);
  return price && price > 0 && spot && delta !== null ? (spot / price) * Math.abs(delta) : null;
}

function premiumRate(row: Warrant) {
  const price = warrantPrice(row); const spot = row.underlyingPrice ?? null;
  if (!price || !spot || !row.strike || !row.ratio) return null;
  const exerciseCost = price / row.ratio;
  const value = row.kind === "put"
    ? (spot - row.strike + exerciseCost) / spot
    : (row.strike + exerciseCost - spot) / spot;
  return value * 100;
}

function spread(row: Warrant) {
  const bid = n(row.bid);
  const ask = n(row.ask);
  if (bid === null || ask === null || ask < bid) return { amount: null, percent: null };
  const middle = (ask + bid) / 2;
  return { amount: ask - bid, percent: middle > 0 ? ((ask - bid) / middle) * 100 : null };
}

function scoreRows(rows: Warrant[], strategy: Strategy) {
  const config = STRATEGIES[strategy];
  const ivs = rows.map((r) => n(r.iv)).filter((x): x is number => x !== null);
  const minIv = ivs.length ? Math.min(...ivs) : null;
  const maxIv = ivs.length ? Math.max(...ivs) : null;
  const gearings = rows.map(effectiveGearing).filter((x): x is number => x !== null);
  const maxGearing = gearings.length ? Math.max(...gearings) : null;

  return rows.map((row) => {
    const breakdown: Record<string, { value: number; weight: number; available: boolean }> = {};
    const add = (key: string, value: number | null) => {
      const weight = config.weights[key];
      breakdown[key] = { value: value ?? 0.5, weight, available: value !== null };
    };
    add("days", row.days === null ? null : clamp((row.days - 60) / 300));
    if (row.moneyness !== null) {
      const d = Math.abs(row.moneyness);
      add("money", 1 / (1 + Math.pow(d / 7, 1.6)));
    } else add("money", null);
    add("ratio", row.ratio === null ? null : clamp(row.ratio / 0.05));
    const iv = n(row.iv);
    if (iv !== null) {
      const relative = minIv === maxIv ? 0.75 : 1 - ((iv - (minIv ?? iv)) / ((maxIv ?? iv) - (minIv ?? iv))) * 0.7;
      const absolute = clamp((120 - iv) / 60);
      add("iv", clamp(relative * 0.65 + absolute * 0.35));
    } else add("iv", null);
    const sd = standardDelta(row);
    add("delta", sd === null ? null : clamp(1 - Math.abs(sd - config.targetDelta) / config.targetDelta));
    const gearing = effectiveGearing(row);
    add("gearing", gearing === null || maxGearing === null ? null : clamp(gearing / maxGearing));
    const premium = premiumRate(row);
    add("premium", premium === null ? null : clamp(1 - Math.max(0, premium) / 25));

    const components = Object.values(breakdown);
    const weighted = components.reduce((sum, c) => sum + c.value * c.weight, 0);
    const weights = components.reduce((sum, c) => sum + c.weight, 0);
    const values = components.filter((c) => c.available).map((c) => c.value);
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length ? values.reduce((sum, x) => sum + (x - average) ** 2, 0) / values.length : 1;
    const balance = clamp(1 - Math.sqrt(variance));
    const base = weights ? ((weighted + balance * 7) / (weights + 7)) * 100 : row.score;

    const market = spread(row);
    let marketScore: number | null = null;
    if (market.percent !== null) {
      const spreadScore = market.percent <= 1 ? 1 : market.percent <= 3 ? 0.82 : market.percent <= 5 ? 0.62 : market.percent <= 10 ? 0.32 : 0.08;
      const bidQty = n(row.bidQty);
      const askQty = n(row.askQty);
      let depthScore = 0.5;
      if (bidQty !== null && askQty !== null && bidQty + askQty > 0) {
        const balanceRatio = Math.min(bidQty, askQty) / Math.max(bidQty, askQty, 1);
        const sizeScore = clamp(Math.log10(bidQty + askQty + 1) / 3);
        depthScore = balanceRatio * 0.55 + sizeScore * 0.45;
      }
      marketScore = (spreadScore * 0.72 + depthScore * 0.28) * 100;
    }
    const final = marketScore === null ? base : base * 0.85 + marketScore * 0.15;
    const completeness = Math.round((components.filter((c) => c.available).reduce((s, c) => s + c.weight, 0) / 93) * 100);
    const complete = iv !== null && sd !== null;
    return { row, base, final, market, marketScore, completeness, complete, breakdown, gearing, premium };
  });
}

function rationale(row: Warrant, rows: Warrant[], rank: number) {
  const advantages: string[] = [];
  const drawbacks: string[] = [];
  const iv = n(row.iv);
  const validIvs = rows.map((r) => n(r.iv)).filter((x): x is number => x !== null);
  const sd = standardDelta(row);
  const dayValues = rows.map((r) => r.days).filter((x): x is number => x !== null);
  const maxDays = dayValues.length ? Math.max(...dayValues) : null;
  const market = spread(row);
  const gearing = effectiveGearing(row);
  const premium = premiumRate(row);

  if (iv !== null && validIvs.length && iv === Math.min(...validIvs)) advantages.push(`IV ${fmt(iv, 2)}%，為候選中最低`);
  else if (iv !== null) advantages.push(`IV 已補齊，可與天期一起比較`);
  if (row.days !== null && maxDays !== null && row.days === maxDays) advantages.push(`剩餘 ${row.days} 天，天期最長`);
  else if ((row.days ?? 0) >= 180) advantages.push(`剩餘 ${row.days} 天，時間容錯較充足`);
  if (row.moneyness !== null && Math.abs(row.moneyness) <= 5) advantages.push("履約位置接近價平");
  if (sd !== null && sd >= 0.4 && sd <= 0.7) advantages.push(`標準化 Delta 約 ${fmt(sd, 3)}，敏感度結構均衡`);
  if ((row.ratio ?? 0) >= 0.05) advantages.push(`行使比例 ${fmt(row.ratio, 4)}，資金效率較佳`);
  if (gearing !== null && gearing >= 4) advantages.push(`有效槓桿約 ${fmt(gearing, 2)} 倍`);
  if (premium !== null && premium <= 8) advantages.push(`損益兩平溢價約 ${fmt(premium, 2)}%，成本壓力較低`);
  if (market.percent !== null && market.percent <= 3) advantages.push(`價差率約 ${fmt(market.percent, 2)}%，造市報價較緊`);

  if (iv === null) drawbacks.push("IV 尚未填入");
  else if (validIvs.length > 1 && iv === Math.max(...validIvs)) drawbacks.push("IV 為候選中最高，波動率成本較高");
  if (row.days === null) drawbacks.push("到期日／剩餘天數待補");
  else if (row.days < 180) drawbacks.push(`剩餘僅 ${row.days} 天，時間耗損壓力較高`);
  if (row.moneyness === null) drawbacks.push("缺少可靠標的價格，價內外未納入評分");
  else if (Math.abs(row.moneyness) > 10) drawbacks.push(`距價平約 ${fmt(Math.abs(row.moneyness), 1)}%，履約位置較遠`);
  if ((row.ratio ?? 1) < 0.02) drawbacks.push("行使比例偏低，需留意價格跳動與效率");
  if (sd === null) drawbacks.push("Delta 尚未填入，無法計算標準化 Delta");
  else if (sd > 0.8) drawbacks.push("標準化 Delta 偏高，權證價格對標的變動較敏感");
  if (market.percent !== null && market.percent > 5) drawbacks.push(`價差率約 ${fmt(market.percent, 2)}%，交易摩擦偏高`);
  if (premium !== null && premium > 15) drawbacks.push(`損益兩平溢價約 ${fmt(premium, 2)}%，價格門檻偏高`);
  if (market.percent === null) drawbacks.push("造市品質尚未填入，最終排名未納入價差");

  let positioning = "整體條件仍需補齊後再判斷。";
  if (iv !== null && validIvs.length && iv === Math.min(...validIvs)) positioning = "偏向追求較低 IV 與成本效率。";
  if (row.days !== null && row.days === maxDays && iv !== Math.min(...validIvs)) positioning = "用較高時間價值成本換取更長容錯期。";
  if (sd !== null && sd >= 0.65) positioning = "敏感度較高，偏積極型配置。";
  if (rank === 1 && iv !== null && sd !== null) positioning = "目前在天期、成本、敏感度與履約位置間最符合所選模式。";
  return { advantages: advantages.slice(0, 4), drawbacks: drawbacks.slice(0, 4), positioning };
}

function DataTag({ type }: { type: "AUTO" | "MANUAL" | "CALCULATED" }) {
  const styles = type === "AUTO" ? "border-sky-400/30 text-sky-300" : type === "MANUAL" ? "border-amber-400/30 text-amber-300" : "border-violet-400/30 text-violet-300";
  return <span className={`ml-1 rounded border px-1 py-0.5 font-mono text-[10px] ${styles}`}>{type}</span>;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"call" | "put">("call");
  const [rows, setRows] = useState<Warrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [sourceNote, setSourceNote] = useState("");
  const [stockPrice, setStockPrice] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const [paste, setPaste] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved) as SavedState;
        setQuery(state.query ?? "");
        setKind(state.kind ?? "call");
        setRows(Array.isArray(state.rows) ? state.rows : []);
        setAnalyzed(!!state.analyzed);
        setSourceNote(state.sourceNote ?? "");
        setStockPrice(state.stockPrice ?? null);
        setStrategy(state.strategy ?? "balanced");
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const state: SavedState = { query, kind, rows, analyzed, sourceNote, stockPrice, strategy };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [query, kind, rows, analyzed, sourceNote, stockPrice, strategy, hydrated]);

  const ranked = useMemo(() => {
    const scored = scoreRows(rows, strategy);
    return scored.sort((a, b) => {
      if (!analyzed) return b.row.score - a.row.score;
      if (a.complete !== b.complete) return Number(b.complete) - Number(a.complete);
      return b.final - a.final;
    });
  }, [rows, analyzed, strategy]);

  const categories = useMemo(() => {
    if (!rows.length) return [];
    const ivRows = rows.filter((r) => n(r.iv) !== null).sort((a, b) => (n(a.iv) ?? Infinity) - (n(b.iv) ?? Infinity));
    const gearingRows = rows.filter((r) => effectiveGearing(r) !== null)
      .sort((a, b) => (effectiveGearing(b) ?? 0) - (effectiveGearing(a) ?? 0));
    return [
      { label: "均衡候選", code: ranked[0]?.row.code, tone: "emerald" },
      { label: "低 IV 候選", code: ivRows[0]?.code, tone: "sky" },
      { label: "長天期候選", code: [...rows].sort((a, b) => (b.days ?? -1) - (a.days ?? -1))[0]?.code, tone: "violet" },
      { label: "積極型候選", code: gearingRows[0]?.code, tone: "amber" },
    ].filter((x) => x.code);
  }, [rows, ranked]);

  async function scan() {
    if (!query.trim()) return toast.error("請先輸入股票名稱或代號");
    setLoading(true);
    setSourceNote("");
    try {
      let data: { candidates: Warrant[]; totalMatched: number; poolSize: number; date?: string | null };
      try {
        data = await scanOfficialDirect(query.trim(), kind, strategy);
      } catch {
        const canUseServerFallback = location.hostname.endsWith("chatgpt.site") || location.hostname === "terminal.local";
        if (!canUseServerFallback) throw new Error("證交所暫時無法直接連線，請稍後重試或使用手動匯入");
        const response = await fetch(`/api/warrants?q=${encodeURIComponent(query.trim())}&kind=${kind}&strategy=${strategy}`);
        const fallback = await response.json() as {
          detail?: string; error?: string; candidates?: Warrant[]; totalMatched?: number; poolSize?: number;
          source?: { marketDate?: string | null };
        };
        if (!response.ok) throw new Error(fallback.detail ?? fallback.error);
        data = {
          candidates: fallback.candidates ?? [],
          totalMatched: fallback.totalMatched ?? 0,
          poolSize: fallback.poolSize ?? fallback.candidates?.length ?? 0,
          date: fallback.source?.marketDate,
        };
      }
      if (!data.candidates?.length) {
        setSourceNote("官方資料暫時沒有可用候選，請使用手動匯入。");
        toast.warning("自動掃描未取得候選，可使用下方手動匯入");
        return;
      }
      const existing = new Map(rows.map((r) => [r.code, r]));
      const merged = (data.candidates as Warrant[]).map((r) => ({ ...r, ...(["iv", "delta", "bid", "ask", "bidQty", "askQty"] as const)
        .reduce((acc, k) => ({ ...acc, [k]: existing.get(r.code)?.[k] ?? "" }), {}) }));
      setRows(merged);
      setStockPrice(merged[0]?.underlyingPrice ?? null);
      setSourceNote(`官方資料日 ${data.date ?? "未標示"}｜${STRATEGIES[strategy].label}｜符合 ${data.totalMatched} 檔 → 備選池 ${data.poolSize} 檔 → 最終 ${merged.length} 檔｜${new Date().toLocaleString("zh-TW")}`);
      setAnalyzed(false);
      toast.success(`已完成初篩，保留 ${merged.length} 檔候選`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "來源回應異常";
      setSourceNote(`目前無法可靠取得官方資料：${reason}`);
      toast.error(`官方資料連線失敗：${reason}`);
    } finally {
      setLoading(false);
    }
  }

  function update(code: string, field: keyof Warrant, value: string) {
    const marketField = ["bid", "ask", "bidQty", "askQty"].includes(String(field));
    setRows((current) => current.map((r) => r.code === code
      ? { ...r, [field]: value, ...(marketField ? { quoteAt: new Date().toISOString() } : {}) }
      : r));
  }

  function importRows() {
    const lines = paste.trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length) return toast.error("請貼上資料");
    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const cells = lines.map((line) => line.split(delimiter).map((x) => x.trim()));
    const normalizedHeader = cells[0].map((x) => x.toLowerCase().replace(/\s/g, ""));
    const hasHeader = normalizedHeader.some((x) => /代號|code/.test(x));
    const header = hasHeader ? normalizedHeader : ["代號", "權證", "券商", "到期日", "履約價", "行使比例", "價內外"];
    const body = hasHeader ? cells.slice(1) : cells;
    const at = (row: string[], patterns: RegExp[], fallback: number) => {
      const index = header.findIndex((h) => patterns.some((p) => p.test(h)));
      return row[index >= 0 ? index : fallback] ?? "";
    };
    const today = Date.now();
    const imported = body.map((row, index): Warrant | null => {
      const code = at(row, [/代號/, /code/], 0);
      if (!code) return null;
      const expiry = at(row, [/到期/, /expiry/], 3) || null;
      const expiryMs = expiry ? new Date(expiry).getTime() : NaN;
      return {
        id: code, code,
        name: at(row, [/權證/, /name/], 1) || code,
        issuer: at(row, [/券商/, /發行/, /issuer/], 2) || null,
        expiry,
        days: Number.isFinite(expiryMs) ? Math.max(0, Math.ceil((expiryMs - today) / 86400000)) : n(at(row, [/剩餘/, /days/], -1)),
        strike: n(at(row, [/履約價/, /strike/], 4)),
        ratio: n(at(row, [/行使比例/, /ratio/], 5)),
        moneyness: n(at(row, [/價內外/, /moneyness/], 6)),
        score: 50,
        source: "MANUAL",
        iv: at(row, [/^iv/, /隱含波動/], -1),
        delta: at(row, [/delta/], -1),
        bid: "", ask: "", bidQty: "", askQty: "",
      };
    }).filter((x): x is Warrant => !!x);
    if (!imported.length) return toast.error("無法辨識資料，請確認第一欄為權證代號");
    setRows(imported.slice(0, 10));
    setAnalyzed(false);
    setSourceNote(`使用者手動匯入｜${Math.min(imported.length, 10)} 檔`);
    setPaste("");
    toast.success(`已匯入 ${Math.min(imported.length, 10)} 檔候選`);
  }

  function analyze() {
    const missing = rows.filter((r) => n(r.iv) === null || n(r.delta) === null).length;
    setAnalyzed(true);
    if (missing) toast.warning(`已重新排名；仍有 ${missing} 檔缺少 IV 或 Delta`);
    else toast.success("已完成第二階段評分與排名");
  }

  function saveNow() {
    const state: SavedState = { query, kind, rows, analyzed, sourceNote, stockPrice, strategy };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    toast.success("分析已儲存在此裝置");
  }

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    setQuery(""); setRows([]); setAnalyzed(false); setSourceNote(""); setStockPrice(null); setPaste(""); setStrategy("balanced");
    toast.success("已清除所有資料");
  }

  useEffect(() => {
    const context = (document as unknown as {
      modelContext?: {
        registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: "batch_update_warrant_metrics",
        title: "批次填入權證數據",
        description: "依權證代號批次填入 IV、Delta、Bid、Ask 與掛單量，並同步更新畫面。",
        inputSchema: {
          type: "object",
          properties: {
            updates: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  code: { type: "string" }, iv: { type: "number" }, delta: { type: "number" },
                  bid: { type: "number" }, ask: { type: "number" },
                  bidQty: { type: "number" }, askQty: { type: "number" },
                },
                required: ["code"],
                additionalProperties: false,
              },
            },
          },
          required: ["updates"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input: unknown) {
          const updates = (input as { updates?: Array<Record<string, unknown>> })?.updates;
          if (!Array.isArray(updates) || !updates.length) throw new Error("updates 必須是非空陣列");
          const codes = new Set(rows.map((r) => r.code));
          if (updates.some((x) => typeof x.code !== "string" || !codes.has(x.code))) throw new Error("包含不存在的權證代號");
          const fields = ["iv", "delta", "bid", "ask", "bidQty", "askQty"] as const;
          setRows((current) => current.map((row) => {
            const incoming = updates.find((x) => x.code === row.code);
            if (!incoming) return row;
            const next = { ...row };
            for (const field of fields) if (typeof incoming[field] === "number") next[field] = String(incoming[field]);
            return next;
          }));
          return { updated: updates.length, codes: updates.map((x) => x.code) };
        },
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: "save_warrant_analysis",
        title: "儲存權證分析",
        description: "將目前畫面中的候選、評分輸入與造市資料儲存在此裝置。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute() {
          const state: SavedState = { query, kind, rows, analyzed, sourceNote, stockPrice, strategy };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          return { saved: true, candidates: rows.length };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => {});
    return () => lifecycle.abort();
  }, [query, kind, rows, analyzed, sourceNote, stockPrice, strategy]);

  return (
    <main className="min-h-screen bg-[#07111f] text-slate-100">
      <Toaster position="top-center" richColors />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#091525]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 font-mono text-sm font-bold text-emerald-300">W</div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">台股權證篩選器</h1>
              <p className="hidden text-xs text-slate-400 sm:block">軟性初篩 → 策略適配 → 造市品質</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && <Button variant="outline" size="sm" onClick={saveNow} className="border-white/10 bg-transparent"><Save />儲存分析</Button>}
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-slate-400"><Eraser /><span className="hidden sm:inline">清除資料</span></Button></AlertDialogTrigger>
              <AlertDialogContent className="border-white/10 bg-[#0c192b]">
                <AlertDialogHeader>
                  <AlertDialogTitle>清除這次分析？</AlertDialogTitle>
                  <AlertDialogDescription>候選權證、IV、Delta 與造市資料都會從此裝置移除，無法復原。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={clearAll}>確認清除</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-7 sm:py-7">
        <section className="rounded-xl border border-white/10 bg-[#0c192b] p-4 shadow-2xl shadow-black/20 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_190px_auto_auto] lg:items-end">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-300">股票名稱／代號</span>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && scan()} aria-label="股票名稱或代號" placeholder="例如：2449 或京元電" className="h-12 border-white/10 bg-[#07111f] text-base text-white placeholder:text-slate-600" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-300">交易模式</span>
              <Select value={strategy} onValueChange={(value) => {
                setStrategy(value as Strategy);
                setAnalyzed(false);
                if (rows.length) setSourceNote("交易模式已變更；按「重新掃描」後會依新模式重選 8 檔候選。");
              }}>
                <SelectTrigger className="h-12 w-full border-white/10 bg-[#07111f]"><SelectValue /></SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0c192b]">
                  {Object.entries(STRATEGIES).map(([value, item]) => <SelectItem key={value} value={value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as "call" | "put")} className="flex h-12 items-center gap-1 rounded-lg border border-white/10 bg-[#07111f] p-1">
              <label className={`flex h-9 cursor-pointer items-center rounded-md px-5 text-sm font-medium transition ${kind === "call" ? "bg-emerald-400 text-[#062017]" : "text-slate-400 hover:text-white"}`}><RadioGroupItem value="call" className="sr-only" />認購</label>
              <label className={`flex h-9 cursor-pointer items-center rounded-md px-5 text-sm font-medium transition ${kind === "put" ? "bg-rose-400 text-[#26070e]" : "text-slate-400 hover:text-white"}`}><RadioGroupItem value="put" className="sr-only" />認售</label>
            </RadioGroup>
            <Button size="lg" disabled={loading} onClick={scan} className="h-12 bg-emerald-400 px-6 text-[#062017] hover:bg-emerald-300">
              {loading ? <Loader2 className="animate-spin" /> : rows.length ? <RefreshCw /> : <Search />}
              {loading ? "掃描中…" : rows.length ? "重新掃描" : "開始掃描權證"}
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/8 pt-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><Database className="size-3.5" />自動來源：證交所 TWSE＋櫃買中心 TPEx 官方資料</span>
            <span>模式：{STRATEGIES[strategy].label}｜目標標準化Δ {STRATEGIES[strategy].targetDelta}</span>
            <span>初篩依可取得的天期、價平、比例、溢價／槓桿代理值；填入 IV、Delta 後再完整重評</span>
            <span>標的價格：{stockPrice === null ? "目前無法可靠取得" : `${fmt(stockPrice)} 元`}</span>
            {sourceNote && <span className={sourceNote.includes("無法") ? "text-amber-300" : "text-slate-400"}>{sourceNote}</span>}
          </div>
        </section>

        {!rows.length ? (
          <section className="mt-5 rounded-xl border border-dashed border-white/10 bg-[#091525]/65 p-5 sm:p-8">
            <div className="mx-auto flex max-w-md flex-col items-center py-10 text-center sm:py-14">
              <div className="mb-4 grid size-12 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-400"><Search /></div>
              <h2 className="font-medium text-slate-200">輸入標的後開始初篩</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">自動資料僅採可信來源；取得失敗時仍可手動匯入候選，不會以假資料填滿表格。</p>
            </div>
            <details className="mx-auto max-w-3xl rounded-lg border border-white/10 bg-[#07111f]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-slate-300">官方資料取不到？手動貼上候選<ChevronDown className="size-4" /></summary>
              <div className="border-t border-white/10 p-4">
                <p className="mb-3 text-xs leading-5 text-slate-500">可從試算表貼上 CSV 或 Tab 分隔資料。支援欄名：代號、權證、券商、到期日、剩餘天數、履約價、行使比例、價內外、IV、Delta。</p>
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="貼上候選權證資料" rows={6} placeholder={"代號,權證,券商,到期日,履約價,行使比例,價內外\n081719,權證名稱,券商,2027-04-30,145,0.033,-2.5"} className="w-full resize-y rounded-lg border border-white/10 bg-[#050c16] p-3 font-mono text-sm text-slate-200 outline-none focus:border-emerald-400" />
                <Button onClick={importRows} className="mt-3"><Upload />匯入候選</Button>
              </div>
            </details>
          </section>
        ) : (
          <>
            <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {categories.map((item) => (
                <div key={item.label} className="rounded-lg border border-white/10 bg-[#0c192b] p-4">
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-slate-100">{item.code}</div>
                </div>
              ))}
            </section>

            <section className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-[#0c192b]">
              <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <h2 className="font-semibold">候選權證比較</h2>
                  <p className="mt-1 text-xs text-slate-500">填完 IV、Delta 才進入正式排名；未完成者保留為暫定候選。Bid / Ask 與掛單量可稍後補。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={analyze} className="bg-emerald-400 text-[#062017] hover:bg-emerald-300"><Calculator />重新分析與排名</Button>
                  <details className="relative">
                    <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-white/10 px-3 text-sm"><Upload className="size-4" />改用貼上匯入</summary>
                    <div className="absolute right-0 top-11 z-20 w-[min(92vw,520px)] rounded-lg border border-white/10 bg-[#07111f] p-4 shadow-2xl">
                      <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} className="w-full resize-y rounded-md border border-white/10 bg-[#050c16] p-3 font-mono text-sm outline-none focus:border-emerald-400" placeholder="貼上 CSV 或 Tab 分隔資料" />
                      <Button onClick={importRows} size="sm" className="mt-2">確認匯入</Button>
                    </div>
                  </details>
                </div>
              </div>

              <Table className="min-w-[1840px]">
                <TableHeader className="bg-[#091525]">
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="w-14 text-slate-400">排名</TableHead>
                    <TableHead className="text-slate-400">代號／權證 <DataTag type="AUTO" /></TableHead>
                    <TableHead className="text-slate-400">券商</TableHead>
                    <TableHead className="text-slate-400">到期／天數 <DataTag type="AUTO" /></TableHead>
                    <TableHead className="text-right text-slate-400">履約價</TableHead>
                    <TableHead className="text-right text-slate-400">價內外</TableHead>
                    <TableHead className="text-right text-slate-400">行使比例</TableHead>
                    <TableHead className="text-right text-slate-400">權證價 <DataTag type="AUTO" /></TableHead>
                    <TableHead className="text-slate-400">IV % <DataTag type="MANUAL" /></TableHead>
                    <TableHead className="text-slate-400">Delta <DataTag type="MANUAL" /></TableHead>
                    <TableHead className="text-right text-slate-400">標準化 Δ <DataTag type="CALCULATED" /></TableHead>
                    <TableHead className="text-right text-slate-400">有效槓桿</TableHead>
                    <TableHead className="text-right text-slate-400">溢價率</TableHead>
                    <TableHead className="text-slate-400">Bid / Ask <DataTag type="MANUAL" /></TableHead>
                    <TableHead className="text-slate-400">買量 / 賣量</TableHead>
                    <TableHead className="text-right text-slate-400">Spread %</TableHead>
                    <TableHead className="text-right text-slate-400">適配分數</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranked.map((item, index) => {
                    const row = item.row;
                    const sd = standardDelta(row);
                    return (
                      <TableRow key={row.code} className={`border-white/8 ${index < 3 ? "bg-emerald-400/[0.035]" : ""}`}>
                        <TableCell><span className={`grid size-7 place-items-center rounded-md font-mono text-xs font-bold ${index === 0 ? "bg-emerald-400 text-[#062017]" : index < 3 ? "bg-white/10 text-slate-200" : "text-slate-500"}`}>{index + 1}</span></TableCell>
                        <TableCell>
                          <div className="font-mono font-semibold text-slate-100">{row.code}</div>
                          <div className="mt-0.5 max-w-48 truncate text-xs text-slate-500">{row.name}</div>
                        </TableCell>
                        <TableCell className="text-slate-300">{row.issuer ?? inferIssuer(row.name) ?? "待補"}</TableCell>
                        <TableCell><div>{row.expiry ?? "待補"}</div><div className="text-xs text-slate-500">{row.days === null ? "待補" : `${row.days} 天`}</div></TableCell>
                        <TableCell className="text-right font-mono">{fmt(row.strike)}</TableCell>
                        <TableCell className="text-right font-mono">{row.moneyness === null ? "待補" : `${row.moneyness > 0 ? "+" : ""}${fmt(row.moneyness, 1)}%`}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(row.ratio, 4)}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(warrantPrice(row), 2)}</TableCell>
                        <TableCell><Input inputMode="decimal" value={row.iv ?? ""} onChange={(e) => update(row.code, "iv", e.target.value)} placeholder="待填" className="h-9 w-24 border-amber-400/20 bg-amber-400/5 font-mono" /></TableCell>
                        <TableCell><Input inputMode="decimal" value={row.delta ?? ""} onChange={(e) => update(row.code, "delta", e.target.value)} placeholder="待填" className="h-9 w-24 border-amber-400/20 bg-amber-400/5 font-mono" /></TableCell>
                        <TableCell className="text-right font-mono text-violet-300">{fmt(sd, 3)}</TableCell>
                        <TableCell className="text-right font-mono text-sky-300">{item.gearing === null ? "待補" : `${fmt(item.gearing, 2)}×`}</TableCell>
                        <TableCell className="text-right font-mono">{item.premium === null ? "待補" : `${fmt(item.premium, 2)}%`}</TableCell>
                        <TableCell><div className="flex gap-1"><Input aria-label={`${row.code} Bid`} inputMode="decimal" value={row.bid ?? ""} onChange={(e) => update(row.code, "bid", e.target.value)} placeholder="Bid" className="h-9 w-20 font-mono" /><Input aria-label={`${row.code} Ask`} inputMode="decimal" value={row.ask ?? ""} onChange={(e) => update(row.code, "ask", e.target.value)} placeholder="Ask" className="h-9 w-20 font-mono" /></div>{row.quoteAt && <div className="mt-1 text-[10px] text-slate-600">{new Date(row.quoteAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</div>}</TableCell>
                        <TableCell><div className="flex gap-1"><Input aria-label={`${row.code} Bid掛單量`} inputMode="numeric" value={row.bidQty ?? ""} onChange={(e) => update(row.code, "bidQty", e.target.value)} placeholder="買量" className="h-9 w-20 font-mono" /><Input aria-label={`${row.code} Ask掛單量`} inputMode="numeric" value={row.askQty ?? ""} onChange={(e) => update(row.code, "askQty", e.target.value)} placeholder="賣量" className="h-9 w-20 font-mono" /></div></TableCell>
                        <TableCell className="text-right font-mono">{item.market.percent === null ? "待補" : `${fmt(item.market.percent, 2)}%`}</TableCell>
                        <TableCell className="text-right"><div className="font-mono text-lg font-bold text-emerald-300">{Math.round(analyzed ? item.final : row.score)}</div><div className={`text-[10px] ${item.complete ? "text-emerald-400" : "text-amber-400"}`}>{analyzed ? (item.complete ? "正式" : "暫定") : "初篩"}｜完整度 {item.completeness}%</div></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>

            {analyzed && (
              <section className="mt-5">
                <div className="mb-3 flex items-center gap-2"><Sparkles className="size-4 text-emerald-300" /><h2 className="font-semibold">{STRATEGIES[strategy].label}適配理由</h2></div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {ranked.map((item, index) => {
                    const reason = rationale(item.row, rows, index + 1);
                    return (
                      <article key={item.row.code} className={`rounded-xl border p-4 ${index === 0 ? "border-emerald-400/30 bg-emerald-400/[0.055]" : "border-white/10 bg-[#0c192b]"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-md bg-white/8 font-mono text-sm">{index + 1}</span><div><h3 className="font-mono font-semibold">{item.row.code}</h3><p className="text-xs text-slate-500">{item.row.name}</p></div></div>
                          <div className="text-right"><div className="font-mono text-xl font-bold text-emerald-300">{Math.round(item.final)}</div><div className={`text-[10px] ${item.complete ? "text-emerald-400" : "text-amber-400"}`}>{item.complete ? "正式適配分數" : "暫定分數"}</div></div>
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <div><div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-300"><CheckCircle2 className="size-3.5" />主要優勢</div><ul className="space-y-1.5 text-sm text-slate-300">{reason.advantages.length ? reason.advantages.map((x) => <li key={x}>• {x}</li>) : <li>• 尚無足夠資料</li>}</ul></div>
                          <div><div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-300"><AlertTriangle className="size-3.5" />主要缺點</div><ul className="space-y-1.5 text-sm text-slate-400">{reason.drawbacks.map((x) => <li key={x}>• {x}</li>)}</ul></div>
                        </div>
                        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
                          {Object.entries(item.breakdown).map(([key, component]) => (
                            <div key={key} className="rounded-md border border-white/8 bg-black/10 px-2 py-2 text-center">
                              <div className="text-[10px] text-slate-500">{COMPONENT_LABELS[key]}</div>
                              <div className={`mt-1 font-mono text-xs ${component.available ? "text-slate-200" : "text-amber-400"}`}>{component.available ? `${Math.round(component.value * component.weight)}/${component.weight}` : `待補/${component.weight}`}</div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-sm text-slate-300"><span className="mr-2 text-xs font-semibold text-sky-300">定位</span>{reason.positioning}</div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="mt-5 flex flex-col gap-3 rounded-xl border border-white/10 bg-[#091525] p-4 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" /><span>適配分數用於候選間比較，不代表報酬保證。缺少 IV／Delta 者只列暫定排名；造市資料僅在 Bid／Ask 有效時以 15% 權重納入。</span></div>
              <Button variant="outline" size="sm" onClick={saveNow} className="shrink-0 border-white/10"><Save />儲存分析</Button>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
