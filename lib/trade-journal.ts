// Nhật ký lệnh thật MEXC: so kết quả thật với backtest sau ~30 lệnh.
// data/ là Railway volume → sống qua redeploy.
import fs from "fs";
import path from "path";

export type JournalTrade = {
  symbol: string; // MEXC, vd SOL_USDT
  style: string;
  side: 1 | -1;
  entry: number;
  stop: number;
  riskUsd: number; // số $ mất nếu chạm SL ban đầu
  entryTime: number;
  exitTime?: number;
  exitPrice?: number;
  pnlUsd?: number; // lãi/lỗ ròng sau phí (MEXC)
  trailMoves?: number;
};

const FILE = path.join(process.cwd(), "data", "trade-journal.json");

export function loadJournal(file = FILE): JournalTrade[] {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error("[JOURNAL] Không đọc được nhật ký:", e);
  }
  return [];
}

function save(trades: JournalTrade[], file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(trades, null, 2), "utf-8");
}

export function recordOpen(t: JournalTrade, file = FILE) {
  const trades = loadJournal(file);
  trades.push(t);
  save(trades, file);
}

export function openTrade(symbol: string, file = FILE): JournalTrade | undefined {
  return loadJournal(file).find((t) => t.symbol === symbol && t.exitTime === undefined);
}

export function recordTrail(symbol: string, file = FILE) {
  const trades = loadJournal(file);
  const t = trades.find((x) => x.symbol === symbol && x.exitTime === undefined);
  if (!t) return;
  t.trailMoves = (t.trailMoves ?? 0) + 1;
  save(trades, file);
}

export function recordClose(symbol: string, exit: { exitTime: number; exitPrice: number; pnlUsd: number }, file = FILE): JournalTrade | undefined {
  const trades = loadJournal(file);
  const t = trades.find((x) => x.symbol === symbol && x.exitTime === undefined);
  if (!t) return undefined;
  Object.assign(t, exit);
  save(trades, file);
  return t;
}

export function journalStats(trades: JournalTrade[]) {
  const closed = trades.filter((t) => t.exitTime !== undefined && t.pnlUsd !== undefined);
  const rs = closed.map((t) => (t.riskUsd > 0 ? t.pnlUsd! / t.riskUsd : 0));
  const n = closed.length;
  return {
    n,
    open: trades.length - n,
    wins: closed.filter((t) => t.pnlUsd! > 0).length,
    pnlUsd: closed.reduce((s, t) => s + t.pnlUsd!, 0),
    avgR: n ? rs.reduce((s, r) => s + r, 0) / n : 0,
    bestR: n ? Math.max(...rs) : 0,
    worstR: n ? Math.min(...rs) : 0,
  };
}
