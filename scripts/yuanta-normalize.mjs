export const YUANTA_COLUMNS = [
  "FLD_WAR_ID", "FLD_WAR_NM", "FLD_WAR_TYPE", "FLD_ISSUE_AGT_ID",
  "FLD_UND_ID", "FLD_UND_NM", "FLD_OBJ_TXN_PRICE", "FLD_WAR_TXN_PRICE",
  "FLD_WAR_TXN_VOLUME", "FLD_WAR_BUY_PRICE", "FLD_WAR_BUY_VOLUME",
  "FLD_WAR_SELL_PRICE", "FLD_WAR_SELL_VOLUME", "FLD_DUR_END",
  "FLD_OUT_VOL_RATE", "FLD_N_STRIKE_PRC", "FLD_N_UND_CONVER", "FLD_PERIOD",
  "FLD_IV_CLOSE_PRICE", "FLD_IV_BUY_PRICE", "FLD_IV_SELL_PRICE", "FLD_DELTA",
  "FLD_IN_OUT", "FLD_LEVERAGE", "FLD_BUY_SELL_RATE",
];

const text = (value) => String(value ?? "").trim();
const numeric = (value) => {
  const parsed = Number(text(value).replace(/,/g, ""));
  return text(value) !== "" && Number.isFinite(parsed) ? parsed : null;
};

export function parseYuantaMoneyness(value) {
  const raw = text(value);
  const parsed = Number(raw.replace(/[^0-9.+-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  if (raw.includes("價外")) return -Math.abs(parsed);
  if (raw.includes("價內")) return Math.abs(parsed);
  return parsed;
}

export function normalizeYuantaDate(value) {
  const raw = text(value);
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
}

export function safeUnderlyingFile(code) {
  return `${Buffer.from(text(code), "utf8").toString("hex")}.json`;
}

export function compactYuantaRow(row) {
  const code = text(row.FLD_WAR_ID);
  const underlyingCode = text(row.FLD_UND_ID);
  if (!code || !underlyingCode) return null;
  return {
    c: code,
    n: text(row.FLD_WAR_NM),
    k: text(row.FLD_WAR_TYPE).includes("認售") ? "put" : "call",
    i: text(row.FLD_ISSUE_AGT_ID),
    u: underlyingCode,
    un: text(row.FLD_UND_NM),
    s: numeric(row.FLD_OBJ_TXN_PRICE),
    lp: numeric(row.FLD_WAR_TXN_PRICE),
    v: numeric(row.FLD_WAR_TXN_VOLUME),
    b: numeric(row.FLD_WAR_BUY_PRICE),
    bq: numeric(row.FLD_WAR_BUY_VOLUME),
    a: numeric(row.FLD_WAR_SELL_PRICE),
    aq: numeric(row.FLD_WAR_SELL_VOLUME),
    e: normalizeYuantaDate(row.FLD_DUR_END),
    o: numeric(row.FLD_OUT_VOL_RATE),
    x: numeric(row.FLD_N_STRIKE_PRC),
    r: numeric(row.FLD_N_UND_CONVER),
    d: numeric(row.FLD_PERIOD),
    ci: numeric(row.FLD_IV_CLOSE_PRICE),
    bi: numeric(row.FLD_IV_BUY_PRICE),
    ai: numeric(row.FLD_IV_SELL_PRICE),
    dl: numeric(row.FLD_DELTA),
    m: parseYuantaMoneyness(row.FLD_IN_OUT),
    g: numeric(row.FLD_LEVERAGE),
    sp: numeric(row.FLD_BUY_SELL_RATE),
  };
}

export function summarizeYuantaRows(rows) {
  const issuers = new Set();
  let delta = 0;
  let bidIv = 0;
  let askIv = 0;
  for (const row of rows) {
    if (text(row.FLD_ISSUE_AGT_ID)) issuers.add(text(row.FLD_ISSUE_AGT_ID));
    if (numeric(row.FLD_DELTA) !== null) delta += 1;
    if (numeric(row.FLD_IV_BUY_PRICE) !== null) bidIv += 1;
    if (numeric(row.FLD_IV_SELL_PRICE) !== null) askIv += 1;
  }
  return { rows: rows.length, issuers: issuers.size, delta, bidIv, askIv };
}
