import fs from "fs";
import path from "path";
import type { OrderPlan, SignalDecision } from "./decision-engine.ts";
import { MAX_DRAWDOWN, STRATEGY_VERSION } from "./trading-policy.ts";
import type { Candle } from "./okx.ts";

export type PaperState = "candidate" | "confirmed" | "planned" | "simulated_open" | "partially_closed" | "closed" | "reviewed";
export interface PaperEvent { id: string; at: number; state: PaperState; strategyVersion: string; decision: SignalDecision; plan?: OrderPlan; fill?: { price: number; feeUsd: number; fundingUsd: number; slippageUsd: number }; equity: number; peakEquity: number }
const LEDGER_FILE = process.env.PAPER_LEDGER_FILE || path.join(process.cwd(), "data", "paper-ledger.ndjson");

export function appendPaperEvent(event: PaperEvent): void {
  const exists = readPaperEvents().some((e) => e.id === event.id && e.state === event.state && e.at === event.at);
  if (exists) return;
  fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  fs.appendFileSync(LEDGER_FILE, `${JSON.stringify(event)}\n`, "utf8");
}
export function readPaperEvents(): PaperEvent[] {
  try { return fs.readFileSync(LEDGER_FILE, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}
export function paperSummary(defaultEquity = 40) {
  const events = readPaperEvents(), last = events.at(-1);
  const equity = last?.equity ?? defaultEquity;
  const peakEquity = Math.max(defaultEquity, ...events.map((e) => e.peakEquity || e.equity));
  const drawdown = peakEquity > 0 ? 1 - equity / peakEquity : 1;
  return { strategyVersion: STRATEGY_VERSION, events: events.length, closed: events.filter((e) => e.state === "closed").length, equity, peakEquity, drawdown, locked: drawdown >= MAX_DRAWDOWN };
}

function latestById(events: PaperEvent[]) {
  const latest = new Map<string, PaperEvent>();
  for (const event of events) latest.set(event.id, event);
  return latest;
}

/** Record a plan once and simulate its next-bar market fill. */
export function openPaperPlan(id: string, decision: SignalDecision, bars: Candle[], defaultEquity = 40): void {
  if (!decision.accepted || !decision.plan) return;
  const events = readPaperEvents();
  const existing = events.filter((e) => e.id === id).at(-1);
  if (existing && existing.state !== "planned") return;
  const account = paperSummary(defaultEquity);
  const plan = decision.plan;
  if (!existing) appendPaperEvent({ id, at: Date.now(), state: "planned", strategyVersion: plan.strategyVersion, decision, plan, equity: account.equity, peakEquity: account.peakEquity });
  const next = bars.find((bar) => bar.t > plan.signalTime);
  if (!next) return;
  const slippageRate = Number(process.env.PAPER_SLIPPAGE_RATE ?? 0.0002);
  const feeRate = Number(process.env.PAPER_FEE_RATE ?? 0.0008);
  const fillPrice = next.o * (1 + plan.side * slippageRate);
  const slippageUsd = Math.abs(fillPrice - next.o) / next.o * plan.sizing.notional;
  const feeUsd = plan.sizing.notional * feeRate;
  appendPaperEvent({ id, at: next.t, state: "simulated_open", strategyVersion: plan.strategyVersion, decision, plan, fill: { price: fillPrice, feeUsd, fundingUsd: 0, slippageUsd }, equity: account.equity - feeUsd, peakEquity: account.peakEquity });
}

/** Advance open positions with closed bars. If SL and TP touch in one bar, SL wins. */
export function reconcilePaperPositions(coin: string, bars: Candle[], defaultEquity = 40): void {
  const events = readPaperEvents();
  const latest = latestById(events);
  for (const current of latest.values()) {
    if (current.state !== "simulated_open" && current.state !== "partially_closed") continue;
    const plan = current.plan;
    if (!plan || plan.coin !== coin) continue;
    const after = bars.filter((bar) => bar.closed && bar.t >= current.at);
    for (const bar of after) {
      const hitStop = plan.side > 0 ? bar.l <= plan.stop : bar.h >= plan.stop;
      const hitTp1 = plan.side > 0 ? bar.h >= plan.tp1 : bar.l <= plan.tp1;
      const hitTp2 = plan.side > 0 ? bar.h >= plan.tp2 : bar.l <= plan.tp2;
      const account = paperSummary(defaultEquity);
      const feeRate = Number(process.env.PAPER_FEE_RATE ?? 0.0008);
      if (hitStop) {
        const remaining = current.state === "partially_closed" ? 0.5 : 1;
        const gross = -plan.sizing.actualRiskUsd * remaining;
        const feeUsd = plan.sizing.notional * remaining * feeRate;
        appendPaperEvent({ ...current, at: bar.t, state: "closed", fill: { price: plan.stop, feeUsd, fundingUsd: current.fill?.fundingUsd ?? 0, slippageUsd: 0 }, equity: account.equity + gross - feeUsd, peakEquity: account.peakEquity });
        break;
      }
      if (current.state === "simulated_open" && hitTp1) {
        // Close 50% at +1R => +0.5R on the original position.
        const gross = plan.sizing.actualRiskUsd * 0.5;
        const feeUsd = plan.sizing.notional * 0.5 * feeRate;
        const nextState: PaperState = hitTp2 ? "closed" : "partially_closed";
        // Close the remaining 50% at +2R => another +1R.
        const extra = hitTp2 ? plan.sizing.actualRiskUsd : 0;
        appendPaperEvent({ ...current, at: bar.t, state: nextState, fill: { price: hitTp2 ? plan.tp2 : plan.tp1, feeUsd, fundingUsd: current.fill?.fundingUsd ?? 0, slippageUsd: 0 }, equity: account.equity + gross + extra - feeUsd, peakEquity: Math.max(account.peakEquity, account.equity + gross + extra - feeUsd) });
        break;
      }
      if (current.state === "partially_closed" && hitTp2) {
        const gross = plan.sizing.actualRiskUsd;
        const feeUsd = plan.sizing.notional * 0.5 * feeRate;
        appendPaperEvent({ ...current, at: bar.t, state: "closed", fill: { price: plan.tp2, feeUsd, fundingUsd: current.fill?.fundingUsd ?? 0, slippageUsd: 0 }, equity: account.equity + gross - feeUsd, peakEquity: Math.max(account.peakEquity, account.equity + gross - feeUsd) });
        break;
      }
    }
  }
}
