import fs from "fs";
import path from "path";
import { f } from "./format";
import { cooldownMap } from "./telegram-alerts";

export type PaperTrade = {
  id: string;
  coin: string;
  side: 1 | -1;
  entry: number;
  stop: number;
  tp: number;
  margin: number;
  leverage: number;
  openTime: number;
  closeTime?: number;
  exitPrice?: number;
  pnlUsdt?: number;
  roiPct?: number;
  status: "open" | "closed_tp" | "closed_sl" | "cancelled";
  note: string;
};

const PAPER_FILE = path.join(process.cwd(), "data", "paper-auto-bot.json");
const DEFAULT_MARGIN = 10.0; // Vốn giả lập 10$ mỗi lệnh đúng như cách Victor trade
const DEFAULT_LEVERAGE = 10; // Đòn bẩy giả lập x10

export function loadPaperTrades(): PaperTrade[] {
  try {
    if (fs.existsSync(PAPER_FILE)) {
      return JSON.parse(fs.readFileSync(PAPER_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[PAPER TRADER] Lỗi đọc file:", err);
  }
  return [];
}

function savePaperTrades(trades: PaperTrade[]) {
  try {
    fs.mkdirSync(path.dirname(PAPER_FILE), { recursive: true });
    fs.writeFileSync(PAPER_FILE, JSON.stringify(trades, null, 2), "utf-8");
  } catch (err) {
    console.error("[PAPER TRADER] Lỗi ghi file:", err);
  }
}

/**
 * Paper Bot tự động mở 1 lệnh mới trên dữ liệu thị trường thực tế.
 */
export function openPaperTrade(params: {
  coin: string;
  side: 1 | -1;
  entry: number;
  stop: number;
  tp: number;
  note: string;
}): { trade: PaperTrade | null; alertMsg: string | null } {
  const trades = loadPaperTrades();

  // Không mở trùng lệnh cùng coin nếu đang có vị thế mở
  const existing = trades.find((t) => t.coin === params.coin && t.status === "open");
  if (existing) {
    return { trade: null, alertMsg: null };
  }

  // Tối đa 2 lệnh paper cùng lúc để quản trị rủi ro
  const openCount = trades.filter((t) => t.status === "open").length;
  if (openCount >= 2) {
    return { trade: null, alertMsg: null };
  }

  const trade: PaperTrade = {
    id: `PAPER_${params.coin}_${Date.now()}`,
    coin: params.coin,
    side: params.side,
    entry: params.entry,
    stop: params.stop,
    tp: params.tp,
    margin: DEFAULT_MARGIN,
    leverage: DEFAULT_LEVERAGE,
    openTime: Date.now(),
    status: "open",
    note: params.note,
  };

  trades.push(trade);
  savePaperTrades(trades);

  const sideText = params.side > 0 ? "🟢 LONG" : "🔴 SHORT";
  const alertMsg =
    `🧪 *[PAPER BOT TỰ ĐẶT LỆNH]*\n\n` +
    `• Vị thế: *${sideText} ${params.coin}* (x${DEFAULT_LEVERAGE})\n` +
    `• Giá vào (Entry): *${f(params.entry)}*\n` +
    `• Chốt lời (TP): *${f(params.tp)}* (Mục tiêu +2R)\n` +
    `• Cắt lỗ (SL): *${f(params.stop)}*\n` +
    `• Ký quỹ giả lập: *$${DEFAULT_MARGIN.toFixed(2)} USDT*\n` +
    `📌 *Lý do:* ${params.note}\n` +
    `👉 *Chế độ:* Giả lập tự động 100% trên giá thật (Không đụng tiền thật)`;

  return { trade, alertMsg };
}

/**
 * Cập nhật kiểm tra nến mới đóng qua các vị thế Paper để khớp TP hoặc SL.
 */
export function stepPaperTrades(coin: string, candles: { h: number; l: number; c: number; closed?: boolean }[]): string[] {
  const trades = loadPaperTrades();
  const trade = trades.find((t) => t.coin === coin && t.status === "open");
  if (!trade) return [];

  const closedCandles = candles.filter((c) => c.closed !== false);
  const msgs: string[] = [];

  for (const bar of closedCandles.slice(-10)) {
    const isLong = trade.side > 0;

    // Kiểm tra chạm Chốt Lời (TP)
    const hitTp = isLong ? bar.h >= trade.tp : bar.l <= trade.tp;
    if (hitTp) {
      trade.status = "closed_tp";
      trade.closeTime = Date.now();
      trade.exitPrice = trade.tp;

      const priceDiff = isLong ? trade.tp - trade.entry : trade.entry - trade.tp;
      const rawRoi = (priceDiff / trade.entry) * trade.leverage;
      trade.roiPct = Number((rawRoi * 100).toFixed(1));
      trade.pnlUsdt = Number((trade.margin * rawRoi - 0.01).toFixed(2)); // trừ 0.01$ phí trượt

      savePaperTrades(trades);

      msgs.push(
        `✅ *[PAPER BOT CHỐT LỜI THÀNH CÔNG]*\n\n` +
        `• Vị thế: *${isLong ? "🟢 LONG" : "🔴 SHORT"} ${trade.coin}*\n` +
        `• Giá vào: ${f(trade.entry)} → Chốt tại TP: *${f(trade.tp)}*\n` +
        `• Lợi nhuận: 🟢 *+${trade.pnlUsdt.toFixed(2)}$ USDT (+${trade.roiPct}% ROI)*\n` +
        `🎉 Tự động đóng lệnh an toàn trên sổ Paper!`
      );
      break;
    }

    // Kiểm tra chạm Cắt Lỗ (SL)
    const hitSl = isLong ? bar.l <= trade.stop : bar.h >= trade.stop;
    if (hitSl) {
      trade.status = "closed_sl";
      trade.closeTime = Date.now();
      trade.exitPrice = trade.stop;

      const priceDiff = isLong ? trade.stop - trade.entry : trade.entry - trade.stop;
      const rawRoi = (priceDiff / trade.entry) * trade.leverage;
      trade.roiPct = Number((rawRoi * 100).toFixed(1));
      trade.pnlUsdt = Number((trade.margin * rawRoi - 0.01).toFixed(2));

      // Kích hoạt Cooldown 60 phút cho coin này
      cooldownMap.set(trade.coin, Date.now() + 60 * 60_000);

      savePaperTrades(trades);

      msgs.push(
        `❌ *[PAPER BOT CẮT LỖ BẢO VỆ]*\n\n` +
        `• Vị thế: *${isLong ? "🟢 LONG" : "🔴 SHORT"} ${trade.coin}*\n` +
        `• Giá vào: ${f(trade.entry)} → Cắt tại SL: *${f(trade.stop)}*\n` +
        `• Thua lỗ: 🔴 *${trade.pnlUsdt.toFixed(2)}$ USDT (${trade.roiPct}% ROI)*\n` +
        `🛡️ Đã tự động kích hoạt Cooldown cách ly 60 phút cho ${trade.coin}!`
      );
      break;
    }
  }

  return msgs;
}

/**
 * Thống kê toàn diện hiệu suất của Paper Auto-Trader.
 */
export function getPaperBotSummary(): string {
  const trades = loadPaperTrades();
  const closed = trades.filter((t) => t.status === "closed_tp" || t.status === "closed_sl");
  const open = trades.filter((t) => t.status === "open");

  if (!trades.length) {
    return (
      `🧪 *SỔ LỆNH PAPER AUTO-TRADER (TEST GIẤY):*\n\n` +
      `Chưa có lệnh nào được mở. Bot đang chạy ngầm 24/7 và sẽ tự động mở lệnh giấy khi có setup nổ Vol hoặc Phá nền 15m đạt chuẩn!`
    );
  }

  const wins = closed.filter((t) => t.status === "closed_tp").length;
  const losses = closed.filter((t) => t.status === "closed_sl").length;
  const totalClosed = closed.length;
  const winRate = totalClosed > 0 ? ((wins / totalClosed) * 100).toFixed(1) : "0.0";
  const netPnl = closed.reduce((sum, t) => sum + (t.pnlUsdt || 0), 0);
  const sign = netPnl >= 0 ? "+" : "";
  const icon = netPnl >= 0 ? "🟢" : "🔴";

  const openLines = open.length
    ? open
        .map((t) => {
          const s = t.side > 0 ? "LONG" : "SHORT";
          return `• ${s} *${t.coin}* @${f(t.entry)} (SL ${f(t.stop)} · TP ${f(t.tp)})`;
        })
        .join("\n")
    : "Không có vị thế nào đang mở.";

  const recentLines = closed
    .slice(-5)
    .reverse()
    .map((t) => {
      const s = t.side > 0 ? "LONG" : "SHORT";
      const oIcon = (t.pnlUsdt || 0) >= 0 ? "🟢" : "🔴";
      const oSign = (t.pnlUsdt || 0) >= 0 ? "+" : "";
      return `• ${oIcon} ${s} *${t.coin}*: ${oSign}${t.pnlUsdt?.toFixed(2)}$ (${t.roiPct}%)`;
    })
    .join("\n");

  return (
    `🧪 *SỔ LỆNH PAPER AUTO-TRADER (TEST GIẤY 100%):*\n\n` +
    `• Tổng PnL tích lũy: ${icon} *${sign}${netPnl.toFixed(2)}$ USDT*\n` +
    `• Thống kê: *${wins} Thắng / ${losses} Thua* (Win Rate: *${winRate}%*)\n` +
    `• Ký quỹ mỗi lệnh: *$${DEFAULT_MARGIN.toFixed(0)}* · Đòn bẩy: *x${DEFAULT_LEVERAGE}*\n\n` +
    `🔥 *Vị thế đang gồng (${open.length}):*\n${openLines}\n\n` +
    `📝 *Lịch sử 5 lệnh gần nhất:*\n${recentLines || "Chưa có lệnh đóng."}`
  );
}

