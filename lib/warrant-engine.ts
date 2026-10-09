export type Strategy = "balanced" | "lowCost" | "longTerm" | "aggressive" | "stockLike";

export type Warrant = {
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
  selectionLevel?: 1 | 2 | 3 | 4;
  iv?: string;
  delta?: string;
  bid?: string;
  ask?: string;
  bidQty?: string;
  askQty?: string;
  outstandingRatio?: string;
  volume?: string;
  bidIv?: string;
  askIv?: string;
  iv5dChange?: string;
  iv10dChange?: string;
  iv20dChange?: string;
  ivStd?: string;
  spreadStd?: string;
  quoteStopCount?: string;
  depthDropCount?: string;
  upMoveBidIvDropCount?: string;
  quoteAt?: string;
  deltaInputSource?: "yuanta" | "manual";
  userEditedFields?: string[];
  reportedGearing?: number | null;
  dataFetchedAt?: string;
  dataMarketTime?: string | null;
  modelRiskFreeRatePct?: number;
  modelDividendYieldPct?: number;
};

export type ComponentScore = { value: number; weight: number; available: boolean; note: string };
export type MarketGrade = "green" | "yellow" | "red" | "unknown";

export type ScoredWarrant = {
  row: Warrant;
  final: number;
  rawScore: number;
  completeness: number;
  complete: boolean;
  excludedReasons: string[];
  warnings: string[];
  breakdown: Record<string, ComponentScore>;
  marketScore: number | null;
  marketGrade: MarketGrade;
  representativeIv: number | null;
  peerMedianIv: number | null;
  ivAnomaly: number | null;
  normalizedDelta: number | null;
  resolvedRawDelta: number | null;
  deltaSource: "yuanta" | "manual" | "model" | null;
  gearing: number | null;
  premium: number | null;
  market: ReturnType<typeof spread>;
  bidAmount: number | null;
};

export const FINAL_CANDIDATE_SIZE = 8;
export const PRESELECTION_POOL_SIZE = 50;
export const INITIAL_POOL_SIZE = 20;
export const DEFAULT_DELTA_MODEL = { riskFreeRatePct: 1.5, dividendYieldPct: 0 } as const;

// All model weights live here. Strategy multipliers alter emphasis, then the
// engine normalizes the result back to 100 points.
export const MODEL_WEIGHTS = {
  marketMaking: 30,
  ivQuality: 20,
  positioning: 15,
  gearing: 15,
  maturity: 10,
  outstanding: 5,
  activity: 5,
} as const;

export const STRATEGIES: Record<Strategy, {
  label: string;
  targetDelta: [number, number];
  targetGearing: [number, number];
  multipliers: Record<keyof typeof MODEL_WEIGHTS, number>;
}> = {
  balanced: {
    label: "均衡型",
    targetDelta: [0.35, 0.65],
    targetGearing: [3, 5],
    multipliers: { marketMaking: 1, ivQuality: 1, positioning: 1, gearing: 1, maturity: 1, outstanding: 1, activity: 1 },
  },
  lowCost: {
    label: "低波動率成本型",
    targetDelta: [0.4, 0.7],
    targetGearing: [3, 5],
    multipliers: { marketMaking: 1.05, ivQuality: 1.45, positioning: 1, gearing: 0.85, maturity: 0.9, outstanding: 1, activity: 0.9 },
  },
  longTerm: {
    label: "長天期型",
    targetDelta: [0.35, 0.7],
    targetGearing: [2.5, 5],
    multipliers: { marketMaking: 1, ivQuality: 0.9, positioning: 1, gearing: 0.8, maturity: 1.9, outstanding: 1, activity: 0.8 },
  },
  aggressive: {
    label: "積極槓桿型",
    targetDelta: [0.25, 0.5],
    targetGearing: [5, 7],
    multipliers: { marketMaking: 0.9, ivQuality: 0.8, positioning: 1.25, gearing: 1.65, maturity: 0.65, outstanding: 0.8, activity: 1.1 },
  },
  stockLike: {
    label: "股票替代型",
    targetDelta: [0.65, 0.85],
    targetGearing: [2, 4],
    multipliers: { marketMaking: 1.15, ivQuality: 1, positioning: 1.45, gearing: 0.75, maturity: 1.25, outstanding: 1, activity: 0.8 },
  },
};

export const COMPONENT_LABELS: Record<keyof typeof MODEL_WEIGHTS, string> = {
  marketMaking: "造市品質",
  ivQuality: "IV 價格／穩定",
  positioning: "Delta／價內外",
  gearing: "實質槓桿",
  maturity: "剩餘天數",
  outstanding: "流通比",
  activity: "成交活躍度",
};

