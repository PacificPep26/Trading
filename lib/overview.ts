// "Toàn cảnh": chấm điểm 5 lớp cho từng coin, cả LONG và SHORT, chọn kèo nhiều lớp đồng thuận nhất.
// Chưa backtest được công bằng (chấm điểm nhiều lớp) → chỉ báo tay + paper tự động để đo.
import type { Candle } from "./okx.ts";
import { analyse, swings, freshSweep, wickReversal } from "./patterns.ts";
import { evaluateLiquidationRisk, type DerivativesFlow } from "./derivatives-flow.ts";
import { evaluateCvdSignal, type CvdAnalysis } from "./cvd-engine.ts";
import { evaluateOrderbookSignal, type OrderbookAnalysis } from "./orderbook-depth.ts";

export type OverviewPick = {
  coin: string;
  side: 1 | -1;
  score: number;
  reasons: string[];
  entry: number;
  stop: number;
  tp: number;
  rr: number;
  orderType: "MARKET" | "LIMIT_PULLBACK";
};

function atr14(cs: Candle[]) {
  let a = cs[0].h - cs[0].l;
  for (let i = 1; i < cs.length; i++) {
    const p = cs[i - 1].c, b = cs[i];
    a = (a * 13 + Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p))) / 14;
  }
  return a;
}

