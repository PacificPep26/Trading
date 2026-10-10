import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ledgerFile = path.join(process.cwd(), "data", `.test-paper-ledger-${process.pid}.ndjson`);
process.env.PAPER_LEDGER_FILE = ledgerFile;
process.env.PAPER_FEE_RATE = "0.0005";

const { appendPaperEvent, paperSummary, reconcilePaperPositions } = await import("../lib/paper-ledger.ts");

const plan = {
  strategyVersion: "paper-v2.3.1",
  coin: "SOL",
  timeframe: "4H",
  style: "bos",
  side: 1,
  signalTime: 0,
  entry: 100,
  stop: 98,
  tp1: 102,
  tp2: 104,
  riskPct: 0.02,
  sizing: { notional: 125, leverage: 10, margin: 12.5, actualRiskUsd: 2.5, isCapped: false },
  level: 99,
};
const decision = { accepted: true, code: "ACCEPTED", strategyVersion: plan.strategyVersion, plan };

try {
  appendPaperEvent({
    id: "ledger-pnl",
    at: 1,
    state: "simulated_open",
    strategyVersion: plan.strategyVersion,
    decision,
    plan,
    fill: { price: 100, feeUsd: 0, fundingUsd: 0, slippageUsd: 0 },
    equity: 50,
    peakEquity: 50,
  });

  reconcilePaperPositions("SOL", [{ t: 2, o: 100, h: 102.5, l: 99, c: 102, v: 1, closed: true }], 50);
  assert.equal(paperSummary(50).equity, 51.21875, "TP1 must credit +0.5R minus the closing fee");

  reconcilePaperPositions("SOL", [
    { t: 2, o: 100, h: 102.5, l: 99, c: 102, v: 1, closed: true },
    { t: 3, o: 102, h: 104.5, l: 101, c: 104, v: 1, closed: true },
  ], 50);
  assert.equal(paperSummary(50).equity, 53.6875, "TP2 must credit another +1R minus the closing fee");
} finally {
  if (fs.existsSync(ledgerFile)) fs.unlinkSync(ledgerFile);
}

console.log("All paper-ledger PnL tests passed!");
