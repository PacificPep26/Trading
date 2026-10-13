// Paper tự động khung 1H (tiền giả): vào theo tín hiệu quay đầu 1H thuận trend, SL ngoài râu, không TP,
// trailing 3×ATR theo nến 1H đóng. Đo 2–4 tuần trước khi tính chuyện tiền thật (backtest 1H ≈ −0.1R/lệnh).
// data/ là Railway volume → sống qua redeploy.
import fs from "fs";
import path from "path";
import { trailingStop } from "./trading-policy.ts";

export type Paper1h = {
  coin: string;
  side: 1 | -1;
  entry: number;
  initStop: number;
  stop: number;
  entryTime: number; // giờ đóng nến xác nhận
  checkedTo: number; // open time của nến 1H cuối đã xử lý
  exitTime?: number;
  exitPrice?: number;
  r?: number; // lãi/lỗ ròng theo R (đã trừ phí + trượt)
};

const H1 = 3_600_000;
const COST = 0.002; // taker 0.08%/chiều + trượt 0.02%/chiều, như backtest
const FILE = path.join(process.cwd(), "data", "paper-1h.json");
type Bar = { t: number; o: number; h: number; l: number; c: number; closed?: boolean };

export function loadPaper1h(file = FILE): Paper1h[] {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error("[PAPER1H] Không đọc được:", e);
  }
  return [];
}

function save(ps: Paper1h[], file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ps, null, 2), "utf-8");
}

/** Chạy các nến 1H mới đóng qua lệnh paper đang mở của coin: chạm SL thì đóng, chưa thì kéo SL. Trả tin đóng lệnh. */
export function managePaper1h(coin: string, bars: Bar[], file = FILE): string[] {
  const ps = loadPaper1h(file);
  const p = ps.find((x) => x.coin === coin && x.exitTime === undefined);
  if (!p) return [];
  const closed = bars.filter((b) => b.closed !== false);
  const msgs: string[] = [];
  for (let i = 0; i < closed.length; i++) {
    const b = closed[i];
    if (b.t <= p.checkedTo) continue;
    if (p.side > 0 ? b.l <= p.stop : b.h >= p.stop) {
      const px = (p.side > 0 ? b.o < p.stop : b.o > p.stop) ? b.o : p.stop; // gap qua SL khớp giá mở
      const risk = Math.abs(p.entry - p.initStop) / p.entry;
      p.exitTime = b.t;
      p.exitPrice = px;
      p.r = (p.side * (px / p.entry - 1) - COST) / risk;
      msgs.push(`🧪 *[PAPER 1H ĐÓNG]* ${p.side > 0 ? "LONG" : "SHORT"} *${coin}* vào ${p.entry} → thoát ${px} · *${p.r >= 0 ? "+" : ""}${p.r.toFixed(2)}R*`);
      p.checkedTo = b.t;
      break;
    }
    p.stop = trailingStop(closed.slice(0, i + 1), p.side, p.entryTime, p.stop, 3, H1);
    p.checkedTo = b.t;
  }
  save(ps, file);
  return msgs;
}

/** Mở lệnh paper nếu coin chưa có lệnh paper đang mở. */
export function openPaper1h(coin: string, sig: { side: 1 | -1; entry: number; stop: number; barTime: number }, file = FILE): boolean {
  const ps = loadPaper1h(file);
  if (ps.some((x) => x.coin === coin && x.exitTime === undefined)) return false;
  ps.push({ coin, side: sig.side, entry: sig.entry, initStop: sig.stop, stop: sig.stop, entryTime: sig.barTime + H1, checkedTo: sig.barTime });
  save(ps, file);
  return true;
}

export function paper1hStats(ps: Paper1h[]) {
  const closed = ps.filter((p) => p.r !== undefined);
  const n = closed.length;
  const sum = closed.reduce((s, p) => s + p.r!, 0);
  return { n, open: ps.length - n, wins: closed.filter((p) => p.r! > 0).length, avgR: n ? sum / n : 0, sumR: sum };
}