export const numberValue = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return null;
  const result = Number(String(value).replace(/[%,$，]/g, ""));
  return Number.isFinite(result) ? result : null;
};

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function rangeScore(value: number, idealMin: number, idealMax: number, outerMin: number, outerMax: number) {
  if (value >= idealMin && value <= idealMax) return 1;
  if (value < idealMin) return clamp((value - outerMin) / (idealMin - outerMin));
  return clamp((outerMax - value) / (outerMax - idealMax));
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function estimatedNormalizedDelta(row: Warrant) {
  const spot = row.underlyingPrice ?? null;
  const strike = row.strike ?? null;
  const days = row.days ?? null;
  const iv = representativeIv(row);
  if (spot === null || spot <= 0 || strike === null || strike <= 0 || days === null || days <= 0 || iv === null || iv <= 0) return null;
  const years = days / 365;
  const sigma = iv / 100;
  const riskFreeRate = (row.modelRiskFreeRatePct ?? DEFAULT_DELTA_MODEL.riskFreeRatePct) / 100;
  const dividendYield = (row.modelDividendYieldPct ?? DEFAULT_DELTA_MODEL.dividendYieldPct) / 100;
  const d1 = (Math.log(spot / strike) + (riskFreeRate - dividendYield + sigma * sigma / 2) * years) / (sigma * Math.sqrt(years));
  const discount = Math.exp(-dividendYield * years);
  return row.kind === "put" ? discount * normalCdf(-d1) : discount * normalCdf(d1);
}

export function deltaResolution(row: Warrant) {
  const delta = numberValue(row.delta);
  const ratio = numberValue(row.ratio);
  if (delta !== null && ratio !== null && ratio > 0) {
    return {
      normalized: Math.abs(delta) / ratio,
      raw: delta,
      source: row.deltaInputSource === "yuanta" ? "yuanta" as const : "manual" as const,
    };
  }
  const estimated = estimatedNormalizedDelta(row);
  if (estimated === null || ratio === null || ratio <= 0) return { normalized: null, raw: null, source: null };
  return {
    normalized: estimated,
    raw: estimated * ratio * (row.kind === "put" ? -1 : 1),
    source: "model" as const,
  };
}

export function normalizedDelta(row: Warrant) {
  return deltaResolution(row).normalized;
}

export function warrantPrice(row: Warrant) {
  return warrantPriceResolution(row).price;
}

export function warrantPriceResolution(row: Warrant): { price: number | null; source: "mid" | "last" | null } {
  const bid = numberValue(row.bid);
  const ask = numberValue(row.ask);
  if (bid !== null && ask !== null && bid >= 0 && ask >= bid) {
    return { price: (bid + ask) / 2, source: "mid" };
  }
  const last = numberValue(row.lastPrice);
  if (last !== null && last > 0) return { price: last, source: "last" };
  return { price: null, source: null };
}

export function tickSize(price: number | null) {
  if (price === null || price < 0) return null;
  if (price < 5) return 0.01;
  if (price < 10) return 0.05;
  if (price < 50) return 0.1;
  if (price < 100) return 0.5;
  if (price < 500) return 1;
  return 5;
}

export function spread(row: Warrant) {
  const bid = numberValue(row.bid);
  const ask = numberValue(row.ask);
  if (bid === null || ask === null || bid < 0 || ask < bid) return { amount: null, percent: null, ticks: null };
  const middle = (ask + bid) / 2;
  const amount = ask - bid;
  const tick = tickSize(middle);
  return {
    amount,
    percent: middle > 0 ? (amount / middle) * 100 : null,
    ticks: tick ? amount / tick : null,
  };
}

export function effectiveGearing(row: Warrant) {
  const price = warrantPrice(row);
  const spot = row.underlyingPrice ?? null;
  const delta = deltaResolution(row).raw;
  return price !== null && price > 0 && spot !== null && spot > 0 && delta !== null
    ? (spot / price) * Math.abs(delta)
    : null;
}

export function theoreticalGearing(row: Warrant) {
  const price = warrantPrice(row);
  const spot = row.underlyingPrice ?? null;
  const ratio = numberValue(row.ratio);
  return price !== null && price > 0 && spot !== null && spot > 0 && ratio !== null && ratio > 0
    ? (spot * ratio) / price
    : null;
}

export function potentialEffectiveGearingRange(row: Warrant, strategy: Strategy): [number, number] | null {
  const gearing = theoreticalGearing(row);
  if (gearing === null) return null;
  const targetDelta = STRATEGIES[strategy].targetDelta;
  return [gearing * targetDelta[0], gearing * targetDelta[1]];
}

function representativePotentialGearing(row: Warrant, strategy: Strategy) {
  const range = potentialEffectiveGearingRange(row, strategy);
  if (!range) return null;
  const target = STRATEGIES[strategy].targetGearing;
  const targetMid = (target[0] + target[1]) / 2;
  return clamp(targetMid, range[0], range[1]);
}

export function premiumRate(row: Warrant) {
  const price = warrantPrice(row);
  const spot = row.underlyingPrice ?? null;
  if (price === null || price <= 0 || spot === null || spot <= 0 || !row.strike || !row.ratio) return null;
  const exerciseCost = price / row.ratio;
  return (row.kind === "put"
    ? (spot - row.strike + exerciseCost) / spot
    : (row.strike + exerciseCost - spot) / spot) * 100;
}

export function bidAmount(row: Warrant) {
  const bid = numberValue(row.bid);
  const quantity = numberValue(row.bidQty);
  return bid !== null && bid >= 0 && quantity !== null && quantity >= 0 ? bid * quantity * 1000 : null;
}

export function representativeIv(row: Warrant) {
  const entered = numberValue(row.iv);
  if (entered !== null) return entered;
  const bidIv = numberValue(row.bidIv);
  const askIv = numberValue(row.askIv);
  if (bidIv !== null && askIv !== null) return (bidIv + askIv) / 2;
  return bidIv ?? askIv;
}

export function peerMedianIv(row: Warrant, rows: Warrant[]) {
  const targetDelta = normalizedDelta(row);
  const peers = rows.filter((candidate) => {
    if (candidate.code === row.code || representativeIv(candidate) === null) return false;
    const daysNear = row.days === null || candidate.days === null || Math.abs(candidate.days - row.days) <= 60;
    const moneyNear = row.moneyness === null || candidate.moneyness === null || Math.abs(candidate.moneyness - row.moneyness) <= 7.5;
    const candidateDelta = normalizedDelta(candidate);
    const deltaNear = targetDelta === null || candidateDelta === null || Math.abs(candidateDelta - targetDelta) <= 0.15;
    return daysNear && moneyNear && deltaNear;
  }).map((candidate) => representativeIv(candidate) as number);
  return peers.length >= 2 ? median(peers) : null;
}

export function hardExclusionReasons(row: Warrant) {
  const reasons: string[] = [];
  const price = warrantPrice(row);
  const outstanding = numberValue(row.outstandingRatio);
  const delta = normalizedDelta(row);
  if (row.days !== null && row.days < 45) reasons.push("剩餘天數少於 45 天");
  if (outstanding !== null && outstanding >= 80) reasons.push("在外流通比達 80% 以上");
  if (price !== null && price < 0.5) reasons.push("權證價格低於 0.5 元");
  if (row.moneyness !== null && row.moneyness <= -30) reasons.push("價外程度超過 30%");
  if (delta !== null && delta < 0.1) reasons.push("標準化 Delta 低於 0.10，屬極低敏感度");
  return reasons;
}

type LevelRule = {
  level: 1 | 2 | 3 | 4;
  minDays: number;
  money: [number, number];
  delta: [number, number];
  gearing: [number, number];
  maxSpread: number;
  maxTicks: number;
  maxOutstanding: number;
  minPrice: number;
};

export const LEVEL_RULES: LevelRule[] = [
  { level: 1, minDays: 90, money: [-5, 10], delta: [0.35, 0.65], gearing: [3, 5], maxSpread: 2, maxTicks: 2, maxOutstanding: 40, minPrice: 1 },
  { level: 2, minDays: 60, money: [-10, 15], delta: [0.3, 0.7], gearing: [2.5, 6], maxSpread: 3.5, maxTicks: 3, maxOutstanding: 60, minPrice: 0.8 },
  { level: 3, minDays: 45, money: [-20, 20], delta: [0.2, 0.8], gearing: [2, 7], maxSpread: 6, maxTicks: 5, maxOutstanding: 80, minPrice: 0.5 },
  { level: 4, minDays: 45, money: [-30, 30], delta: [0.1, 0.95], gearing: [1, 12], maxSpread: 15, maxTicks: 12, maxOutstanding: 80, minPrice: 0.5 },
];

function passesIfKnown(value: number | null, predicate: (value: number) => boolean) {
  return value === null || predicate(value);
}

function strategyMoneyRange(strategy: Strategy, level: 1 | 2 | 3 | 4, fallback: [number, number]): [number, number] {
  if (strategy === "aggressive") return level === 1 ? [-15, 5] : level === 2 ? [-20, 10] : level === 3 ? [-25, 15] : [-30, 30];
  if (strategy === "stockLike") return level === 1 ? [0, 15] : level === 2 ? [-5, 20] : level === 3 ? [-10, 25] : [-30, 30];
  return fallback;
}

function expandedTarget(target: [number, number], level: 1 | 2 | 3 | 4, delta: number): [number, number] {
  const expansion = level === 1 ? 0 : level === 2 ? delta : level === 3 ? delta * 2 : delta * 4;
  return [Math.max(0, target[0] - expansion), target[1] + expansion];
}

export function earliestSelectionLevel(row: Warrant, strategy: Strategy = "balanced"): 1 | 2 | 3 | 4 | null {
  if (hardExclusionReasons(row).length) return null;
  const delta = normalizedDelta(row);
  const gearing = effectiveGearing(row);
  const theoretical = theoreticalGearing(row);
  const config = STRATEGIES[strategy];
  if (strategy === "aggressive" && gearing === null && theoretical === null) return 4;
  const potentialGearing = gearing ?? (strategy === "aggressive" ? representativePotentialGearing(row, strategy) : null);
  const quote = spread(row);
  const outstanding = numberValue(row.outstandingRatio);
  const price = warrantPrice(row);
  for (const rule of LEVEL_RULES) {
    const moneyRange = strategyMoneyRange(strategy, rule.level, rule.money);
    const deltaRange = expandedTarget(config.targetDelta, rule.level, 0.08);
    const gearingRange = expandedTarget(config.targetGearing, rule.level, 1);
    const passes = passesIfKnown(row.days, (value) => value >= rule.minDays)
      && passesIfKnown(row.moneyness, (value) => value >= moneyRange[0] && value <= moneyRange[1])
      && passesIfKnown(delta, (value) => value >= deltaRange[0] && value <= deltaRange[1])
      && passesIfKnown(potentialGearing, (value) => value >= gearingRange[0] && value <= gearingRange[1])
      && passesIfKnown(quote.percent, (value) => value <= rule.maxSpread)
      && passesIfKnown(quote.ticks, (value) => value <= rule.maxTicks + 0.05)
      && passesIfKnown(outstanding, (value) => value < rule.maxOutstanding)
      && passesIfKnown(price, (value) => value >= rule.minPrice);
    if (passes) return rule.level;
  }
  return null;
}

function initialStrategyScore(row: Warrant, strategy: Strategy) {
  const days = row.days ?? 45;
  const dayScore = clamp((days - 45) / 315);
  const money = row.moneyness;
  const moneyTarget = strategy === "aggressive" ? -8 : strategy === "stockLike" ? 5 : 1;
  const moneyScore = money === null ? 0.45 : 1 / (1 + Math.pow(Math.abs(money - moneyTarget) / 8, 1.6));
  const ratioScore = clamp((row.ratio ?? 0) / 0.05);
  const price = warrantPrice(row);
  const priceScore = price === null ? 0.45 : price < 0.5 ? 0 : price < 1 ? 0.45 : price <= 5 ? 1 : 0.8;
  const config = STRATEGIES[strategy];
  const potentialEffectiveGearing = representativePotentialGearing(row, strategy);
  const potentialScore = potentialEffectiveGearing === null
    ? strategy === "aggressive" ? 0 : 0.35
    : rangeScore(potentialEffectiveGearing, ...config.targetGearing, 0.5, 14);
  const base = strategy === "longTerm"
    ? dayScore * 0.62 + moneyScore * 0.2 + ratioScore * 0.1 + priceScore * 0.08
    : strategy === "aggressive"
      ? dayScore * 0.08 + moneyScore * 0.22 + ratioScore * 0.05 + priceScore * 0.05 + potentialScore * 0.6
      : strategy === "stockLike"
        ? dayScore * 0.3 + moneyScore * 0.5 + ratioScore * 0.12 + priceScore * 0.08
        : strategy === "lowCost"
          ? dayScore * 0.25 + moneyScore * 0.35 + ratioScore * 0.12 + priceScore * 0.28
          : dayScore * 0.35 + moneyScore * 0.4 + ratioScore * 0.15 + priceScore * 0.1;
  return Math.round(base * 100);
}

// The first pass intentionally stays structural: it prevents a very cheap IV
// quote from rescuing a warrant with poor maturity, moneyness or price.  The
// second pass then compares only plausible warrants on a like-for-like basis.
// Raw IV is never compared across different underlyings; callers pass rows for
// one underlying and peerMedianIv further restricts peers by maturity, Delta
// and moneyness.
function initialQualityScore(row: Warrant, peers: Warrant[], strategy: Strategy) {
  const structural = initialStrategyScore(row, strategy) / 100;
  const delta = normalizedDelta(row);
  const deltaScore = delta === null ? null : rangeScore(delta, ...STRATEGIES[strategy].targetDelta, 0.1, 0.95);
  const iv = representativeIv(row);
  const peerIv = peerMedianIv(row, peers);
  const ivAnomaly = iv !== null && peerIv !== null ? iv - peerIv : null;
  const ivScore = ivAnomaly === null
    ? null
    : ivAnomaly <= 0 ? 1 : ivAnomaly <= 3 ? 0.85 : ivAnomaly <= 6 ? 0.65 : ivAnomaly <= 10 ? 0.35 : 0.1;
  const marketMaking = scoreMarketMaking(row);
  const components = [
    { value: structural, weight: 35, coverage: 1 },
    { value: deltaScore, weight: 20, coverage: deltaScore === null ? 0 : 1 },
    { value: ivScore, weight: 25, coverage: ivScore === null ? 0 : 1 },
    { value: marketMaking.score, weight: 20, coverage: marketMaking.score === null ? 0 : marketMaking.coverage },
  ];
  const available = components.filter((component): component is { value: number; weight: number; coverage: number } => component.value !== null);
  const availableWeight = available.reduce((sum, component) => sum + component.weight, 0);
  const raw = availableWeight
    ? available.reduce((sum, component) => sum + component.value * component.weight, 0) / availableWeight
    : structural;
  const coverage = components.reduce((sum, component) => sum + component.coverage * component.weight, 0) / 100;
  return Math.round(raw * (0.7 + 0.3 * coverage) * 100);
}

export function pickInitialCandidates(rows: Warrant[], strategy: Strategy, target = FINAL_CANDIDATE_SIZE) {
  const eligible = rows
    .filter((row) => !hardExclusionReasons(row).length)
    .map((row) => ({ ...row, score: initialStrategyScore(row, strategy), selectionLevel: earliestSelectionLevel(row, strategy) ?? 4 }));
  const preselectionPool = [...eligible]
    .sort((a, b) => a.selectionLevel! - b.selectionLevel! || b.score - a.score || (b.days ?? 0) - (a.days ?? 0))
    .slice(0, PRESELECTION_POOL_SIZE);
  const pool = preselectionPool
    .map((row) => ({ ...row, score: initialQualityScore(row, eligible, strategy) }))
    .sort((a, b) => a.selectionLevel! - b.selectionLevel! || b.score - a.score || (b.days ?? 0) - (a.days ?? 0))
    .slice(0, INITIAL_POOL_SIZE);
  const selected: Warrant[] = [];
  for (const level of [1, 2, 3, 4] as const) {
    const current = pool.filter((row) => row.selectionLevel === level).sort((a, b) => b.score - a.score);
    for (const row of current) {
      if (selected.length >= target) break;
      selected.push(row);
    }
    if (selected.length >= target) break;
  }
  return {
    preselectionPoolSize: preselectionPool.length,
    poolSize: pool.length,
    candidates: selected,
    excludedCount: rows.length - eligible.length,
  };
}

function scoreMarketMaking(row: Warrant) {
  const quote = spread(row);
  const amount = bidAmount(row);
  const bidQty = numberValue(row.bidQty);
  const askQty = numberValue(row.askQty);
  const bidIv = numberValue(row.bidIv);
  const askIv = numberValue(row.askIv);
  const spreadStd = numberValue(row.spreadStd);
  const quoteStops = numberValue(row.quoteStopCount);
  const depthDrops = numberValue(row.depthDropCount);
  const sub: Array<{ score: number; weight: number }> = [];
  if (quote.percent !== null) sub.push({ score: quote.percent <= 1 ? 1 : quote.percent <= 2 ? 0.9 : quote.percent <= 3.5 ? 0.7 : quote.percent <= 6 ? 0.4 : 0.1, weight: 40 });
  if (quote.ticks !== null) sub.push({ score: quote.ticks <= 1.05 ? 1 : quote.ticks <= 2.05 ? 0.9 : quote.ticks <= 3.05 ? 0.65 : quote.ticks <= 5.05 ? 0.4 : 0.1, weight: 10 });
  if (amount !== null) sub.push({ score: amount >= 500_000 ? 1 : amount >= 200_000 ? 0.85 : amount >= 100_000 ? 0.65 : amount >= 50_000 ? 0.4 : 0.15, weight: 18 });
  if (bidQty !== null && askQty !== null) {
    const depth = Math.min(bidQty, askQty);
    sub.push({ score: depth >= 500 ? 1 : depth >= 200 ? 0.8 : depth >= 100 ? 0.6 : depth >= 50 ? 0.4 : 0.15, weight: 7 });
  }
  if (bidIv !== null && askIv !== null) {
    const gap = Math.abs(bidIv - askIv);
    sub.push({ score: gap <= 1 ? 1 : gap <= 2 ? 0.82 : gap <= 4 ? 0.55 : gap <= 8 ? 0.25 : 0.05, weight: 10 });
  }
  if (spreadStd !== null) sub.push({ score: spreadStd <= 0.5 ? 1 : spreadStd <= 1 ? 0.8 : spreadStd <= 2 ? 0.5 : 0.15, weight: 7 });
  if (quoteStops !== null) sub.push({ score: quoteStops <= 0 ? 1 : quoteStops <= 1 ? 0.65 : quoteStops <= 3 ? 0.3 : 0.05, weight: 4 });
  if (depthDrops !== null) sub.push({ score: depthDrops <= 0 ? 1 : depthDrops <= 1 ? 0.65 : depthDrops <= 3 ? 0.3 : 0.05, weight: 4 });
  if (!sub.length) return { score: null, coverage: 0 };
  const usedWeight = sub.reduce((sum, item) => sum + item.weight, 0);
  return { score: sub.reduce((sum, item) => sum + item.score * item.weight, 0) / usedWeight, coverage: usedWeight / 100 };
}

function scoreIvQuality(row: Warrant, rows: Warrant[]) {
  const iv = representativeIv(row);
  const peer = peerMedianIv(row, rows);
  const anomaly = iv !== null && peer !== null ? iv - peer : null;
  const bidIv = numberValue(row.bidIv);
  const askIv = numberValue(row.askIv);
  const changes = [row.iv5dChange, row.iv10dChange, row.iv20dChange].map(numberValue).filter((x): x is number => x !== null);
  const ivStd = numberValue(row.ivStd);
  const adverseDrops = numberValue(row.upMoveBidIvDropCount);
  const sub: Array<{ score: number; weight: number }> = [];
  if (anomaly !== null) sub.push({ score: anomaly <= 0 ? 1 : anomaly <= 3 ? 0.82 : anomaly <= 6 ? 0.55 : anomaly <= 10 ? 0.25 : 0.05, weight: 50 });
  if (bidIv !== null && askIv !== null) {
    const gap = Math.abs(bidIv - askIv);
    sub.push({ score: gap <= 1 ? 1 : gap <= 2 ? 0.8 : gap <= 4 ? 0.5 : 0.15, weight: 15 });
  }
  if (changes.length) {
    const maxMove = Math.max(...changes.map(Math.abs));
    sub.push({ score: maxMove <= 2 ? 1 : maxMove <= 5 ? 0.75 : maxMove <= 10 ? 0.4 : 0.1, weight: 15 });
  }
  if (ivStd !== null) sub.push({ score: ivStd <= 1.5 ? 1 : ivStd <= 3 ? 0.75 : ivStd <= 6 ? 0.4 : 0.1, weight: 10 });
  if (adverseDrops !== null) sub.push({ score: adverseDrops <= 0 ? 1 : adverseDrops <= 1 ? 0.6 : adverseDrops <= 3 ? 0.25 : 0.05, weight: 10 });
  if (!sub.length) return { score: null, coverage: 0, peer, anomaly };
  const usedWeight = sub.reduce((sum, item) => sum + item.weight, 0);
  return { score: sub.reduce((sum, item) => sum + item.score * item.weight, 0) / usedWeight, coverage: usedWeight / 100, peer, anomaly };
}

function riskWarnings(row: Warrant, ivAnomaly: number | null, strategy: Strategy) {
  const warnings: string[] = [];
  const gearing = effectiveGearing(row);
  const quote = spread(row);
  const outstanding = numberValue(row.outstandingRatio);
  const delta = normalizedDelta(row);
  const price = warrantPrice(row);
  const volume = numberValue(row.volume);
  const amount = bidAmount(row);
  if (gearing !== null && gearing > 7) warnings.push(`實質槓桿 ${gearing.toFixed(1)} 倍，高於 7 倍`);
  if (row.days !== null && row.days >= 45 && row.days < 60) warnings.push(`剩餘 ${row.days} 天，時間耗損風險偏高`);
  if (outstanding !== null && outstanding >= 60 && outstanding < 80) warnings.push(`在外流通比 ${outstanding.toFixed(1)}%，接近高風險區`);
  if (quote.percent !== null && quote.percent > 3.5) warnings.push(`Spread ${quote.percent.toFixed(1)}%，交易摩擦偏高`);
  if (delta !== null && delta < STRATEGIES[strategy].targetDelta[0]) warnings.push(`標準化 Delta ${delta.toFixed(2)}，低於${STRATEGIES[strategy].label}目標`);
  if (strategy === "aggressive" && gearing !== null && gearing < STRATEGIES.aggressive.targetGearing[0]) warnings.push(`實質槓桿 ${gearing.toFixed(1)} 倍，未達積極型 5 倍下限`);
  if (ivAnomaly !== null && ivAnomaly > 6) warnings.push(`IV 高於相似權證中位數 ${ivAnomaly.toFixed(1)} 個百分點`);
  if (price !== null && price >= 0.5 && price < 1) warnings.push(`權證價格 ${price.toFixed(2)} 元，低價跳動風險較高`);
  if (volume !== null && volume < 50 && (amount === null || amount < 100_000)) warnings.push("成交量與買一深度皆偏低");
  else if (volume !== null && volume < 50 && amount !== null && amount >= 100_000) warnings.push("成交量偏低，但買一掛單深度仍可接受");
  return warnings;
}

export function scoreRows(rows: Warrant[], strategy: Strategy): ScoredWarrant[] {
  const config = STRATEGIES[strategy];
  const adjustedWeights = Object.fromEntries(
    (Object.keys(MODEL_WEIGHTS) as Array<keyof typeof MODEL_WEIGHTS>).map((key) => [key, MODEL_WEIGHTS[key] * config.multipliers[key]]),
  ) as Record<keyof typeof MODEL_WEIGHTS, number>;
  const totalAdjustedWeight = Object.values(adjustedWeights).reduce((sum, weight) => sum + weight, 0);

  return rows.map((row) => {
    const mm = scoreMarketMaking(row);
    const ivQuality = scoreIvQuality(row, rows);
    const resolvedDelta = deltaResolution(row);
    const delta = resolvedDelta.normalized;
    const gearing = effectiveGearing(row);
    const outstanding = numberValue(row.outstandingRatio);
    const volume = numberValue(row.volume);
    const quote = spread(row);
    const components: Record<keyof typeof MODEL_WEIGHTS, { value: number | null; coverage: number; note: string }> = {
      marketMaking: { value: mm.score, coverage: mm.coverage, note: mm.score === null ? "需填 Bid／Ask 與深度" : "價差、深度、IV 差距與穩定度" },
      ivQuality: { value: ivQuality.score, coverage: ivQuality.coverage, note: ivQuality.anomaly === null ? "相似權證不足或 IV 待補" : `相對中位數 ${ivQuality.anomaly >= 0 ? "+" : ""}${ivQuality.anomaly.toFixed(1)}%` },
      positioning: {
        value: delta === null && row.moneyness === null ? null : ((delta === null ? 0.5 : rangeScore(delta, ...config.targetDelta, 0.1, 0.95)) * 0.65 + (row.moneyness === null ? 0.5 : rangeScore(row.moneyness, -5, 10, -30, 30)) * 0.35),
        coverage: (delta !== null ? 0.65 : 0) + (row.moneyness !== null ? 0.35 : 0),
        note: "標準化 Delta 與價內外位置",
      },
      gearing: { value: gearing === null ? null : rangeScore(gearing, ...config.targetGearing, 1, 12), coverage: gearing === null ? 0 : 1, note: gearing === null ? "需填 Delta 與報價" : `${gearing.toFixed(2)} 倍` },
      maturity: { value: row.days === null ? null : row.days >= 90 ? 1 : row.days >= 60 ? 0.82 : row.days >= 45 ? 0.5 : 0, coverage: row.days === null ? 0 : 1, note: row.days === null ? "到期日待補" : `${row.days} 天` },
      outstanding: { value: outstanding === null ? null : outstanding < 30 ? 1 : outstanding < 60 ? 0.75 : outstanding < 80 ? 0.35 : 0, coverage: outstanding === null ? 0 : 1, note: outstanding === null ? "在外流通比待補" : `${outstanding.toFixed(1)}%` },
      activity: { value: volume === null ? null : volume >= 500 ? 1 : volume >= 100 ? 0.8 : volume >= 20 ? 0.55 : 0.3, coverage: volume === null ? 0 : 1, note: volume === null ? "成交量待補（僅輔助）" : `${volume.toLocaleString()} 張（僅輔助）` },
    };

    let weightedScore = 0;
    let availableWeight = 0;
    let coverageWeight = 0;
    const breakdown = {} as Record<string, ComponentScore>;
    for (const key of Object.keys(MODEL_WEIGHTS) as Array<keyof typeof MODEL_WEIGHTS>) {
      const component = components[key];
      const normalizedWeight = adjustedWeights[key] / totalAdjustedWeight * 100;
      if (component.value !== null) {
        weightedScore += component.value * normalizedWeight;
        availableWeight += normalizedWeight;
      }
      coverageWeight += component.coverage * normalizedWeight;
      breakdown[key] = { value: component.value ?? 0, weight: normalizedWeight, available: component.value !== null, note: component.note };
    }
    const rawScore = availableWeight ? weightedScore / availableWeight * 100 : row.score;
    const completeness = Math.round(coverageWeight);
    // Missing data never receives a neutral score. It reduces confidence by up
    // to 35%, while the row remains visible for manual completion.
    const confidenceFactor = 0.65 + 0.35 * (completeness / 100);
    const excludedReasons = hardExclusionReasons(row);
    const final = excludedReasons.length ? 0 : rawScore * confidenceFactor;
    let marketGrade: MarketGrade = "unknown";
    if (mm.score !== null) {
      const amount = bidAmount(row);
      const hasIvStabilityEvidence = (numberValue(row.bidIv) !== null && numberValue(row.askIv) !== null) || numberValue(row.ivStd) !== null;
      const noRepeatedQuoteFailure = (numberValue(row.quoteStopCount) ?? 0) <= 1 && (numberValue(row.depthDropCount) ?? 0) <= 1;
      if (mm.score >= 0.75 && mm.coverage >= 0.5 && (quote.percent ?? 99) <= 3 && (amount ?? 0) >= 100_000 && hasIvStabilityEvidence && noRepeatedQuoteFailure) marketGrade = "green";
      else if (mm.score >= 0.48 && (quote.percent ?? 99) <= 8) marketGrade = "yellow";
      else marketGrade = "red";
    }
    return {
      // Keep the level at which the warrant entered the initial candidate set.
      // Manual metrics may change its score and warnings, but must not rewrite
      // the historical selection-level label shown to the user.
      row: { ...row, selectionLevel: row.selectionLevel ?? earliestSelectionLevel(row, strategy) ?? 4 },
      final,
      rawScore,
      completeness,
      complete: representativeIv(row) !== null && delta !== null && mm.score !== null && outstanding !== null,
      excludedReasons,
      warnings: riskWarnings(row, ivQuality.anomaly, strategy),
      breakdown,
      marketScore: mm.score === null ? null : mm.score * 100,
      marketGrade,
      representativeIv: representativeIv(row),
      peerMedianIv: ivQuality.peer,
      ivAnomaly: ivQuality.anomaly,
      normalizedDelta: delta,
      resolvedRawDelta: resolvedDelta.raw,
      deltaSource: resolvedDelta.source,
      gearing,
      premium: premiumRate(row),
      market: quote,
      bidAmount: bidAmount(row),
    };
  }).sort((a, b) => {
    if (!!a.excludedReasons.length !== !!b.excludedReasons.length) return a.excludedReasons.length ? 1 : -1;
    return b.final - a.final;
  });
}

export function rationale(item: ScoredWarrant, strategy: Strategy = "balanced") {
  const advantages: string[] = [];
  const risks = [...item.excludedReasons, ...item.warnings];
  const { row } = item;
  if ((row.days ?? 0) >= 90) advantages.push(`剩餘 ${row.days} 天，時間容錯充足`);
  const deltaTarget = STRATEGIES[strategy].targetDelta;
  const gearingTarget = STRATEGIES[strategy].targetGearing;
  if (item.normalizedDelta !== null && item.normalizedDelta >= deltaTarget[0] && item.normalizedDelta <= deltaTarget[1]) advantages.push(`標準化 Delta ${item.normalizedDelta.toFixed(2)}，符合${STRATEGIES[strategy].label}目標`);
  if (item.gearing !== null && item.gearing >= gearingTarget[0] && item.gearing <= gearingTarget[1]) advantages.push(`實質槓桿 ${item.gearing.toFixed(1)} 倍，符合${STRATEGIES[strategy].label}目標`);
  if (item.market.percent !== null && item.market.percent <= 2) advantages.push(`Spread ${item.market.percent.toFixed(1)}%，交易摩擦低`);
  if (item.bidAmount !== null && item.bidAmount >= 200_000) advantages.push(`買一掛單金額約 ${(item.bidAmount / 10_000).toFixed(0)} 萬元，承接深度充足`);
  if (item.ivAnomaly !== null && item.ivAnomaly <= 0) advantages.push(`IV 低於相似權證中位數 ${Math.abs(item.ivAnomaly).toFixed(1)} 個百分點`);
  if (item.marketGrade === "green") advantages.push("造市品質評級為穩定");
  if (!advantages.length) advantages.push("目前資料尚不足，需補入 IV、Delta 與造市報價後判斷");
  if (!risks.length && item.completeness < 75) risks.push(`資料完整度 ${item.completeness}%，部分風險尚無法判斷`);
  if (!risks.length) risks.push("未觸發主要風險條件，仍須留意盤中報價變化");
  const summary = item.excludedReasons.length
    ? `觸發硬性排除：${item.excludedReasons.join("、")}。`
    : `${advantages.slice(0, 3).join("、")}；${risks[0] ?? "未觸發主要風險"}。`;
  return { advantages: advantages.slice(0, 4), risks: risks.slice(0, 5), summary };
}