/** Chấm các lớp cho một chiều. bars: nến ĐÃ ĐÓNG. */
export function scoreSide(
  side: 1 | -1,
  ctx: {
    own: number;
    btc: number;
    h4: Candle[];
    h1: Candle[];
    m15: Candle[];
    btcH1?: Candle[];
    // dữ liệu thô: chấm theo đúng chiều đang xét (pickCoin gọi cả LONG lẫn SHORT với cùng ctx)
    flowData?: DerivativesFlow | null;
    cvdData?: CvdAnalysis | null;
    obData?: OrderbookAnalysis | null;
  },
): { score: number; reasons: string[]; entry: number; stop: number; tp: number; rr: number; orderType: "MARKET" | "LIMIT_PULLBACK" } | null {
  const { h4, h1, m15, btcH1 } = ctx;
  if (h4.length < 30 || h1.length < 30 || m15.length < 30) return null;
  const price = m15[m15.length - 1].c;
  const a1 = atr14(h1), a15 = atr14(m15);
  const reasons: string[] = [];
  let score = 0;

  // 0. Bộ lọc Shock tức thời của BTC (Intraday BTC Shock Filter)
  if (btcH1 && btcH1.length >= 15) {
    const lastBtc = btcH1[btcH1.length - 1];
    const btcAtr = atr14(btcH1);
    const btcDrop = lastBtc.o - lastBtc.c;
    // BTC vừa xả nến đỏ 1H mạnh > 1.2 ATR -> chặn ngay mọi lệnh LONG
    if (side > 0 && btcDrop > 1.2 * btcAtr) return null;
    // BTC vừa pump nến xanh 1H mạnh > 1.2 ATR -> chặn lệnh SHORT đuổi
    if (side < 0 && -btcDrop > 1.2 * btcAtr) return null;
  }

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

  // 3. Vị trí: LONG sát hỗ trợ (đáy 1H gần nhất/đáy 24h), SHORT sát cản — trong vùng Zone 1 ATR(1H)
  const s1 = swings(h1);
  const day = h1.slice(-24);
  const support = Math.max(s1.lows.length ? h1[s1.lows[s1.lows.length - 1]].l : -Infinity, Math.min(...day.map((x) => x.l)));
  const resist = Math.min(s1.highs.length ? h1[s1.highs[s1.highs.length - 1]].h : Infinity, Math.max(...day.map((x) => x.h)));
  const nearLevel = side > 0 ? (price - support) <= 1.2 * a1 && (price - support) >= -0.2 * a1 : (resist - price) <= 1.2 * a1 && (resist - price) >= -0.2 * a1;
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

  // 6–8. Order flow: chưa backtest (xem service/scripts/cvd_filter_study.py), chỉ ±1 điểm
  const flow = ctx.flowData ? evaluateLiquidationRisk(side, ctx.flowData) : null;
  const cvd = ctx.cvdData ? evaluateCvdSignal(side, ctx.cvdData) : null;
  const ob = ctx.obData ? evaluateOrderbookSignal(side, ctx.obData) : null;

  // 6. Dòng vốn phái sinh & Bẫy thanh lý (Derivatives Flow & Liquidation Risk)
  if (flow) {
    if (flow.isTrap) {
      // Đám đông đang bị kẹt đòn bẩy quá dày -> nguy cơ bẫy thanh lý, trừ điểm hoặc hủy kèo bắt đáy sớm
      score += flow.scoreBonus;
      if (flow.warningReason) reasons.push(`⚠️ ${flow.warningReason}`);
      if (score < 4) return null; // Triệt tiêu kèo nếu rơi vào bẫy thanh lý
    } else if (flow.scoreBonus > 0) {
      score += flow.scoreBonus;
      if (flow.warningReason) reasons.push(`🔥 ${flow.warningReason}`);
    }
  }

  // 7. Radar Hút Dầu (Cumulative Volume Delta - CVD Gom Hàng Ngầm)
  if (cvd) {
    if (cvd.scoreBonus > 0) {
      score += cvd.scoreBonus;
      if (cvd.reason) reasons.push(`🐳 ${cvd.reason}`);
    } else if (cvd.scoreBonus < 0) {
      score += cvd.scoreBonus;
      if (cvd.reason) reasons.push(`⚠️ ${cvd.reason}`);
      if (score < 4) return null; // Chặn Long nếu CVD xả ngầm
    }
  }

  // 8. Lực hấp dẫn Orderbook & Tường thanh khoản (Orderbook Imbalance & Limit Walls)
  if (ob) {
    if (ob.scoreBonus > 0) {
      score += ob.scoreBonus;
      if (ob.reason) reasons.push(`🧱 ${ob.reason}`);
    } else if (ob.scoreBonus < 0) {
      score += ob.scoreBonus;
      if (ob.reason) reasons.push(`⚠️ ${ob.reason}`);
      if (score < 4) return null; // Chặn nếu tường cản quá lớn ngay trước mặt
    }
  }

  // Xử lý nến phóng quá dài (cả Marubozu lẫn Pinbar râu dài)
  const range15 = last.h - last.l;
  const impulse = side > 0 ? last.c - last.l : last.h - last.c;
  const isStretched = range15 > 0.8 * a1 && impulse > 0.6 * range15;
  const entry = isStretched
    ? (side > 0 ? last.c - 0.382 * impulse : last.c + 0.382 * impulse)
    : price;
  const orderType: "MARKET" | "LIMIT_PULLBACK" = isStretched ? "LIMIT_PULLBACK" : "MARKET";

  // Kế hoạch: SL ngoài cực trị 8 nến 15m gần nhất (không đặt theo tường lệnh: tường có thể bị rút), TP trước swing 1H đối diện, cần ≥ 1.8R
  const recent = m15.slice(-8);
  const swingStop = side > 0 ? Math.min(...recent.map((x) => x.l)) - 0.1 * a15 : Math.max(...recent.map((x) => x.h)) + 0.1 * a15;
  // SL tối thiểu 1 ATR(1H): tránh bị quét râu
  const stop = side > 0 ? Math.min(swingStop, entry - a1) : Math.max(swingStop, entry + a1);
  const opp = side > 0 ? s1.highs.map((k) => h1[k].h).filter((x) => x > entry) : s1.lows.map((k) => h1[k].l).filter((x) => x < entry);
  const target = opp.length ? (side > 0 ? Math.min(...opp) : Math.max(...opp)) : NaN;
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(target) || !(risk > 0) || risk / entry > 0.06 || risk / entry < 0.012) return null;
  const tp = target - side * 0.1 * a15;
  const rr = Math.abs(tp - entry) / risk;
  return { score, reasons, entry, stop, tp, rr, orderType };
}

/** Kèo tốt nhất của coin (≥ minScore lớp, ≥ 1.5R), hoặc null. */
export function pickCoin(coin: string, ctx: Parameters<typeof scoreSide>[1], minScore = 4): OverviewPick | null {
  const picks = ([1, -1] as const)
    .map((side) => ({ side, r: scoreSide(side, ctx) }))
    .filter((x) => x.r && x.r.score >= minScore)
    .sort((a, b) => b.r!.score - a.r!.score || b.r!.rr - a.r!.rr);
  const best = picks[0];
  return best ? { coin, side: best.side, ...best.r! } : null;
}
