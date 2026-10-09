import { NextRequest, NextResponse } from "next/server";
import { candles, ticker } from "@/lib/okx";
import { analyse } from "@/lib/patterns";
import {
  isAllowedSetup,
  isStarSetup,
  calculateSizing,
  calculatePartialPnL,
} from "@/lib/trading-policy";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

const CAPITAL = Number(process.env.ALERT_CAPITAL ?? 40);

function f(v: number) {
  return v.toLocaleString("vi-VN", { maximumFractionDigits: v > 1000 ? 1 : v > 1 ? 3 : 7 });
}

function next4hTime(now = Date.now()) {
  const vn = new Date(now + 7 * 3_600_000);
  const h = vn.getUTCHours(), next = (Math.floor(h / 4) + 1) * 4;
  const target = new Date(vn);
  target.setUTCHours(next % 24, 0, 0, 0);
  if (next >= 24) target.setUTCDate(target.getUTCDate() + 1);
  const ms = target.getTime() - vn.getTime();
  const m = Math.floor(ms / 60_000);
  return `${String(target.getUTCHours()).padStart(2, "0")}:00 (còn ~${Math.floor(m / 60)}h${m % 60}p)`;
}

async function getDailyTrend(coin: string): Promise<1 | -1 | 0> {
  try {
    const d = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
    if (d.length < 60) return 0;
    let ema = d[0].c;
    for (const c of d) ema += (2 / 51) * (c.c - ema);
    return d.at(-1)!.c > ema ? 1 : -1;
  } catch {
    return 0;
  }
}

async function analyzeCoin(coin: string): Promise<string> {
  try {
    const [c4, c1, btcDaily, ownDaily, t] = await Promise.all([
      candles(`${coin}-USDT-SWAP`, "4H", 120),
      candles(`${coin}-USDT-SWAP`, "1H", 60),
      getDailyTrend("BTC"),
      getDailyTrend(coin),
      ticker(`${coin}-USDT-SWAP`).catch(() => null),
    ]);

    const livePrice = t?.last ?? c4.at(-1)?.c ?? 0;
    const a4 = analyse(c4);
    const a1 = analyse(c1);

    const trend4h = a4.trend > 0 ? "TĂNG ↗" : a4.trend < 0 ? "GIẢM ↘" : "ĐI NGANG →";
    const trend1h = a1.trend > 0 ? "TĂNG ↗" : a1.trend < 0 ? "GIẢM ↘" : "ĐI NGANG →";
    const trendDay = ownDaily > 0 ? "TĂNG ↗" : ownDaily < 0 ? "GIẢM ↘" : "CHƯA RÕ";
    const btcText = btcDaily > 0 ? "TĂNG ↗" : btcDaily < 0 ? "GIẢM ↘" : "CHƯA RÕ";

    let text = `📊 *SOI KÈO ${coin} / USDT*\n\n`;
    text += `💰 *Giá live:* \`${f(livePrice)}\`\n`;
    text += `• *Xu hướng 4H:* ${trend4h}\n`;
    text += `• *Xu hướng 1H:* ${trend1h}\n`;
    text += `• *Xu hướng Ngày (${coin}):* ${trendDay}\n`;
    text += `• *Bối cảnh BTC Ngày:* ${btcText}\n\n`;

    // Check setups with strict risk and distance filter
    const validSetups = a4.setups.filter((s) => {
      if (!isAllowedSetup(s.style, s.side, "4H", btcDaily, ownDaily)) return false;
      const risk = Math.abs(s.entry - s.stop) / s.entry;
      // SL must be between 0.4% and 8.0% (isolated x10 liquidates at 10%)
      if (risk < 0.004 || risk > 0.08) return false;
      // If pending, must be close to entry (within 1.5%)
      if (s.state === "pending" && Math.abs(s.distancePct) > 0.015) return false;
      return true;
    });

    if (validSetups.length === 0) {
      text += `🎯 *Kết luận:* *ĐỨNG NGOÀI (CHƯA CÓ ĐIỂM VÀO)*\n`;
      text += `Hiện tại ${coin} không có tín hiệu nến 4H hợp lệ.\n`;
      const rawSetup = a4.setups[0];
      if (rawSetup) {
        const rawRisk = Math.abs(rawSetup.entry - rawSetup.stop) / rawSetup.entry;
        if (rawRisk > 0.08) {
          text += `⚠️ *Cảnh báo rủi ro:* Khoảng cách dừng lỗ quá rộng (${(rawRisk * 100).toFixed(1)}% > 8%). Đánh x10 sẽ bị *cháy tài khoản trước khi chạm SL*. Tuyệt đối không vào!\n`;
        } else if (Math.abs(rawSetup.distancePct) > 0.015) {
          text += `📌 Giá còn cách xa mức phá vỡ (${(Math.abs(rawSetup.distancePct) * 100).toFixed(1)}% > 1.5%), chưa có điểm kích hoạt.\n`;
        }
      }
      text += `\n💡 *Lời khuyên:* Không FOMO đu đỉnh/đu đáy. Kiên nhẫn chờ nến 4H kế đóng lúc ${next4hTime()}.\n`;
    } else {
      const s = validSetups[0];
      const riskPct = Math.abs(s.entry - s.stop) / s.entry;
      const sizing = calculateSizing(CAPITAL, riskPct);
      const pnl = calculatePartialPnL(sizing.actualRiskUsd);
      const isStar = isStarSetup(s.side, ownDaily, btcDaily);

      const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
      text += `🎯 *TÍN HIỆU 4H:* *${sideStr} (${s.style === "bos" ? "BOS 4H" : "Hai đỉnh 4H"})* ${isStar ? "⭐ [KÈO ĐẸP ★★★]" : ""}\n`;
      text += `• *Trạng thái:* ${s.state === "triggered" ? "✅ VÀO NGAY" : "⏳ CHỜ NẾN 4H ĐÓNG"}\n`;
      text += `• *Điểm vào:* \`${f(s.entry)}\`\n`;
      text += `• *Dừng lỗ (SL):* \`${f(s.stop)}\` (-${(riskPct * 100).toFixed(2)}%)\n`;
      text += `• *TP 1 (0.5R):* \`${f(s.entry + s.side * 0.5 * Math.abs(s.entry - s.stop))}\` (+${pnl.winTp1.toFixed(2)}$ chốt 50%, dời hòa)\n`;
      text += `• *TP 2 (1.0R):* \`${f(s.entry + s.side * 1.0 * Math.abs(s.entry - s.stop))}\` (Tổng +${pnl.totalWin.toFixed(2)}$)\n\n`;
      text += `⚡ *THÔNG SỐ VÀO APP MEXC (VỐN ${CAPITAL}$):*\n`;
      text += `• Đòn bẩy: *x${sizing.leverage} Isolated*\n`;
      text += `• Ký quỹ: *${sizing.margin}$*\n`;
      text += `• Vị thế: *${sizing.notional}$*\n`;
      text += `• Rủi ro chạm SL: *-${sizing.actualRiskUsd}$*\n`;
    }

    return text;
  } catch (e) {
    console.error("analyzeCoin error", e);
    return `❌ Không thể lấy dữ liệu phân tích ${coin} lúc này. Vui lòng thử lại sau giây lát!`;
  }
}

