import "server-only";
import statsArtifact from "@/lib/analysis-stats.json";
import type { Candle } from "@/lib/okx";

export type Side = "long" | "short";
export type PositionInput = { side: Side; entry: number; tp: number; sl: number; margin: number; leverage: number };
export type FrameSummary = {
  bar: string; close: number; ema20: number; ema50: number; ema200: number; rsi: number; atr: number;
  volumeRatio: number; support: number; resistance: number; move: number; impulseAtr: number; impulseBarsAgo: number;
};

type StatsFile = { generatedFrom: string; rows: (string | number)[][] };
const rawStats = statsArtifact as unknown as StatsFile;
const statIndex = new Map<string, [number, number, number]>();
for (const row of rawStats.rows) {
  const [scope, context, horizon, stopAtr, rr, wins, losses, unresolved] = row;
  statIndex.set([scope, context, horizon, stopAtr, rr].join("|"), [+wins, +losses, +unresolved]);
}

function ema(values: number[], length: number) {
  const k = 2 / (length + 1); let value = values[0];
  for (const x of values.slice(1)) value += k * (x - value);
  return value;
}

function rsi(values: number[], length = 14) {
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (length - 1) + Math.max(d, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-d, 0)) / length;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

function atrSeries(cs: Candle[], length = 14) {
  const out: number[] = [];
  for (let i = 0; i < cs.length; i++) {
    const tr = i === 0 ? cs[i].h - cs[i].l : Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i - 1].c), Math.abs(cs[i].l - cs[i - 1].c));
    out.push(i === 0 ? tr : (out[i - 1] * (length - 1) + tr) / length);
  }
  return out;
}

export function summarizeFrame(candles: Candle[], bar: string): FrameSummary {
  const cs = candles.filter((c) => c.closed);
  if (cs.length < 201) throw new Error(`Không đủ nến đã đóng cho khung ${bar}`);
  const closes = cs.map((c) => c.c), atrs = atrSeries(cs), last = cs.at(-1)!;
  const prevVol = cs.slice(-21, -1).reduce((s, c) => s + c.v, 0) / 20;
  const window = cs.slice(-49, -1);
  let impulseAtr = 0, impulseBarsAgo = 0;
  cs.slice(-5).forEach((c, idx) => {
    const fullIdx = cs.length - 5 + idx;
    const value = (c.c - c.o) / Math.max(atrs[fullIdx], 1e-12);
    if (Math.abs(value) > Math.abs(impulseAtr)) { impulseAtr = value; impulseBarsAgo = 4 - idx; }
  });
  return {
    bar, close: last.c, ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200),
    rsi: rsi(closes), atr: atrs.at(-1)!, volumeRatio: prevVol ? last.v / prevVol : 1,
    support: Math.min(...window.map((c) => c.l)), resistance: Math.max(...window.map((c) => c.h)),
    move: last.c / last.o - 1, impulseAtr, impulseBarsAgo,
  };
}

function contextKey(frame: FrameSummary, side: Side, btcReturn1h: number) {
  const s = side === "long" ? 1 : -1;
  const trend = s * (frame.close - frame.ema200) > 0 ? "aligned" : "against";
  const chase = (side === "short" && frame.rsi < 30) || (side === "long" && frame.rsi > 70);
  const pullback = (side === "short" && frame.rsi > 65) || (side === "long" && frame.rsi < 35);
  const rsiKey = chase ? "chase" : pullback ? "pullback" : "mid";
  const impulse = s * frame.impulseAtr >= 1.5 && frame.impulseBarsAgo === 0 ? "deep" : s * frame.impulseAtr <= -1 && frame.impulseBarsAgo === 0 ? "reverse" : "normal";
  const volume = frame.volumeRatio >= 1.5 ? "high" : frame.volumeRatio < 0.8 ? "low" : "normal";
  const barrier = side === "long" ? frame.resistance : frame.support;
  const near = Math.abs(frame.close - barrier) <= 0.5 * frame.atr ? "near" : "far";
  const btc = s * btcReturn1h > 0.002 ? "aligned" : s * btcReturn1h < -0.002 ? "against" : "flat";
  return [trend, rsiKey, impulse, volume, near, btc].join(":");
}

function nearest(value: number, choices: number[]) {
  return choices.reduce((a, b) => Math.abs(b - value) < Math.abs(a - value) ? b : a);
}

function wilson(wins: number, total: number) {
  if (!total) return [0, 0] as const;
  const z = 1.96, p = wins / total, d = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / d;
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / d;
  return [Math.max(0, center - spread), Math.min(1, center + spread)] as const;
}

