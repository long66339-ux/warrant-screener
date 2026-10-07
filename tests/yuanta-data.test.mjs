import assert from "node:assert/strict";
import test from "node:test";
import {
  compactYuantaRow, normalizeYuantaDate, parseYuantaMoneyness, summarizeYuantaRows,
} from "../scripts/yuanta-normalize.mjs";

const fixture = {
  FLD_WAR_ID: "714712", FLD_WAR_NM: "台燿元大63購01", FLD_WAR_TYPE: "認購",
  FLD_ISSUE_AGT_ID: "980", FLD_UND_ID: "6274", FLD_UND_NM: "台燿",
  FLD_OBJ_TXN_PRICE: "1720.0000", FLD_WAR_TXN_PRICE: "1.86", FLD_WAR_TXN_VOLUME: "1064",
  FLD_WAR_BUY_PRICE: "1.85", FLD_WAR_BUY_VOLUME: "499", FLD_WAR_SELL_PRICE: "1.86",
  FLD_WAR_SELL_VOLUME: "500", FLD_DUR_END: "20270316", FLD_OUT_VOL_RATE: "45.34",
  FLD_N_STRIKE_PRC: "1740.63", FLD_N_UND_CONVER: "0.0040", FLD_PERIOD: "160",
  FLD_IV_CLOSE_PRICE: "107.66", FLD_IV_BUY_PRICE: "106.20", FLD_IV_SELL_PRICE: "107.30",
  FLD_DELTA: "0.0021", FLD_IN_OUT: "1.19%價外", FLD_LEVERAGE: "2.35",
  FLD_BUY_SELL_RATE: "0.54",
};

test("元大權證欄位可轉成前端精簡快照", () => {
  const row = compactYuantaRow(fixture);
  assert.equal(row.c, "714712");
  assert.equal(row.u, "6274");
  assert.equal(row.k, "call");
  assert.equal(row.dl, 0.0021);
  assert.equal(row.bi, 106.2);
  assert.equal(row.ai, 107.3);
  assert.equal(row.m, -1.19);
  assert.equal(row.e, "2027-03-16");
});

test("價內外與日期解析不會猜測無效值", () => {
  assert.equal(parseYuantaMoneyness("8.5%價內"), 8.5);
  assert.equal(parseYuantaMoneyness("8.5%價外"), -8.5);
  assert.equal(parseYuantaMoneyness("--"), null);
  assert.equal(normalizeYuantaDate("bad"), null);
});

test("覆蓋率檢查會辨識多發行人、Delta 與雙邊 IV", () => {
  const second = { ...fixture, FLD_WAR_ID: "X", FLD_ISSUE_AGT_ID: "920", FLD_IV_SELL_PRICE: "" };
  assert.deepEqual(summarizeYuantaRows([fixture, second]), {
    rows: 2, issuers: 2, delta: 2, bidIv: 2, askIv: 1,
  });
});