async function scanWatchlist(): Promise<string> {
  const btcDaily = await getDailyTrend("BTC");
  const candidates: string[] = [];

  for (const c of COINS) {
    try {
      const ownDaily = await getDailyTrend(c);
      const c4 = await candles(`${c}-USDT-SWAP`, "4H", 60);
      const a = analyse(c4);
      for (const s of a.setups) {
        if (!isAllowedSetup(s.style, s.side, "4H", btcDaily, ownDaily)) continue;
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.004 || risk > 0.08) continue;
        if (s.state === "pending" && Math.abs(s.distancePct) > 0.015) continue;
        const side = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        candidates.push(`• *${c}* ${side} (${s.style.toUpperCase()}) - ${s.state === "triggered" ? "VÀO NGAY" : "Đang chờ sát mức phá"}`);
      }
    } catch {}
  }

  let text = `📡 *QUÉT NHANH 21 CẶP COIN (4H)*\n\n`;
  text += `• *BTC Ngày:* ${btcDaily > 0 ? "TĂNG ↗ (ưu tiên LONG)" : "GIẢM ↘ (ưu tiên SHORT)"}\n`;
  text += `• *Lần đóng nến 4H kế tiếp:* ${next4hTime()}\n\n`;

  if (candidates.length === 0) {
    text += `🟢 *Hiện tại:* Chưa có coin nào xuất hiện tín hiệu 4H hợp lệ.\n`;
    text += `💡 Hệ thống vẫn đang tự động quét liên tục mỗi 5 phút. Khi có nến 4H đóng đạt chuẩn, bot sẽ chủ động nổ chuông báo cho bạn ngay!`;
  } else {
    text += `📌 *Các coin đang có tín hiệu / theo dõi:*\n`;
    text += candidates.join("\n") + "\n\n";
    text += `Nhắn tên coin (ví dụ: \`SOL\` hoặc \`BTC\`) để xem chi tiết điểm vào, SL, TP!`;
  }

  return text;
}

