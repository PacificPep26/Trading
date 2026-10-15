// 4 kèo SO Trading (lời thoại video, docs/research/tiktok-sotrading01-full-transcripts.md), 1H, cả 2 chiều.
// Chép đúng service/scripts/sotrading_study.py. Chủ dự án chọn báo cả 4 kèm số backtest (2026-10-15) dù chỉ "hồi đỉnh cũ" đạt chuẩn.
import type { Candle } from "./okx.ts";
import { swings, trendOf } from "./patterns.ts";

export type SoKind = "pullback" | "hns" | "breakout" | "wicks";
export type SoSetup = { kind: SoKind; side: 1 | -1; entry: number; stop: number; tp: number; tp1?: number; limit: boolean; barTime: number };

// Code live chạy lại 1H 2025 / 2026 (live_replay_study mục D, 2.5$/lệnh, phí 0) — ghi trong tin để chủ dự án tự cân nhắc
export const SO_LABEL: Record<SoKind, { name: string; stats: string }> = {
  pullback: { name: "🔁 Hồi đỉnh cũ", stats: "BT +212$/+195$ ✅" },
  hns: { name: "👤 Vai–đầu–vai", stats: "BT +78$/−24$" },
  breakout: { name: "🚀 Phá vỡ sau nén", stats: "BT −9$/−13$, hiếm" },
  wicks: { name: "🕯 Chòm râu", stats: "BT +11$/−6$" },
};

function atrSeries(cs: Candle[]) {
  const out: number[] = [];
  cs.forEach((c, i) => {
    const p = cs[i - 1] ?? c;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    out.push(i === 0 ? tr : (out[i - 1] * 13 + tr) / 14);
  });
  return out;
}

