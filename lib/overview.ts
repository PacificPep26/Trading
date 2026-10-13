// "Toàn cảnh": chấm điểm 5 lớp cho từng coin, cả LONG và SHORT, chọn kèo nhiều lớp đồng thuận nhất.
// Chưa backtest được công bằng (chấm điểm nhiều lớp) → chỉ báo tay + paper tự động để đo.
import type { Candle } from "./okx.ts";
import { analyse, swings, freshSweep, wickReversal } from "./patterns.ts";

export type OverviewPick = {
  coin: string;
  side: 1 | -1;
  score: number;
  reasons: string[];
  entry: number;
  stop: number;
  tp: number;
  rr: number;
};

function atr14(cs: Candle[]) {
  let a = cs[0].h - cs[0].l;
  for (let i = 1; i < cs.length; i++) {
    const p = cs[i - 1].c, b = cs[i];
    a = (a * 13 + Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p))) / 14;
  }
  return a;
}

/** Chấm 5 lớp cho một chiều. bars: nến ĐÃ ĐÓNG. */
export function scoreSide(
  side: 1 | -1,
  ctx: { own: number; btc: number; h4: Candle[]; h1: Candle[]; m15: Candle[] },
): { score: number; reasons: string[]; entry: number; stop: number; tp: number; rr: number } | null {
  const { h4, h1, m15 } = ctx;
  if (h4.length < 30 || h1.length < 30 || m15.length < 30) return null;
  const price = m15[m15.length - 1].c;
  const a1 = atr14(h1), a15 = atr14(m15);
  const reasons: string[] = [];
  let score = 0;

  // 1. Xu hướng ngày của coin
  if (ctx.own === side) { score++; reasons.push(`trend ngày ${side > 0 ? "tăng" : "giảm"}`); }

  // 2. Cấu trúc 4H (đỉnh/đáy cao dần hoặc thấp dần), hoặc vừa phá đỉnh/đáy 4H
  const a4 = analyse(h4);
  const s4 = swings(h4);
  const lastHi4 = s4.highs.length ? h4[s4.highs[s4.highs.length - 1]].h : NaN;
  const lastLo4 = s4.lows.length ? h4[s4.lows[s4.lows.length - 1]].l : NaN;
  // "vừa" phá: 3 nến 4H trước còn đóng ở phía bên kia mức
  const before = h4[h4.length - 3].c;
  const broke4 = side > 0 ? price > lastHi4 && before <= lastHi4 : price < lastLo4 && before >= lastLo4;
  if (a4.trend === side || broke4) { score++; reasons.push(broke4 ? `vừa ${side > 0 ? "phá đỉnh" : "thủng đáy"} 4H` : `cấu trúc 4H ${side > 0 ? "đáy cao dần" : "đỉnh thấp dần"}`); }

  // 3. Vị trí: LONG sát hỗ trợ (đáy 1H gần nhất/đáy 24h), SHORT sát cản — trong 1 ATR(1H)
  const s1 = swings(h1);
  const day = h1.slice(-24);
  const support = Math.max(s1.lows.length ? h1[s1.lows[s1.lows.length - 1]].l : -Infinity, Math.min(...day.map((x) => x.l)));
  const resist = Math.min(s1.highs.length ? h1[s1.highs[s1.highs.length - 1]].h : Infinity, Math.max(...day.map((x) => x.h)));
  const nearLevel = side > 0 ? Math.abs(price - support) <= a1 : Math.abs(resist - price) <= a1;
  if (nearLevel || broke4) { score++; reasons.push(broke4 ? "giá vừa ra khỏi vùng" : `sát ${side > 0 ? "hỗ trợ" : "cản"} ${side > 0 ? support : resist}`); }

  // 4. Thanh khoản: vừa có râu quét đỡ/cản rồi quay lại (15m hoặc 1H)
  const sw = [freshSweep(m15), freshSweep(h1), wickReversal(m15), wickReversal(h1)].find((x) => x && x.side === side);
  if (sw) { score++; reasons.push(`vừa quét ${side > 0 ? "đáy" : "đỉnh"} ${"level" in sw ? sw.level : ""}`.trim()); }

  // 5. Lực: nến 15m cuối đúng chiều, volume ≥ 1.5x TB20; và BTC cùng chiều ngày
  const last = m15[m15.length - 1];
  const vAvg = m15.slice(-21, -1).reduce((s, x) => s + x.v, 0) / 20;
  const strong = (side > 0 ? last.c > last.o : last.c < last.o) && vAvg > 0 && last.v >= 1.5 * vAvg;
  if (strong && ctx.btc === side) { score++; reasons.push(`nến 15m mạnh, vol ${(last.v / vAvg).toFixed(1)}x, BTC cùng chiều`); }
  else if (strong) reasons.push(`nến 15m mạnh vol ${(last.v / vAvg).toFixed(1)}x (BTC ngược)`);

  // Kế hoạch: SL ngoài cực trị 8 nến 15m gần nhất, TP trước swing 1H đối diện, cần ≥ 1.5R
  const recent = m15.slice(-8);
  const swingStop = side > 0 ? Math.min(...recent.map((x) => x.l)) - 0.1 * a15 : Math.max(...recent.map((x) => x.h)) + 0.1 * a15;
  // SL tối thiểu 1 ATR(1H): SL 0.3% bị nến 15m thường quét (tin thật 2026-10-13: BTC/AVAX SL 0.28%)
  const stop = side > 0 ? Math.min(swingStop, price - a1) : Math.max(swingStop, price + a1);
  const opp = side > 0 ? s1.highs.map((k) => h1[k].h).filter((x) => x > price) : s1.lows.map((k) => h1[k].l).filter((x) => x < price);
  const target = opp.length ? (side > 0 ? Math.min(...opp) : Math.max(...opp)) : NaN;
  const risk = Math.abs(price - stop);
  if (!Number.isFinite(target) || !(risk > 0) || risk / price > 0.06) return null;
  const tp = target - side * 0.1 * a15;
  const rr = Math.abs(tp - price) / risk;
  return { score, reasons, entry: price, stop, tp, rr };
}

/** Kèo tốt nhất của coin (≥ minScore lớp, ≥ 1.5R), hoặc null. */
export function pickCoin(coin: string, ctx: Parameters<typeof scoreSide>[1], minScore = 4): OverviewPick | null {
  const picks = ([1, -1] as const)
    .map((side) => ({ side, r: scoreSide(side, ctx) }))
    .filter((x) => x.r && x.r.score >= minScore && x.r.rr >= 1.5)
    .sort((a, b) => b.r!.score - a.r!.score || b.r!.rr - a.r!.rr);
  const best = picks[0];
  return best ? { coin, side: best.side, ...best.r! } : null;
}
