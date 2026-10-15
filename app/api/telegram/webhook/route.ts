import { NextRequest, NextResponse } from "next/server";
import { loadLimits, limitStats } from "@/lib/resting-limit";
import { loadSwings, swingStats } from "@/lib/swing-4h";
import { loadWatches, saveWatches, parseWatch } from "@/lib/price-watch";
import { COINS, ICT_PAPER, HIGHTEST_PAPER, HIGHTEST_15M_PAPER, ST_PAPER, IDM_PAPER, f, soPaper, dailyTrend } from "@/lib/telegram-alerts";
import { ticker } from "@/lib/okx";
import { getMexcOpenPositions } from "@/lib/mexc";

const HELP =
  "🤖 *Bot báo 6 kèo đã kiểm chứng* (bạn tự vào lệnh tay trên MEXC, phí 0):\n" +
  "• 🔨 Nến high test 15m TP swing → lệnh chờ phá 45m (Jason Graystone, lãi +1.796$)\n" +
  "• 🎯 ICT quét đỉnh hôm qua → SHORT 1H (lãi +204$)\n" +
  "• 🧲 Mồi nhử + FVG, Limit vùng A 1H (TradingLab, lãi +229$)\n" +
  "• 🔁 Hồi đỉnh cũ 1H → vào khi nến xác nhận đóng (SO Trading, lãi +407$)\n" +
  "• 🔨 Nến high test 4H → lệnh chờ phá 12h (Jason Graystone, lãi +435$)\n" +
  "• 📈 Supertrend 4H đổi màu → vào ngay, SL dời theo dải (Wysetrade, lãi +224$)\n\n" +
  "Quy ước tin:\n" +
  "• `TP1` = chốt 50% rồi dời SL về hoà vốn; `TP2` = đích sóng\n" +
  "• `x` = đòn bẩy gợi ý (≤ 10)\n\n" +
  "Lệnh nhanh: bấm phím bên dưới, gõ `tên coin` (vd `BTC`, `SOL`) hoặc `theo dõi SUI 1.041 1.029 1.085 btc 82750`.";

async function reply(token: string, chatId: number | string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true,
        reply_markup: {
          keyboard: [
            [{ text: "💼 Vị thế thật" }, { text: "📊 Thống kê" }, { text: "👁 Đang theo dõi" }],
            [{ text: "❓ Hướng dẫn" }, { text: "BTC" }, { text: "ETH" }, { text: "SOL" }, { text: "NEAR" }]
          ],
          resize_keyboard: true,
          is_persistent: true,
        },
      }),
    });
  } catch (e) {
    console.error("reply error", e);
  }
}

function stats(): string {
  const line = (name: string, s: { n: number; wins: number; avgR: number; sumR: number }, open: string) =>
    `${name}: ${s.n} lệnh đóng · thắng ${s.n ? Math.round((s.wins / s.n) * 100) : 0}% · TB ${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R · tổng ${(s.sumR * 2.5).toFixed(0)}$ (2.5$/lệnh) · ${open}`;
  const ht15 = limitStats(loadLimits(HIGHTEST_15M_PAPER));
  const ict = limitStats(loadLimits(ICT_PAPER));
  const idm = limitStats(loadLimits(IDM_PAPER));
  const pb = limitStats(loadLimits(soPaper("pullback")));
  const ht4h = limitStats(loadLimits(HIGHTEST_PAPER));
  const st = swingStats(loadSwings(ST_PAPER));

  return "📊 *Sổ paper 6 kèo đạt chuẩn* (2025–26)\n" +
    line("🔨 High test 15m", ht15, `${ht15.pending} chờ, ${ht15.open} mở`) + "\n   backtest: +1.796$ (+0.05R/lệnh)\n" +
    line("🎯 ICT 1H", ict, `${ict.pending} chờ, ${ict.open} mở`) + "\n   backtest: +204$ (+0.42R/lệnh)\n" +
    line("🧲 Mồi nhử + FVG 1H", idm, `${idm.pending} chờ, ${idm.open} mở`) + "\n   backtest: +229$ (+0.09R/lệnh)\n" +
    line("🔁 Hồi đỉnh cũ 1H", pb, `${pb.open} mở`) + "\n   backtest: +407$ (+0.06R/lệnh)\n" +
    line("🔨 High test 4H", ht4h, `${ht4h.pending} chờ, ${ht4h.open} mở`) + "\n   backtest: +435$ (+0.13R/lệnh)\n" +
    line("📈 Supertrend 4H", st, `${st.open} mở`) + "\n   backtest: +224$ (+0.16R/lệnh)";
}

async function mexcStatus(): Promise<string> {
  const positions = await getMexcOpenPositions();
  if (!positions.length) {
    return "💼 *Vị thế thật trên MEXC:*\nHiện không có vị thế nào đang mở (hoặc chưa cấu hình API).";
  }
  return (
    "💼 *Vị thế thật trên MEXC của Victor:*\n\n" +
    positions
      .map((p) => {
        const pnlSign = p.unRealizedPnl >= 0 ? "+" : "";
        const pnlIcon = p.unRealizedPnl >= 0 ? "🟢" : "🔴";
        const sideText = p.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        return (
          `• ${sideText} *${p.coin}* · x${p.leverage}\n` +
          `   Vào: ${f(p.entry)} · Thanh lý: ${f(p.liquidatePrice)}\n` +
          `   PNL: ${pnlIcon} *${pnlSign}${p.unRealizedPnl.toFixed(2)}$* (ký quỹ ~${p.margin.toFixed(1)}$)`
        );
      })
      .join("\n\n")
  );
}