/** Kèo kích hoạt ở nến 1H vừa đóng (nến cuối). entry = giá đóng (vào lệnh Market ngay), trừ vai–đầu–vai nến phá dài (Limit ở cổ). */
export function soSetups(all: Candle[]): SoSetup[] {
  const cs = all.filter((c) => c.closed !== false);
  const i = cs.length - 1;
  if (i < 80) return [];
  const a = atrSeries(cs)[i], c = cs[i], p = cs[i - 1];
  const { highs, lows } = swings(cs); // mọi swing ở đây đã xác nhận tại nến cuối (= confirmed(...) của Python)
  const out: SoSetup[] = [];
  const add = (kind: SoKind, side: 1 | -1, entry: number, stop: number, tp: number, limit = false, tp1?: number) => {
    const risk = (side * (entry - stop)) / entry;
    if (risk >= 0.003 && risk <= 0.06 && side * (tp - entry) > 0) out.push({ kind, side, entry, stop, tp, tp1, limit, barTime: c.t });
  };

  for (const side of [1, -1] as const) {
    const top = (k: number) => (side > 0 ? cs[k].h : cs[k].l); // cực trị về phía lệnh
    const bot = (k: number) => (side > 0 ? cs[k].l : cs[k].h); // cực trị ngược phía lệnh
    const hs = (side > 0 ? highs : lows).slice(-8);
    const ls = (side > 0 ? lows : highs).slice(-8);

    // 🚀 Phá vỡ: ≥ 2 đỉnh phẳng trong 60 nến, 2 đáy sau đó cao dần và sát vùng ≤ 2 ATR, nến đóng vượt vùng; bỏ nếu cản bên trái chắn TP
    const tops = hs.filter((k) => k >= i - 60);
    if (tops.length >= 2) {
      const zone = side > 0 ? Math.max(...tops.map(top)) : Math.min(...tops.map(top));
      const flat = tops.slice(-2).every((k) => Math.abs(top(k) - zone) <= 0.3 * a);
      const lw = ls.filter((k) => k > tops[tops.length - 2]);
      const squeeze = lw.length >= 2 && side * (bot(lw.at(-1)!) - bot(lw.at(-2)!)) > 0 && side * (zone - bot(lw.at(-1)!)) <= 2 * a;
      const broke = side > 0 ? c.c > zone && zone >= p.c : c.c < zone && zone <= p.c;
      if (flat && squeeze && broke) {
        const stop = bot(lw.at(-1)!) - side * 0.1 * a, tp = c.c + 2 * (c.c - stop);
        const older = (side > 0 ? highs : lows).slice(-40).filter((k) => k < i - 60).map(top);
        if (!older.some((lvl) => side * (lvl - c.c) > 0 && side * (tp - lvl) > 0)) add("breakout", side, c.c, stop, tp);
      }
    }

    // 🔁 Hồi về đỉnh cũ vừa bị phá: cấu trúc thuận chiều, ≥ 2 nến thử vùng mà đóng giữ được, nến mạnh vượt các nến thử. TP1 2R, TP2 3R
    if (trendOf(cs, highs, lows) === side && hs.length >= 2 && side * (top(hs.at(-1)!) - top(hs.at(-2)!)) > 0) {
      const S = top(hs.at(-2)!);
      const tests = cs.slice(i - 8, i).filter((b) => (side > 0 ? b.l <= S + 0.2 * a && b.c > S : b.h >= S - 0.2 * a && b.c < S));
      const rng = c.h - c.l;
      const strong = rng > 0 && side * (c.c - c.o) >= 0.6 * rng;
      const clear = tests.length > 0 && (side > 0 ? c.c > Math.max(...tests.map((b) => b.h)) : c.c < Math.min(...tests.map((b) => b.l)));
      if (tests.length >= 2 && strong && clear) {
        const stop = side > 0 ? Math.min(...tests.map((b) => b.l)) - 0.1 * a : Math.max(...tests.map((b) => b.h)) + 0.1 * a;
        add("pullback", side, c.c, stop, c.c + 3 * (c.c - stop), false, c.c + 2 * (c.c - stop));
      }
    }

    // 👤 Vai–đầu–vai (đỉnh → SHORT dùng swing đỉnh; ngược → LONG dùng swing đáy): đầu vượt 2 vai ≥ 0.5 ATR, cổ ngang ≤ 0.3 ATR, vai phải không cao hơn vai trái
    const sh = (side < 0 ? highs : lows).slice(-3);
    const pk = (k: number) => (side < 0 ? cs[k].h : cs[k].l);
    if (sh.length === 3 && sh[0] >= i - 80) {
      const [l, h, r] = sh;
      const headOk = side < 0 ? pk(h) - Math.max(pk(l), pk(r)) >= 0.5 * a : Math.min(pk(l), pk(r)) - pk(h) >= 0.5 * a;
      const t1 = cs.slice(l, h + 1), t2 = cs.slice(h, r + 1);
      const n1 = side < 0 ? Math.min(...t1.map((b) => b.l)) : Math.max(...t1.map((b) => b.h));
      const n2 = side < 0 ? Math.min(...t2.map((b) => b.l)) : Math.max(...t2.map((b) => b.h));
      const rightLow = side < 0 ? pk(r) <= pk(l) : pk(r) >= pk(l);
      if (headOk && Math.abs(n1 - n2) <= 0.3 * a && rightLow) {
        const neck = side < 0 ? Math.min(n1, n2) : Math.max(n1, n2);
        if (side < 0 ? c.c < neck && neck <= p.c : c.c > neck && neck >= p.c) {
          const stop = pk(r) - side * 0.1 * a, tp = neck + side * Math.abs(pk(h) - neck);
          const long = Math.abs(c.c - c.o) > 1.5 * a; // nến phá quá dài: chờ hồi về cổ
          const e = long ? neck : c.c;
          if (side * (tp - e) >= 1.5 * side * (e - stop)) add("hns", side, e, stop, tp, long);
        }
      }
    }

    // 🕯 Chòm râu: 3 nến liền râu từ chối ≥ 50% thân nến, cực trị cách nhau ≤ 0.3 ATR, ở đáy/đỉnh 24 nến trước. TP 2R
    const trio = cs.slice(i - 2, i + 1);
    const wick = (b: Candle) => (side > 0 ? Math.min(b.o, b.c) - b.l : b.h - Math.max(b.o, b.c));
    const ext = trio.map((b) => (side > 0 ? b.l : b.h));
    const prior = cs.slice(i - 26, i - 2);
    const atEdge = side > 0 ? Math.min(...ext) <= Math.min(...prior.map((b) => b.l)) + 0.3 * a : Math.max(...ext) >= Math.max(...prior.map((b) => b.h)) - 0.3 * a;
    if (trio.every((b) => b.h > b.l && wick(b) >= 0.5 * (b.h - b.l)) && Math.max(...ext) - Math.min(...ext) <= 0.3 * a && atEdge) {
      const stop = side > 0 ? Math.min(...ext) - 0.1 * a : Math.max(...ext) + 0.1 * a;
      add("wicks", side, c.c, stop, c.c + 2 * (c.c - stop));
    }
  }
  return out;
}

