import fs from "fs";
import path from "path";
import { f } from "./format.ts";
import { cooldownMap } from "./cooldown.ts";

export type PaperTrade = {
  id: string;
  coin: string;
  side: 1 | -1;
  entry: number;
  stop: number;
  tp: number;
  tp1?: number;
  tp2?: number;
  tp1Hit?: boolean;
  pnlTp1?: number;
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

/**
 * Kiểm tra xem thời điểm hiện tại có thuộc Khung Giờ Vàng (Prime Liquidity Session) hay không.
 * Cắt bỏ các giờ rác thanh khoản mỏng phiên Á (00:00 - 08:45) chống dính bẫy quét SL.
 */
export function isSessionPrime(timestampMs: number = Date.now()): boolean {
  const vnHour = (Math.floor(timestampMs / 3600_000) + 7) % 24;
  const vnMin = Math.floor(timestampMs / 60_000) % 60;
  const tVal = vnHour + vnMin / 60.0;
  if (tVal >= 19.5 && tVal <= 23.75) return true; // Phiên Mỹ (19:30 - 23:45)
  if (tVal >= 14.0 && tVal <= 18.0) return true;  // Phiên Âu (14:00 - 18:00)
  if (tVal >= 9.0 && tVal <= 11.5) return true;   // Phiên Á sáng (09:00 - 11:30)
  return false;
}

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
  tp1?: number;
  tp2?: number;
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
    tp1: params.tp1,
    tp2: params.tp2,
    tp1Hit: false,
    pnlTp1: 0,
    margin: DEFAULT_MARGIN,
    leverage: DEFAULT_LEVERAGE,
    openTime: Date.now(),
    status: "open",
    note: params.note,
  };

  trades.push(trade);
  savePaperTrades(trades);

  const sideText = params.side > 0 ? "🟢 LONG" : "🔴 SHORT";
  const tpText = params.tp1 && params.tp2
    ? `TP1 (50%): *${f(params.tp1)}* | TP2 Runner (50%): *${f(params.tp2)}*`
    : `TP: *${f(params.tp)}*`;

  const alertMsg =
    `🧪 *[PAPER BOT TỰ ĐẶT LỆNH]*\n\n` +
    `• Vị thế: *${sideText} ${params.coin}* (x${DEFAULT_LEVERAGE})\n` +
    `• Giá vào (Entry): *${f(params.entry)}*\n` +
    `• ${tpText}\n` +
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

    // A. NẾU CÓ CHẾ ĐỘ MULTI-TP (TP1 50% + TP2 RUNNER 50%)
    if (trade.tp1 && trade.tp2) {
      if (!trade.tp1Hit) {
        const hitTp1 = isLong ? bar.h >= trade.tp1 : bar.l <= trade.tp1;
        if (hitTp1) {
          trade.tp1Hit = true;
          const priceDiff = isLong ? trade.tp1 - trade.entry : trade.entry - trade.tp1;
          const rawRoi = (priceDiff / trade.entry) * trade.leverage;
          trade.pnlTp1 = Number(((trade.margin * 0.5) * rawRoi - 0.008).toFixed(2));
          // Dời SL Runner về vùng đệm an toàn 0.5% (tránh bị râu retest quét sớm)
          const buffer = 0.005 * trade.entry;
          trade.stop = isLong ? trade.entry - buffer : trade.entry + buffer;
          savePaperTrades(trades);

          msgs.push(
            `💰 *[PAPER BOT CHỐT LỜI TP1 (50%)]*\n\n` +
            `• Vị thế: *${isLong ? "🟢 LONG" : "🔴 SHORT"} ${trade.coin}*\n` +
            `• Chốt 50% tại TP1: *${f(trade.tp1)}* -> Đút túi: *+${trade.pnlTp1.toFixed(2)}$ USDT*\n` +
            `🛡️ *Bảo vệ:* Đã dời SL 50% Runner còn lại về vùng đệm an toàn (*${f(trade.stop)}*)!`
          );
        }
      }

      const hitTp2 = isLong ? bar.h >= trade.tp2 : bar.l <= trade.tp2;
      const hitSl = isLong ? bar.l <= trade.stop : bar.h >= trade.stop;

      if (hitTp2) {
        trade.status = "closed_tp";
        trade.closeTime = Date.now();
        trade.exitPrice = trade.tp2;
        const priceDiff = isLong ? trade.tp2 - trade.entry : trade.entry - trade.tp2;
        const rawRoi = (priceDiff / trade.entry) * trade.leverage;
        const runnerMargin = trade.tp1Hit ? trade.margin * 0.5 : trade.margin;
        const pnlRunner = runnerMargin * rawRoi - (trade.tp1Hit ? 0.008 : 0.016);
        trade.pnlUsdt = Number(((trade.pnlTp1 || 0) + pnlRunner).toFixed(2));
        trade.roiPct = Number((rawRoi * 100).toFixed(1));
        savePaperTrades(trades);

        msgs.push(
          `🏆 *[PAPER BOT ĂN TRỌN SÓNG TP2 RUNNER]*\n\n` +
          `• Vị thế: *${isLong ? "🟢 LONG" : "🔴 SHORT"} ${trade.coin}*\n` +
          `• 50% Runner chạm đỉnh TP2: *${f(trade.tp2)}*\n` +
          `• Tổng lợi nhuận trọn gói: 🟢 *+${trade.pnlUsdt.toFixed(2)}$ USDT (+${trade.roiPct}% ROI)*\n` +
          `🎉 Đóng lệnh hoàn tất với tỷ lệ R:R đỉnh cao!`
        );
        break;
      } else if (hitSl) {
        trade.closeTime = Date.now();
        trade.exitPrice = trade.stop;
        if (trade.tp1Hit) {
          trade.status = "closed_tp";
          trade.pnlUsdt = Number(((trade.pnlTp1 || 0) - 0.008).toFixed(2));
          trade.roiPct = 0;
          savePaperTrades(trades);

          msgs.push(
            `🛡️ *[PAPER BOT RUNNER CHẠM ENTRY]*\n\n` +
            `• Vị thế: *${isLong ? "🟢 LONG" : "🔴 SHORT"} ${trade.coin}*\n` +
            `• 50% Runner thoát tại Entry: *${f(trade.stop)}*\n` +
            `• Tổng kết lệnh: 🟢 *Vẫn LÃI RÒNG +${trade.pnlUsdt.toFixed(2)}$ USDT*!`
          );
        } else {
          trade.status = "closed_sl";
          const priceDiff = isLong ? trade.stop - trade.entry : trade.entry - trade.stop;
          const rawRoi = (priceDiff / trade.entry) * trade.leverage;
          trade.roiPct = Number((rawRoi * 100).toFixed(1));
          trade.pnlUsdt = Number((trade.margin * rawRoi - 0.016).toFixed(2));
          cooldownMap.set(trade.coin, Date.now() + 60 * 60_000);
          savePaperTrades(trades);

          msgs.push(
            `❌ *[PAPER BOT CẮT LỖ BẢO VỆ]*\n\n` +
            `• Vị thế: *${isLong ? "🟢 LONG" : "🔴 SHORT"} ${trade.coin}*\n` +
            `• Cắt tại SL: *${f(trade.stop)}* | Lỗ: 🔴 *${trade.pnlUsdt.toFixed(2)}$ USDT*\n` +
            `🛡️ Đã tự động kích hoạt Cooldown cách ly 60 phút cho ${trade.coin}!`
          );
        }
        break;
      }
    } else {
      // B. CHẾ ĐỘ TP CỐ ĐỊNH (BACKWARD COMPATIBLE)
      const hitTp = isLong ? bar.h >= trade.tp : bar.l <= trade.tp;
      if (hitTp) {
        trade.status = "closed_tp";
        trade.closeTime = Date.now();
        trade.exitPrice = trade.tp;

        const priceDiff = isLong ? trade.tp - trade.entry : trade.entry - trade.tp;
        const rawRoi = (priceDiff / trade.entry) * trade.leverage;
        trade.roiPct = Number((rawRoi * 100).toFixed(1));
        trade.pnlUsdt = Number((trade.margin * rawRoi - 0.016).toFixed(2));

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

      const hitSl = isLong ? bar.l <= trade.stop : bar.h >= trade.stop;
      if (hitSl) {
        trade.status = "closed_sl";
        trade.closeTime = Date.now();
        trade.exitPrice = trade.stop;

        const priceDiff = isLong ? trade.stop - trade.entry : trade.entry - trade.stop;
        const rawRoi = (priceDiff / trade.entry) * trade.leverage;
        trade.roiPct = Number((rawRoi * 100).toFixed(1));
        trade.pnlUsdt = Number((trade.margin * rawRoi - 0.016).toFixed(2));

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

