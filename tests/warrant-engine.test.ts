import assert from "node:assert/strict";
import test from "node:test";
import {
  deltaResolution,
  earliestSelectionLevel,
  estimatedNormalizedDelta,
  effectiveGearing,
  hardExclusionReasons,
  peerMedianIv,
  pickInitialCandidates,
  scoreRows,
  warrantPriceResolution,
  type Warrant,
} from "../lib/warrant-engine.ts";

function warrant(code: string, overrides: Partial<Warrant> = {}): Warrant {
  return {
    id: code,
    code,
    name: `${code}測試權證`,
    issuer: "測試券商",
    expiry: "2027-12-31",
    days: 180,
    strike: 100,
    ratio: 0.08,
    underlyingCode: "2449",
    underlyingName: "測試標的",
    underlyingPrice: 100,
    lastPrice: 2,
    moneyness: 0,
    kind: "call",
    score: 50,
    source: "TEST",
    ...overrides,
  };
}

test("硬性排除涵蓋短天期、高流通比、低價與極度價外", () => {
  const row = warrant("A", { days: 44, outstandingRatio: "80", lastPrice: 0.49, moneyness: -31 });
  const reasons = hardExclusionReasons(row);
  assert.equal(reasons.length, 4);
  assert.equal(earliestSelectionLevel(row), null);
});

test("成交量低不會單獨淘汰，深度與 IV 良好可評為穩定造市", () => {
  const row = warrant("A", {
    delta: "0.04",
    bid: "1.00",
    ask: "1.01",
    bidQty: "500",
    askQty: "500",
    bidIv: "40",
    askIv: "41",
    outstandingRatio: "20",
    volume: "0",
  });
  const scored = scoreRows([row], "balanced")[0];
  assert.deepEqual(scored.excludedReasons, []);
  assert.equal(scored.marketGrade, "green");
  assert.ok(scored.warnings.some((warning) => warning.includes("成交量偏低")));
});

test("缺少造市與 IV 資料會降低完整度，不會補成中性完整分數", () => {
  const incomplete = scoreRows([warrant("A", { delta: "0.04" })], "balanced")[0];
  assert.equal(incomplete.marketGrade, "unknown");
  assert.ok(incomplete.completeness < 70);
  assert.equal(incomplete.complete, false);
});

test("輸入 IV 後可用 Black–Scholes 自動估算 Delta，人工值優先覆蓋", () => {
  const modeled = warrant("MODEL", {
    days: 365,
    strike: 100,
    underlyingPrice: 100,
    ratio: 0.08,
    iv: "20",
    modelRiskFreeRatePct: 0,
    modelDividendYieldPct: 0,
  });
  assert.ok(Math.abs((estimatedNormalizedDelta(modeled) ?? 0) - 0.5398) < 0.001);
  assert.equal(deltaResolution(modeled).source, "model");
  assert.ok(Math.abs((deltaResolution(modeled).raw ?? 0) - 0.04318) < 0.0001);
  const manual = { ...modeled, delta: "0.032" };
  assert.equal(deltaResolution(manual).source, "manual");
  assert.equal(deltaResolution(manual).normalized, 0.4);
});

test("實質槓桿一律以畫面採用的權證價格自行計算，不直接採元大欄位", () => {
  const row = warrant("086042", {
    underlyingPrice: 1965,
    ratio: 0.009,
    delta: "0.0039",
    bid: "1.14",
    ask: "",
    lastPrice: 2.68,
    reportedGearing: 6.7859,
  });
  assert.deepEqual(warrantPriceResolution(row), { price: 2.68, source: "last" });
  assert.ok(Math.abs((effectiveGearing(row) ?? 0) - 2.859) < 0.001);
});

test("Bid 或 Ask 缺失時使用成交價，連成交價也沒有才視為報價不完整", () => {
  const lastPriceRow = warrant("LAST", { bid: "1.8", ask: "", lastPrice: 2 });
  assert.deepEqual(warrantPriceResolution(lastPriceRow), { price: 2, source: "last" });

  const incomplete = warrant("NONE", { bid: "1.8", ask: "", lastPrice: null, delta: "0.04" });
  assert.deepEqual(warrantPriceResolution(incomplete), { price: null, source: null });
  assert.equal(effectiveGearing(incomplete), null);
});

test("IV 異常值使用相近日數、Delta 與價內外權證的中位數", () => {
  const rows = [
    warrant("A", { delta: "0.04", iv: "60" }),
    warrant("B", { delta: "0.039", iv: "40", days: 170, moneyness: 2 }),
    warrant("C", { delta: "0.041", iv: "42", days: 190, moneyness: -2 }),
  ];
  assert.equal(peerMedianIv(rows[0], rows), 41);
  assert.equal(scoreRows(rows, "balanced").find((item) => item.row.code === "A")?.ivAnomaly, 19);
});

test("四層逐步放寬會標示最早符合的層級", () => {
  assert.equal(earliestSelectionLevel(warrant("L1", { days: 120, moneyness: 0, lastPrice: 2 })), 1);
  assert.equal(earliestSelectionLevel(warrant("L3", { days: 50, moneyness: -15, lastPrice: 0.7 })), 3);
});

test("人工數據重評後仍保留初篩被選入的層級", () => {
  const row = warrant("KEEP", {
    selectionLevel: 1,
    delta: "0.024",
    bid: "1.99",
    ask: "2.01",
    bidQty: "200",
    askQty: "200",
  });
  assert.equal(earliestSelectionLevel(row), 3);
  assert.equal(scoreRows([row], "balanced")[0].row.selectionLevel, 1);
});

test("交易模式會改變同層候選排序", () => {
  const rows = [
    warrant("LONG", { days: 330, moneyness: 5 }),
    warrant("FAST", { days: 100, moneyness: -4, lastPrice: 0.5 }),
  ];
  assert.equal(pickInitialCandidates(rows, "longTerm", 2).candidates[0].code, "LONG");
  assert.equal(pickInitialCandidates(rows, "aggressive", 2).candidates[0].code, "FAST");
});

test("積極型初篩使用理論槓桿與目標 Delta 推估實質槓桿潛力", () => {
  const lowPotential = warrant("LOW", { lastPrice: 3.2, ratio: 0.005, underlyingPrice: 1755, moneyness: -3 });
  const highPotential = warrant("HIGH", { lastPrice: 1, ratio: 0.01, underlyingPrice: 1755, moneyness: -8 });
  const selected = pickInitialCandidates([lowPotential, highPotential], "aggressive", 2).candidates;
  assert.equal(selected[0].code, "HIGH");
  assert.equal(selected[0].selectionLevel, 1);
});

test("積極型實質槓桿未達 5 倍時會明確警告", () => {
  const scored = scoreRows([warrant("LOW-GEAR", { delta: "0.024", bid: "1.99", ask: "2.01" })], "aggressive")[0];
  assert.ok(scored.warnings.some((warning) => warning.includes("未達積極型 5 倍下限")));
});

test("初選50檔後會用同標的相對 IV、Delta 與造市品質縮成20檔", () => {
  const rows = Array.from({ length: 25 }, (_, index) => warrant(`W${index}`, {
    delta: "0.04",
    iv: index === 0 ? "100" : String(39 + index % 3),
    bid: "1.99",
    ask: "2.01",
    bidQty: "200",
    askQty: "200",
  }));
  const selection = pickInitialCandidates(rows, "balanced", 20);
  assert.equal(selection.preselectionPoolSize, 25);
  assert.equal(selection.poolSize, 20);
  assert.equal(selection.candidates.length, 20);
  assert.ok(!selection.candidates.some((row) => row.code === "W0"));
});