async function sendTelegramReply(token: string, chatId: number | string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("sendTelegramReply error", e);
  }
}

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing bot token" }, { status: 500 });
  }

  try {
    const update = await req.json();
    const message = update?.message;
    if (!message || !message.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const rawText = message.text.trim();
    const lower = rawText.toLowerCase();

    // Verify authorized user
    const allowedChatId = process.env.TELEGRAM_CHAT_ID;
    if (allowedChatId && String(chatId) !== String(allowedChatId)) {
      await sendTelegramReply(token, chatId, "⛔ Xin lỗi, đây là bot giao dịch riêng tư của Victor.");
      return NextResponse.json({ ok: true });
    }

    // 1. Help or Start
    if (lower === "/start" || lower === "/help" || lower === "help" || lower === "giúp" || lower === "lenh") {
      let welcome = `👋 *Chào Victor! Tôi là trợ lý AI Trading của bạn.*\n\n`;
      welcome += `Bạn có thể nhắn trực tiếp với tôi bất cứ lúc nào trên điện thoại:\n\n`;
      welcome += `• Nhắn tên coin (ví dụ: \`SOL\`, \`BTC\`, \`ETH\`, \`LINK\`) để tôi soi chi tiết xu hướng, cản và điểm vào.\n`;
      welcome += `• Nhắn \`keo\` hoặc \`quét\` để quét toàn bộ 21 coin xem có kèo nào không.\n`;
      welcome += `• Nhắn \`von\` hoặc \`luật\` để xem quy tắc quản lý vốn 40$ x10.\n`;
      welcome += `• Hoặc hỏi bất kỳ câu hỏi nào về thị trường!\n`;
      await sendTelegramReply(token, chatId, welcome);
      return NextResponse.json({ ok: true });
    }

    // 2. Scan market
    if (lower.includes("kèo") || lower.includes("keo") || lower.includes("quét") || lower.includes("quet") || lower === "/scan" || lower.includes("thị trường")) {
      const scanRes = await scanWatchlist();
      await sendTelegramReply(token, chatId, scanRes);
      return NextResponse.json({ ok: true });
    }

    // 3. Capital & Discipline rule
    if (lower.includes("vốn") || lower.includes("von") || lower.includes("luật") || lower.includes("luat") || lower.includes("kỷ luật")) {
      let rule = `🛡️ *KỶ LUẬT QUẢN LÝ VỐN MEXC (40$)*\n\n`;
      rule += `1. *Đòn bẩy cố định:* x10 Isolated (Vị thế 400$).\n`;
      rule += `2. *Dừng lỗ (SL):* Bắt buộc đặt theo cấu trúc nến 4H (dưới đáy với Long, trên đỉnh với Short). Không gồng lỗ.\n`;
      rule += `3. *Chốt lời:* Chia 2 bước (50% ở TP1 0.5R để dời SL về hòa vốn; 50% còn lại giữ đến TP2 1.0R).\n`;
      rule += `4. *Quy tắc sống còn:* Thua 2 lệnh liên tiếp trong ngày -> *Nghỉ hết ngày*, tuyệt đối không gỡ gạc!\n`;
      await sendTelegramReply(token, chatId, rule);
      return NextResponse.json({ ok: true });
    }

    // 4. Check if a coin symbol is mentioned
    const matchedCoin = COINS.find((c) => {
      const regex = new RegExp(`(^|\\b|/)${c.toLowerCase()}(\\b|$)`, "i");
      return regex.test(lower);
    });

    if (matchedCoin) {
      const coinRes = await analyzeCoin(matchedCoin);
      await sendTelegramReply(token, chatId, coinRes);
      return NextResponse.json({ ok: true });
    }

    // 5. General AI fallback / conversation
    let reply = `🤖 *Trợ lý Trading:* Tôi đã nhận được tin nhắn của bạn: "${rawText}"\n\n`;
    reply += `• Nếu bạn muốn soi kèo coin cụ thể: Hãy nhắn tên coin (ví dụ: \`SOL\`, \`BTC\`, \`ETH\`, \`LINK\`...)\n`;
    reply += `• Nếu muốn kiểm tra toàn bộ thị trường: Hãy nhắn \`kèo\` hoặc \`quét\`\n`;
    reply += `• Nếu cần xem quy tắc vốn 40$: Nhắn \`vốn\`\n\n`;
    reply += `⏰ *Nhắc nhở:* Nến 4H kế đóng lúc ${next4hTime()}. Hãy kiên nhẫn chờ xác nhận, không vào lệnh vội!`;

    await sendTelegramReply(token, chatId, reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook processing error", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Telegram webhook endpoint is active." });
}

