// Luật kèo 4H hai đỉnh/đáy (bộ lọc + SL trailing). Bot chỉ báo tin; chủ dự án vào lệnh tay.
// Số liệu: live_replay_study.mjs mục A — 2025 +45$, 2026 +43$ (29 lệnh, +1.22R).
import type { Setup } from "./patterns.ts";

export const STRATEGY_VERSION = "v3.0.0"; // nhãn sổ paper; đổi luật vào lệnh thì tăng
export const TRAIL_ATR_MULT = 3; // trailing_study 2026-10-12: 2–4 ATR đều dương, chọn giữa vùng ổn định

/**
 * Kèo 4H đủ chuẩn báo tin: hai đỉnh/đáy vừa kích hoạt, thuận xu hướng ngày cả coin lẫn BTC, volume nến ≥ 2x TB20,
 * SL 1.5–6%, 2 nến BTC 1H gần nhất không chạy ngược ≥ 0.7%, |funding| ≤ 0.03%, tín hiệu ≤ 8 giờ, giá chưa trôi > 0.25%.
 */
export function isSwingSetupOk(s: Setup, ctx: {
  ownDaily: number; btcDaily: number; lastBarTime: number; now: number;
  btc1h?: { o: number; c: number }[]; fundingRate?: number; livePrice?: number;
}): boolean {
  if (s.style !== "double_top_bottom" || s.state !== "triggered") return false;
  if (s.side > 0 ? !(ctx.ownDaily > 0 && ctx.btcDaily > 0) : !(ctx.ownDaily < 0 && ctx.btcDaily < 0)) return false;
  if ((s.volumeRatio ?? 1) < 2) return false;
  if ((ctx.btc1h ?? []).slice(-2).some((b) => s.side * (b.c - b.o) / b.o <= -0.007)) return false;
  if (ctx.fundingRate !== undefined && Number.isFinite(ctx.fundingRate) && Math.abs(ctx.fundingRate) > 0.0003) return false;
  if (ctx.now - ctx.lastBarTime > 8 * 3_600_000 || ctx.lastBarTime > ctx.now + 5 * 60_000) return false;
  const risk = s.side * (s.entry - s.stop) / s.entry;
  if (!(risk >= 0.015 && risk <= 0.06)) return false;
  if (ctx.livePrice !== undefined && Math.abs(ctx.livePrice - s.entry) / s.entry > 0.0025) return false;
  return true;
}

/**
 * SL trailing: giá đóng tốt nhất từ nến vào lệnh trừ 3×ATR14 (nến 4H đã đóng), chỉ được siết lại.
 */
export function trailingStop(
  bars: { t: number; h: number; l: number; c: number; closed?: boolean }[],
  side: 1 | -1,
  entryTime: number,
  currentStop: number,
  mult = TRAIL_ATR_MULT,
  barMs = 4 * 3_600_000,
): number {
  const closed = bars.filter((b) => b.closed !== false);
  if (closed.length < 15) return currentStop;
  let atr = closed[0].h - closed[0].l;
  for (let i = 1; i < closed.length; i++) {
    const p = closed[i - 1].c, b = closed[i];
    atr = (atr * 13 + Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p))) / 14;
  }
  const since = closed.filter((b) => b.t + barMs > entryTime);
  if (!since.length) return currentStop;
  const best = side > 0 ? Math.max(...since.map((b) => b.c)) : Math.min(...since.map((b) => b.c));
  const trail = best - side * mult * atr;
  return side > 0 ? Math.max(currentStop, trail) : Math.min(currentStop, trail);
}
