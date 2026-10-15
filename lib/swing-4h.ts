// Sổ paper kèo 4H hai đỉnh/đáy (thay lệnh MEXC trước đây): vào ở giá mở nến 4H kế, không TP,
// SL trailing 3 ATR sau mỗi nến 4H đóng → nhắn chủ tài khoản dời SL tay; chạm SL → đóng, báo R. Trượt giá 0.04%.
import fs from "fs";
import path from "path";
import { trailingStop } from "./trading-policy.ts";

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
export function openSwing(coin: string, s: { side: 1 | -1; entry: number; stop: number; entryTime: number }, file = FILE): boolean {
  const ss = loadSwings(file);
  if (ss.some((x) => x.coin === coin && x.status === "open")) return false;
  ss.push({ coin, side: s.side, entry: s.entry, initStop: s.stop, stop: s.stop, entryTime: s.entryTime, checkedTo: s.entryTime - H4, status: "open" });
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
    const next = trailingStop(closed.slice(Math.max(0, i - 119), i + 1), x.side, x.entryTime, x.stop);
    if (next !== x.stop) {
      msgs.push(`📈 ${tag} · dời SL ${x.stop.toPrecision(5)} → *${next.toPrecision(5)}*`);
      x.stop = next;
    }
  }
  save(ss, file);
  return msgs;
}

export function swingStats(ss: Swing[]) {
  const done = ss.filter((s) => s.status === "closed");
  const sum = done.reduce((a, s) => a + s.r!, 0);
  return { n: done.length, wins: done.filter((s) => s.r! > 0).length, avgR: done.length ? sum / done.length : 0, sumR: sum, open: ss.length - done.length };
}
