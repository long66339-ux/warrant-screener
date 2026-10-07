import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  YUANTA_COLUMNS, compactYuantaRow, safeUnderlyingFile, summarizeYuantaRows,
} from "./yuanta-normalize.mjs";

const endpoint = "https://www.warrantwin.com.tw/eyuanta/ws/GetWarData.ashx";
const target = path.resolve("public/yuanta");
const staging = path.resolve("public/yuanta-next");

async function fetchYuanta() {
  const payload = {
    format: "JSON",
    factor: {
      columns: YUANTA_COLUMNS,
      // Deliberately omit FLD_ISSUE_AGT_ID: Yuanta's UI defaults to issuer 980.
      // No issuer condition means all issuers covered by the source.
      condition: [{ field: "FLD_WAR_TYPE", values: ["1", "2"] }],
      orderby: { field: "FLD_WAR_ID", sort: "ASC" },
    },
    pagination: { row: "50000", page: "1" },
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "tw-warrant-screener/1.0 (+https://github.com/long66339-ux/warrant-screener)",
    },
    body: new URLSearchParams({ data: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Yuanta ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.result)) throw new Error("Yuanta response does not contain a result array");
  return data;
}

try {
  console.log("Fetching Yuanta all-issuer warrant enrichment...");
  const raw = await fetchYuanta();
  const active = raw.result.filter((row) => Number(row.FLD_PERIOD) > 0 && row.FLD_UND_ID);
  const coverage = summarizeYuantaRows(active);
  if (coverage.rows < 100 || coverage.issuers < 2 || coverage.delta === 0) {
    throw new Error(`Yuanta coverage validation failed: ${JSON.stringify(coverage)}`);
  }

  const grouped = new Map();
  for (const rawRow of active) {
    const row = compactYuantaRow(rawRow);
    if (!row) continue;
    const group = grouped.get(row.u) ?? { name: row.un, rows: [] };
    group.rows.push(row);
    grouped.set(row.u, group);
  }

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const underlyings = {};
  for (const [code, group] of grouped) {
    const file = safeUnderlyingFile(code);
    underlyings[code] = { name: group.name, count: group.rows.length, file };
    await writeFile(path.join(staging, file), JSON.stringify({
      fetchedAt,
      marketTime: raw.time ?? null,
      underlyingCode: code,
      underlyingName: group.name,
      warrants: group.rows,
    }));
  }
  await writeFile(path.join(staging, "index.json"), JSON.stringify({
    available: true,
    fetchedAt,
    marketTime: raw.time ?? null,
    coverage,
    underlyings,
  }));
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  console.log(`Yuanta snapshot: ${coverage.rows} warrants, ${coverage.issuers} issuers, ${grouped.size} underlyings, Delta ${coverage.delta}, bid IV ${coverage.bidIv}, ask IV ${coverage.askIv}`);
} catch (error) {
  console.warn(`Yuanta enrichment unavailable: ${error?.message ?? error}`);
  await rm(staging, { recursive: true, force: true });
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "index.json"), JSON.stringify({
    available: false,
    fetchedAt: new Date().toISOString(),
    error: "Yuanta enrichment unavailable for this build",
    underlyings: {},
  }));
}
