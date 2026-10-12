import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.MEXC_API_KEY = "k"; process.env.MEXC_SECRET_KEY = "s";
process.env.MEXC_LIVE_TRADING = "true"; process.env.MEXC_DRY_RUN = "false";
const { recordOpen, recordClose, recordTrail, openTrade, loadJournal, journalStats } = await import("../lib/trade-journal.ts");
const { getRealizedPnl } = await import("../lib/mexc-client.ts");

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "journal-")), "j.json");
recordOpen({ symbol: "SOL_USDT", style: "double_top_bottom", side: -1, entry: 100, stop: 103, riskUsd: 1.2, entryTime: 1000 }, file);
recordTrail("SOL_USDT", file); recordTrail("SOL_USDT", file);
assert.equal(openTrade("SOL_USDT", file).trailMoves, 2);
recordClose("SOL_USDT", { exitTime: 2000, exitPrice: 92, pnlUsd: 3.0 }, file);
assert.equal(openTrade("SOL_USDT", file), undefined);
recordOpen({ symbol: "ETH_USDT", style: "double_top_bottom", side: 1, entry: 2500, stop: 2450, riskUsd: 0.8, entryTime: 3000 }, file);
recordClose("ETH_USDT", { exitTime: 4000, exitPrice: 2449, pnlUsd: -0.9 }, file);
recordOpen({ symbol: "LINK_USDT", style: "double_top_bottom", side: 1, entry: 13, stop: 12.6, riskUsd: 1, entryTime: 5000 }, file);
const st = journalStats(loadJournal(file));
assert.equal(st.n, 2); assert.equal(st.open, 1); assert.equal(st.wins, 1);
assert.ok(Math.abs(st.pnlUsd - 2.1) < 1e-9);
assert.ok(Math.abs(st.avgR - (2.5 + -1.125) / 2) < 1e-9);

// PnL thật: profit lệnh đóng − phí mọi lệnh, bỏ lệnh cũ / coin khác; ký GET với query đã sắp xếp
let seenUrl = "";
globalThis.fetch = async (url) => {
  seenUrl = url;
  return { ok: true, json: async () => ({ success: true, data: [
    { symbol: "SOL_USDT", side: 3, dealVol: 10, dealAvgPrice: 100, profit: 0, totalFee: 0.05, updateTime: 999_990 },
    { symbol: "SOL_USDT", side: 2, dealVol: 10, dealAvgPrice: 92, profit: 3.2, totalFee: 0.05, updateTime: 1_500_000 },
    { symbol: "SOL_USDT", side: 2, dealVol: 5, dealAvgPrice: 80, profit: 9, totalFee: 0, updateTime: 1 },
    { symbol: "ETH_USDT", side: 4, dealVol: 1, dealAvgPrice: 1, profit: 50, totalFee: 0, updateTime: 1_500_000 },
  ] }) };
};
const real = await getRealizedPnl("SOL_USDT", 1_000_000);
assert.ok(Math.abs(real.pnlUsd - 3.1) < 1e-9);
assert.equal(real.exitPrice, 92);
assert.ok(seenUrl.includes("page_num=1&page_size=50&start_time=940000&states=3&symbol=SOL_USDT"));
// chưa có lệnh đóng → null (thử lại lượt sau)
globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, data: { resultList: [] } }) });
assert.equal(await getRealizedPnl("SOL_USDT", 1_000_000), null);
console.log("All trade journal tests passed!");
