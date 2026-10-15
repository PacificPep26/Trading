// Sổ paper kèo 4H hai đỉnh/đáy (thay lệnh MEXC trước đây): vào ở giá mở nến 4H kế, không TP,
// SL trailing 3 ATR sau mỗi nến 4H đóng → nhắn chủ tài khoản dời SL tay; chạm SL → đóng, báo R. Trượt giá 0.04%.
import fs from "fs";
import path from "path";
import { trailingStop } from "./trading-policy.ts";
import { supertrend } from "./so-setups.ts";

export type Swing = {
  coin: string;
  side: 1 | -1;
  entry: number;
  initStop: number;
  stop: number;
  entryTime: number; // open time nến 4H vào lệnh
  checkedTo: number;
  status: "open" | "closed";
  exitPrice?: number;
  r?: number;
  trail?: "atr3" | "st"; // atr3 (mặc định): giá đóng tốt nhất − 3 ATR; st: dải Supertrend − 0.3 ATR
};

const H4 = 4 * 3_600_000;
const SLIP = 0.0004;
const FILE = path.join(process.cwd(), "data", "paper-4h.json");
type Bar = { t: number; o: number; h: number; l: number; c: number; closed?: boolean };

export function loadSwings(file = FILE): Swing[] {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error("[SWING4H] Không đọc được:", e);
  }
  return [];
}

function save(ss: Swing[], file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ss, null, 2), "utf-8");
}

/** Mở lệnh paper; false nếu coin đang có lệnh mở. */
export function openSwing(coin: string, s: { side: 1 | -1; entry: number; stop: number; entryTime: number; trail?: "atr3" | "st" }, file = FILE): boolean {
  const ss = loadSwings(file);
  if (ss.some((x) => x.coin === coin && x.status === "open")) return false;
  ss.push({ coin, side: s.side, entry: s.entry, initStop: s.stop, stop: s.stop, entryTime: s.entryTime, checkedTo: s.entryTime - H4, status: "open", trail: s.trail });
  save(ss, file);
  return true;
}

/** Chạy các nến 4H đã đóng (cả lịch sử ≥ 15 nến để tính ATR) qua lệnh đang mở của coin. Trả tin cần gửi. */
export function stepSwing(coin: string, bars: Bar[], file = FILE): string[] {
  const ss = loadSwings(file);
  const x = ss.find((s) => s.coin === coin && s.status === "open");
  if (!x) return [];
  const closed = bars.filter((b) => b.closed !== false);
  const msgs: string[] = [];
  const tag = `${x.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${coin}*`;
  for (let i = 0; i < closed.length; i++) {
    const b = closed[i];
    if (b.t <= x.checkedTo || b.t < x.entryTime) continue;
    x.checkedTo = b.t;
    if (x.side > 0 ? b.l <= x.stop : b.h >= x.stop) {
      const px = (x.side > 0 ? b.o < x.stop : b.o > x.stop) ? b.o : x.stop;
      const risk = Math.abs(x.entry - x.initStop) / x.entry;
      x.status = "closed";
      x.exitPrice = px;
      x.r = (x.side * (px / x.entry - 1) - SLIP) / risk;
      msgs.push(`🚪 ${tag} · 4H chạm SL ${px} → đóng · *${x.r >= 0 ? "+" : ""}${x.r.toFixed(2)}R*`);
      break;
    }
    const next = x.trail === "st" ? stTrail(closed.slice(0, i + 1), x.side, x.stop) : trailingStop(closed.slice(Math.max(0, i - 119), i + 1), x.side, x.entryTime, x.stop);
    if (next !== x.stop) {
      msgs.push(`📈 ${tag} · dời SL ${x.stop.toPrecision(5)} → *${next.toPrecision(5)}*`);
      x.stop = next;
    }
  }
  save(ss, file);
  return msgs;
}

/** SL theo dải Supertrend − 0.3 ATR14 (chỉ siết), như exit_trail_st trong video_hub_study.py. */
function stTrail(bars: Bar[], side: 1 | -1, stop: number): number {
  if (bars.length < 15) return stop;
  const { line } = supertrend(bars.map((b) => ({ ...b, v: 0, closed: true })));
  let atr = bars[0].h - bars[0].l;
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1].c, b = bars[i];
    atr = (atr * 13 + Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p))) / 14;
  }
  const trail = line[line.length - 1] - side * 0.3 * atr;
  return side > 0 ? Math.max(stop, trail) : Math.min(stop, trail);
}

export function swingStats(ss: Swing[]) {
  const done = ss.filter((s) => s.status === "closed");
  const sum = done.reduce((a, s) => a + s.r!, 0);
  return { n: done.length, wins: done.filter((s) => s.r! > 0).length, avgR: done.length ? sum / done.length : 0, sumR: sum, open: ss.length - done.length };
}