export function probability(inst: string, frame: FrameSummary, btcReturn1h: number, p: PositionInput) {
  const sideN = p.side === "long" ? 1 : -1;
  const risk = sideN * (p.entry - p.sl), reward = sideN * (p.tp - p.entry);
  if (risk <= 0 || reward <= 0) return null;
  const stopAtr = nearest(risk / frame.atr, [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5]);
  const rr = nearest(reward / risk, [1,1.5,2]);
  const horizon = 96;
  const symbol = inst.split("-")[0];
  const context = contextKey(frame, p.side, btcReturn1h);
  const candidates = [[symbol, context], ["ALL", context], [symbol, "ALL"], ["ALL", "ALL"]];
  let picked: [number, number, number] | undefined, scope = "";
  for (const [s, c] of candidates) {
    const found = statIndex.get([s, c, horizon, stopAtr, rr].join("|"));
    if (found && found[0] + found[1] >= 200) { picked = found; scope = `${s}/${c === "ALL" ? "mọi bối cảnh" : "bối cảnh tương tự"}`; break; }
  }
  if (!picked) return null;
  const [wins, losses, unresolved] = picked, decided = wins + losses;
  const [low, high] = wilson(wins, decided);
  return { probability: wins / decided, low, high, samples: decided, unresolved, scope, stopAtr, rr, source: rawStats.generatedFrom };
}

export function evaluateTiming(frame: FrameSummary, side: Side) {
  const s = side === "long" ? 1 : -1;
  const recentDeep = s * frame.impulseAtr >= 1.5 && frame.impulseBarsAgo <= 3;
  const overbought = side === "long" ? frame.rsi >= 68 : frame.rsi <= 32;
  const barrier = side === "long" ? frame.resistance : frame.support;
  const nearBarrier = Math.abs(frame.close - barrier) <= frame.atr;
  const breakout = side === "long" ? frame.close > frame.resistance : frame.close < frame.support;
  const confirmed = breakout && frame.volumeRatio >= 1.2;
  if (recentDeep && overbought && nearBarrier && !confirmed) {
    return { state: "chase" as const, text: `Giá vừa chạy một nến ${Math.abs(frame.impulseAtr).toFixed(1)} ATR và đang sát vùng ${barrier.toFixed(2)}; vào theo hướng này dễ bị hồi.` };
  }
  if (confirmed) return { state: "confirmed" as const, text: "Giá đã đóng phá vùng cấu trúc với khối lượng tăng." };
  return { state: "neutral" as const, text: "Chưa có dấu hiệu đuổi giá cực đoan, nhưng vẫn cần xác nhận cấu trúc." };
}

export function evaluatePosition(inst: string, frame: FrameSummary, btcReturn1h: number, price: number, p: PositionInput, timingFrame = frame) {
  const s = p.side === "long" ? 1 : -1, notional = p.margin * p.leverage, size = notional / p.entry;
  const fee = notional * 0.0005 * 2;
  const win = s * (p.tp - p.entry) * size - fee;
  const loss = s * (p.sl - p.entry) * size - fee;
  const breakeven = -loss / (win - loss);
  const prob = probability(inst, frame, btcReturn1h, p);
  const timing = evaluateTiming(timingFrame, p.side);
  const invalid = p.side === "long" ? price >= p.tp || price <= p.sl : price <= p.tp || price >= p.sl;
  let action = "GIỮ", tone = "neutral";
  if (invalid) { action = price === p.tp || (p.side === "long" ? price > p.tp : price < p.tp) ? "ĐÃ CHẠM TP" : "THOÁT"; tone = action.includes("TP") ? "good" : "bad"; }
  else if (timing.state === "chase" || (prob && prob.high < breakeven)) { action = "GIẢM VỊ THẾ"; tone = "bad"; }
  else if (prob && prob.low > breakeven) { action = "GIỮ"; tone = "good"; }
  const supports: string[] = [], risks: string[] = [];
  if ((p.side === "long" && frame.close > frame.ema200) || (p.side === "short" && frame.close < frame.ema200)) supports.push("Cùng hướng EMA200 khung 15m"); else risks.push("Ngược EMA200 khung 15m");
  if (timing.state === "chase") risks.push(timing.text); else supports.push(timing.text);
  return { action, tone, probability: prob, timing, supports, risks, win, loss, breakeven, rrAfterFee: win / -loss, unrealized: s * (price - p.entry) * size, fee };
}

export function scan(inst: string, frame: FrameSummary, btcReturn1h: number) {
  const opportunities = (["long", "short"] as Side[]).map((side) => {
    const s = side === "long" ? 1 : -1;
    const stop = side === "long" ? frame.support - 0.1 * frame.atr : frame.resistance + 0.1 * frame.atr;
    const risk = s * (frame.close - stop);
    if (risk <= 0 || risk > frame.close * 0.05) return null;
    const timing = evaluateTiming(frame, side);
    const variants = [1,1.5,2].map((rr) => {
      const p = { side, entry: frame.close, sl: stop, tp: frame.close + s * rr * risk, margin: 40, leverage: 15 };
      return { rr, tp: p.tp, probability: probability(inst, frame, btcReturn1h, p) };
    });
    const best = variants.filter((v) => v.probability).sort((a,b) => (b.probability!.probability - a.probability!.probability))[0];
    const feeRisk = frame.close * 0.001 / risk;
    const breakEven = best ? (1 + feeRisk) / (1 + best.rr) : 1;
    const qualified = !!best && best.probability!.low > breakEven && timing.state !== "chase";
    return { side, entry: frame.close, stop, best, timing, qualified, verdict: qualified ? "CÓ THỂ VÀO" : timing.state === "chase" ? "KHÔNG ĐUỔI GIÁ" : "CHỜ XÁC NHẬN" };
  }).filter(Boolean);
  return opportunities;
}
