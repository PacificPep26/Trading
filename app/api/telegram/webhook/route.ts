// Webhook @VictorHuynh_trading_bot: hướng dẫn, thống kê 3 sổ paper, gõ tên coin xem trạng thái 3 kèo, theo dõi giá.
import { NextRequest, NextResponse } from "next/server";
import { loadLimits, limitStats } from "@/lib/resting-limit";
import { loadSwings, swingStats } from "@/lib/swing-4h";
import { loadWatches, saveWatches, parseWatch } from "@/lib/price-watch";
import { COINS, ICT_PAPER, HIGHTEST_PAPER, ST_PAPER, f, soPaper } from "@/lib/telegram-alerts";
import { SO_LABEL, type SoKind } from "@/lib/so-setups";
import { coinSnapshot } from "@/lib/snapshot";

const HELP =
  "🤖 *Bot báo kèo học từ video* (bạn tự vào lệnh, phí 0):\n" +
  "• 🎯 ICT quét đỉnh hôm qua → SHORT 1H\n" +
  "• 🔨 Nến high test 4H → lệnh chờ phá (Jason Graystone, đạt chuẩn)\n" +
  "• 📈 Supertrend 4H đổi màu → vào ngay, không TP, bot nhắc dời SL theo dải (Wysetrade, đạt chuẩn)\n" +
  "• SO Trading 1H, tin kèm số backtest (chỉ 🔁 đạt chuẩn): 🔁 hồi đỉnh cũ · 👤 vai–đầu–vai · 🚀 phá vỡ sau nén · 🕯 chòm râu\n" +
  "Tin: `TP1` = chốt 50% rồi dời SL về giá vào; `x` = đòn bẩy gợi ý (≤ 10).\n\n" +
  "Lệnh: `thống kê` · tên coin (vd `SOL`) · `theo dõi SUI 1.041 1.029 1.085 btc 82750` · `bỏ theo dõi`";

async function reply(token: string, chatId: number | string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true,
        reply_markup: { keyboard: [[{ text: "📊 Thống kê" }, { text: "❓ Hướng dẫn" }]], resize_keyboard: true, is_persistent: true },
      }),
    });
  } catch (e) {
    console.error("reply error", e);
  }
}

function stats(): string {
  const line = (name: string, s: { n: number; wins: number; avgR: number; sumR: number }, open: string) =>
    `${name}: ${s.n} lệnh đóng · thắng ${s.n ? Math.round((s.wins / s.n) * 100) : 0}% · TB ${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R · tổng ${(s.sumR * 2.5).toFixed(0)}$ (2.5$/lệnh) · ${open}`;
  const lim = limitStats(loadLimits()), ict = limitStats(loadLimits(ICT_PAPER)), sw = swingStats(loadSwings()), st = swingStats(loadSwings(ST_PAPER));
  return "📊 *Sổ paper* (so với backtest 2025–26)\n" +
    line("🎯 ICT", ict, `${ict.pending} chờ, ${ict.open} mở`) + "\n   backtest +0.42R/lệnh\n" +
    line("📌 Limit (tắt tin)", lim, `${lim.pending} chờ, ${lim.open} mở`) + "\n   backtest +0.06R/lệnh\n" +
    line("📊 4H (tắt tin)", sw, `${sw.open} mở`) + "\n   backtest +1.2R/lệnh\n" +
    line("🔨 High test 4H", limitStats(loadLimits(HIGHTEST_PAPER)), "lệnh chờ phá") + "\n   backtest +0.13R/lệnh\n" +
    line("📈 Supertrend 4H", st, `${st.open} mở`) + "\n   backtest +0.16R/lệnh\n" +
    (Object.keys(SO_LABEL) as SoKind[]).map((k) => {
      const st = limitStats(loadLimits(soPaper(k)));
      return line(SO_LABEL[k].name, st, `${st.open} mở`) + `\n   ${SO_LABEL[k].stats}`;
    }).join("\n");
}

async function coinStatus(coin: string): Promise<string> {
  const s = await coinSnapshot(coin);
  const lines = [`*${coin}* ${s.price ? f(s.price) : ""} · xu hướng ngày ${s.daily > 0 ? "TĂNG ↗" : s.daily < 0 ? "GIẢM ↘" : "?"}`];
  if (s.ict) lines.push(`🎯 ICT ${s.ict.status === "open" ? "đang mở" : "chờ khớp"} · Limit ${f(s.ict.limit)} · SL ${f(s.ict.stop)} · TP ${f(s.ict.tp)}`);
  if (s.limit) lines.push(`📌 ${s.limit.status === "open" ? "đang mở" : "chờ khớp"} · Limit ${f(s.limit.limit)} · SL ${f(s.limit.stop)} · TP ${f(s.limit.tp)}`);
  if (s.swing) lines.push(`📊 4H ${s.swing.side > 0 ? "LONG" : "SHORT"} đang mở · vào ${f(s.swing.entry)} · SL hiện tại ${f(s.swing.stop)}`);
  for (const p of s.pending4h) {
    lines.push(`📊 4H ${p.side > 0 ? "hai đáy" : "hai đỉnh"} chờ đóng nến ${p.side > 0 ? "trên" : "dưới"} ${f(p.trigger)} (cách ${(Math.abs(p.distancePct) * 100).toFixed(1)}%) · SL ${f(p.stop)}`);
  }
  if (lines.length === 1) lines.push("Chưa có kèo nào.");
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
    if (lower.includes("theo dõi") || lower.includes("theo doi")) {
      if (lower.startsWith("bỏ") || lower.startsWith("bo ")) {
        saveWatches([]);
        text = "🗑 Đã xoá hết danh sách theo dõi.";
      } else {
        const w = parseWatch(lower, COINS), ws = loadWatches();
        if (w) {
          saveWatches([...ws.filter((x) => x.coin !== w.coin), w]);
          text = `👁 Theo dõi ${w.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${w.coin}*: chạm ${w.entry} → báo (SL ${w.stop}, TP ${w.tp})` +
            `${w.btcCancel ? `, huỷ nếu BTC ${w.side > 0 ? "<" : ">"} ${w.btcCancel}` : ""}. Hết hạn 23:59 hôm nay.`;
        } else if (ws.length) {
          text = "👁 *Đang theo dõi:*\n" + ws.map((x) => `• ${x.side > 0 ? "LONG" : "SHORT"} ${x.coin} @${x.entry} · SL ${x.stop} · TP ${x.tp}`).join("\n");
        } else {
          text = "Cú pháp: `theo dõi SUI 1.041 1.029 1.085 btc 82750` (coin, giá vào, SL, TP, tuỳ chọn mức BTC huỷ).";
        }
      }
    } else if (lower.includes("thống kê") || lower.includes("thong ke")) {
      text = stats();
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