async function coinStatus(coin: string): Promise<string> {
  const p = (await ticker(`${coin}-USDT-SWAP`).catch(() => null))?.last;
  const trend = await dailyTrend(coin);
  const lines = [`*${coin}* ${p ? f(p) : ""} · xu hướng ngày ${trend > 0 ? "TĂNG ↗" : trend < 0 ? "GIẢM ↘" : "?"}`];

  // Kiểm tra vị thế thật MEXC
  const mexcPos = (await getMexcOpenPositions().catch(() => [])).find((x) => x.coin === coin);
  if (mexcPos) {
    const pnlSign = mexcPos.unRealizedPnl >= 0 ? "+" : "";
    const pnlIcon = mexcPos.unRealizedPnl >= 0 ? "🟢" : "🔴";
    lines.push(
      `💼 *Vị thế thật MEXC:* ${mexcPos.side > 0 ? "🟢 LONG" : "🔴 SHORT"} x${mexcPos.leverage} @${f(mexcPos.entry)} · PNL ${pnlIcon} *${pnlSign}${mexcPos.unRealizedPnl.toFixed(2)}$*`
    );
  }

  const checkLimit = (name: string, file: string) => {
    const item = loadLimits(file).find((x) => x.coin === coin && (x.status === "pending" || x.status === "open"));
    if (item) {
      lines.push(`${name} ${item.status === "open" ? "đang mở" : "chờ khớp"} · vào ${f(item.entry ?? item.limit)} · TP ${f(item.tp)} · SL ${f(item.stop)}`);
    }
  };

  checkLimit("🔨 High test 15m", HIGHTEST_15M_PAPER);
  checkLimit("🎯 ICT 1H", ICT_PAPER);
  checkLimit("🧲 Mồi nhử 1H", IDM_PAPER);
  checkLimit("🔁 Hồi đỉnh cũ 1H", soPaper("pullback"));
  checkLimit("🔨 High test 4H", HIGHTEST_PAPER);

  const st = loadSwings(ST_PAPER).find((x) => x.coin === coin && x.status === "open");
  if (st) lines.push(`📈 Supertrend 4H đang mở · vào ${f(st.entry)} · SL ${f(st.stop)}`);

  if (lines.length === 1) lines.push("Hiện chưa có lệnh chờ hoặc lệnh mở.");
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "Missing bot token" }, { status: 500 });
  try {
    const message = (await req.json())?.message;
    if (!message?.text) return NextResponse.json({ ok: true });
    const chatId = message.chat.id;
    const lower = String(message.text).trim().toLowerCase();

    const allowed = process.env.TELEGRAM_CHAT_ID;
    if (allowed && String(chatId) !== String(allowed)) {
      await reply(token, chatId, "⛔ Bot riêng tư.");
      return NextResponse.json({ ok: true });
    }

    let text: string;
    if (
      lower === "💼 vị thế thật" ||
      lower === "vị thế thật" ||
      lower === "vi the that" ||
      lower === "vị thế" ||
      lower === "vi the" ||
      lower === "/positions" ||
      lower === "/pos"
    ) {
      text = await mexcStatus();
    } else if (lower === "👁 đang theo dõi" || lower === "đang theo dõi" || lower === "dang theo doi") {
      const ws = loadWatches();
      text = ws.length
        ? "👁 *Đang theo dõi:*\n" + ws.map((x) => `• ${x.side > 0 ? "LONG" : "SHORT"} ${x.coin} @${f(x.entry)} · TP ${f(x.tp)} · SL ${f(x.stop)}`).join("\n")
        : "Chưa có coin nào trong danh sách theo dõi.\nCú pháp: `theo dõi SUI 1.041 1.029 1.085 btc 82750`";
    } else if (lower.includes("theo dõi") || lower.includes("theo doi")) {
      if (lower.startsWith("bỏ") || lower.startsWith("bo ")) {
        saveWatches([]);
        text = "🗑 Đã xoá hết danh sách theo dõi.";
      } else {
        const w = parseWatch(lower, COINS), ws = loadWatches();
        if (w) {
          saveWatches([...ws.filter((x) => x.coin !== w.coin), w]);
          text = `👁 Theo dõi ${w.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${w.coin}*: chạm ${f(w.entry)} → báo (TP ${f(w.tp)}, SL ${f(w.stop)})` +
            `${w.btcCancel ? `, huỷ nếu BTC ${w.side > 0 ? "<" : ">"} ${f(w.btcCancel)}` : ""}. Hết hạn 23:59 hôm nay.`;
        } else if (ws.length) {
          text = "👁 *Đang theo dõi:*\n" + ws.map((x) => `• ${x.side > 0 ? "LONG" : "SHORT"} ${x.coin} @${f(x.entry)} · TP ${f(x.tp)} · SL ${f(x.stop)}`).join("\n");
        } else {
          text = "Cú pháp: `theo dõi SUI 1.041 1.029 1.085 btc 82750` (coin, giá vào, SL, TP, tuỳ chọn mức BTC huỷ).";
        }
      }
    } else if (lower.includes("thống kê") || lower.includes("thong ke")) {
      text = stats();
    } else if (lower === "❓ hướng dẫn" || lower === "hướng dẫn" || lower === "huong dan" || lower === "/help" || lower === "/start") {
      text = HELP;
    } else {
      const coin = COINS.find((c) => new RegExp(`(^|\\b|/)${c.toLowerCase()}(\\b|$)`).test(lower));
      text = coin ? await coinStatus(coin) : HELP;
    }
    await reply(token, chatId, text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Telegram webhook endpoint is active." });
}