/**
 * 🔨 Nến "high test" (Jason Graystone, video_hub_study mục 4), khung 4H, cả 2 chiều — đạt chuẩn:
 * 2025 +251$ / 2026 +138$ (+0.115R), vào ngẫu nhiên +161$ / −62$. Cấu trúc thuận chiều, nến vừa đóng chạm swing vừa bị phá
 * (≤ 0.2 ATR), râu từ chối ≥ 2 thân và ≥ 60% nến → lệnh chờ PHÁ râu (buy stop trên đỉnh nến / sell stop dưới đáy) 3 nến,
 * SL ngoài nến + 0.1 ATR, TP 2R tính từ giá chờ.
 */
export function highTestSetup(all: Candle[]): { side: 1 | -1; trigger: number; stop: number; tp: number; barTime: number }[] {
  const cs = all.filter((c) => c.closed !== false);
  const i = cs.length - 1;
  if (i < 60) return [];
  const a = atrSeries(cs)[i], c = cs[i];
  const { highs, lows } = swings(cs);
  const tr = trendOf(cs, highs, lows);
  const out: { side: 1 | -1; trigger: number; stop: number; tp: number; barTime: number }[] = [];
  for (const side of [1, -1] as const) {
    if (tr !== side) continue;
    const hs = (side > 0 ? highs : lows).slice(-3);
    const top = (k: number) => (side > 0 ? cs[k].h : cs[k].l);
    if (hs.length < 2 || side * (top(hs.at(-1)!) - top(hs.at(-2)!)) <= 0) continue;
    const S = top(hs.at(-2)!);
    if (!(side > 0 ? c.l <= S + 0.2 * a : c.h >= S - 0.2 * a)) continue;
    const rng = c.h - c.l, body = Math.abs(c.c - c.o);
    const wick = side > 0 ? Math.min(c.o, c.c) - c.l : c.h - Math.max(c.o, c.c);
    if (!(rng > 0 && wick >= 2 * body && wick >= 0.6 * rng)) continue;
    const trigger = side > 0 ? c.h : c.l, stop = side > 0 ? c.l - 0.1 * a : c.h + 0.1 * a;
    const risk = (side * (trigger - stop)) / trigger;
    if (risk >= 0.003 && risk <= 0.06) out.push({ side, trigger, stop, tp: trigger + 2 * (trigger - stop), barTime: c.t });
  }
  return out;
}

/** Supertrend (TradingView: dải cuối, ATR kiểu RMA). Giống supertrend() trong service/scripts/video_hub_study.py. */
export function supertrend(cs: Candle[], period = 10, mult = 3): { line: number[]; dir: (1 | -1)[] } {
  const line: number[] = [], dir: (1 | -1)[] = [];
  let atr = 0, upPrev = NaN, dnPrev = NaN;
  cs.forEach((c, i) => {
    const tr = i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c));
    atr = i === 0 ? tr : (atr * (period - 1) + tr) / period;
    const mid = (c.h + c.l) / 2;
    let up = mid - mult * atr, dn = mid + mult * atr;
    let d: 1 | -1 = i === 0 ? 1 : dir[i - 1];
    if (i > 0) {
      if (cs[i - 1].c > upPrev) up = Math.max(up, upPrev);
      if (cs[i - 1].c < dnPrev) dn = Math.min(dn, dnPrev);
      if (d === 1 && c.c < upPrev) d = -1;
      else if (d === -1 && c.c > dnPrev) d = 1;
    }
    dir.push(d);
    line.push(d === 1 ? up : dn);
    upPrev = up; dnPrev = dn;
  });
  return { line, dir };
}

/**
 * 📈 Supertrend 4H đổi màu (Wysetrade; video bảo "đừng vào ngay khi đổi màu" nhưng số liệu cho thấy ngược lại):
 * 2025 +158$ / 2026 +53$ (+0.14R), vào ngẫu nhiên cùng cách thoát −201$ / +38$. Nến 4H vừa đóng làm dải đổi màu → vào,
 * SL = dải − 0.3 ATR14, KHÔNG TP, dời SL theo dải mỗi nến 4H (lib/swing-4h.ts trail "st"). Bản 1H không hơn ngẫu nhiên.
 */
export function stFlipSetup(all: Candle[]): { side: 1 | -1; entry: number; stop: number; barTime: number } | null {
  const cs = all.filter((c) => c.closed !== false);
  const i = cs.length - 1;
  if (i < 60) return null;
  const { line, dir } = supertrend(cs);
  if (dir[i] === dir[i - 1]) return null;
  const side = dir[i], c = cs[i];
  const stop = line[i] - side * 0.3 * atrSeries(cs)[i];
  const risk = (side * (c.c - stop)) / c.c;
  return risk >= 0.003 && risk <= 0.08 ? { side, entry: c.c, stop, barTime: c.t } : null;
}
