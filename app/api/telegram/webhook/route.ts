import { NextRequest, NextResponse } from "next/server";
import { candles, ticker } from "@/lib/okx";
import { analyse, swings } from "@/lib/patterns";
import { evaluateSetup } from "@/lib/decision-engine";
import { paperSummary } from "@/lib/paper-ledger";
import { isStarSetup, calculatePartialPnL, formatEntryReason } from "@/lib/trading-policy";
import { getCapitalTier } from "@/lib/capital-tier";
import { getMexcAccountAsset } from "@/lib/mexc-client";

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

const dailyCache = new Map<string, { trend: 1 | -1 | 0; exp: number }>();

async function getDailyTrend(coin: string): Promise<1 | -1 | 0> {
  const now = Date.now();
  const cached = dailyCache.get(coin);
  if (cached && cached.exp > now) return cached.trend;
  try {
    const d = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
    if (d.length < 60) return 0;
    let ema = d[0].c;
    for (const c of d) ema += (2 / 51) * (c.c - ema);
    const trend: 1 | -1 | 0 = d.at(-1)!.c > ema ? 1 : -1;
    dailyCache.set(coin, { trend, exp: now + 30 * 60_000 });
    return trend;
  } catch {
    return 0;
  }
}

function getStyleName(style: string, side: 1 | -1, tf: "4H" | "1H") {
  if (style === "bos") return side > 0 ? `BOS ${tf}` : `Gãy đáy BOS ${tf}`;
  return side > 0 ? `Hai đáy ${tf}` : `Hai đỉnh ${tf}`;
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

    // 1. Check 4H setups
    const paper = paperSummary(CAPITAL);
    const accepted4h = a4.setups
      .map((setup) => ({
        setup,
        decision: evaluateSetup(setup, {
          coin,
          timeframe: "4H",
          btcDaily,
          ownDaily,
          equity: paper.equity,
          peakEquity: paper.peakEquity,
          lastBarTime: a4.lastBarTime,
          livePrice,
        }),
      }))
      .find((item) => item.decision.accepted && item.decision.plan);

    // 2. Check 1H setups
    const accepted1h = a1.setups
      .map((setup) => ({
        setup,
        decision: evaluateSetup(setup, {
          coin,
          timeframe: "1H",
          btcDaily,
          ownDaily,
          equity: paper.equity,
          peakEquity: paper.peakEquity,
          lastBarTime: a1.lastBarTime,
          livePrice,
        }),
      }))
      .find((item) => item.decision.accepted && item.decision.plan);

    if (accepted4h?.decision.plan) {
      const s = accepted4h.setup;
      const decisionPlan = accepted4h.decision.plan;
      const riskPct = Math.abs(s.entry - s.stop) / s.entry;
      const sizing = decisionPlan.sizing;
      const pnl = calculatePartialPnL(sizing.actualRiskUsd);
      const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
      const reason = formatEntryReason({
        style: s.style,
        side: s.side,
        timeframe: "4H",
        btcDaily,
        ownDaily,
        volumeRatio: s.volumeRatio,
      });

      return (
        `🎯 *[TÍN HIỆU 4H]* ${sideStr} *${coin}*\n` +
        `• *Điểm vào:* \`${f(s.entry)}\`\n` +
        `• *Cắt lỗ (SL):* \`${f(s.stop)}\` (-${(riskPct * 100).toFixed(2)}%)\n` +
        `• *Chốt lời (TP):* TP1 \`${f(decisionPlan.tp1)}\` (+${pnl.winTp1.toFixed(2)}$) | TP2 \`${f(decisionPlan.tp2)}\` (+${pnl.totalWin.toFixed(2)}$)\n` +
        `• *Sao vô:* ${reason}\n` +
        `• *Ký quỹ:* ~${sizing.margin}$ (x${sizing.leverage} Isolated) · *Rủi ro 1R:* ${sizing.actualRiskUsd}$`
      );
    } else if (accepted1h?.decision.plan) {
      const s = accepted1h.setup;
      const decisionPlan = accepted1h.decision.plan;
      const riskPct = Math.abs(s.entry - s.stop) / s.entry;
      const sizing = decisionPlan.sizing;
      const pnl = calculatePartialPnL(sizing.actualRiskUsd);
      const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
      const reason1h = formatEntryReason({
        style: s.style,
        side: s.side,
        timeframe: "1H",
        btcDaily,
        ownDaily,
        volumeRatio: s.volumeRatio,
      });

      return (
        `⚡ *[LƯỚT SÓNG 1H]* ${sideStr} *${coin}*\n` +
        `• *Điểm vào:* \`${f(s.entry)}\`\n` +
        `• *Cắt lỗ (SL):* \`${f(s.stop)}\` (-${(riskPct * 100).toFixed(2)}%)\n` +
        `• *Chốt lời (TP):* TP1 \`${f(decisionPlan.tp1)}\` (+${pnl.winTp1.toFixed(2)}$) | TP2 \`${f(decisionPlan.tp2)}\` (+${pnl.totalWin.toFixed(2)}$)\n` +
        `• *Sao vô:* ${reason1h}\n` +
        `• *Ký quỹ:* ~${sizing.margin}$ (x${sizing.leverage} Isolated) · *Rủi ro 1R:* ${sizing.actualRiskUsd}$`
      );
    } else {
      const btcTrendStr = btcDaily > 0 ? "TĂNG ↗" : btcDaily < 0 ? "GIẢM ↘" : "CHƯA RÕ";
      const ownTrendStr = ownDaily > 0 ? "TĂNG ↗" : ownDaily < 0 ? "GIẢM ↘" : "CHƯA RÕ";
      return (
        `⚪ *[${coin}] Chưa có điểm vào* (Giá live: \`${f(livePrice)}\`)\n` +
        `• *Xu hướng:* Ngày ${ownTrendStr} · BTC Ngày ${btcTrendStr}\n` +
        `• *Trạng thái:* Chưa có cấu trúc nến hợp lệ đạt chuẩn an toàn. Đứng ngoài bảo toàn vốn.`
      );
    }
  } catch (e) {
    console.error("analyzeCoin error", e);
    return `❌ Không thể lấy dữ liệu phân tích ${coin} lúc này. Vui lòng thử lại sau giây lát!`;
  }
}

async function scanWatchlist(): Promise<string> {
  const btcDaily = await getDailyTrend("BTC");
  const cand4h: string[] = [];
  const cand1h: string[] = [];
  const paper = paperSummary(CAPITAL);

  for (const c of COINS) {
    try {
      const ownDaily = await getDailyTrend(c);
      const [c4, c1] = await Promise.all([
        candles(`${c}-USDT-SWAP`, "4H", 60),
        candles(`${c}-USDT-SWAP`, "1H", 60),
      ]);
      const a4 = analyse(c4);
      for (const s of a4.setups) {
        const decision = evaluateSetup(s, { coin: c, timeframe: "4H", btcDaily, ownDaily, equity: paper.equity, peakEquity: paper.peakEquity, lastBarTime: a4.lastBarTime });
        if (!decision.accepted) continue;
        const side = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        cand4h.push(`• *${c}* ${side} (${s.style.toUpperCase()}) ~${f(s.entry)}`);
      }

      const a1 = analyse(c1);
      for (const s of a1.setups) {
        const decision = evaluateSetup(s, { coin: c, timeframe: "1H", btcDaily, ownDaily, equity: paper.equity, peakEquity: paper.peakEquity, lastBarTime: a1.lastBarTime });
        if (!decision.accepted) continue;
        const side = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        cand1h.push(`• *${c}* ${side} (${s.style.toUpperCase()}) ~${f(s.entry)}`);
      }
    } catch {}
  }

  const btcText = btcDaily > 0 ? "TĂNG ↗ (ưu tiên LONG)" : btcDaily < 0 ? "GIẢM ↘ (ưu tiên SHORT)" : "CHƯA RÕ";
  let text = `📡 *QUÉT THỊ TRƯỜNG 21 COIN*\n`;
  text += `• *Bối cảnh BTC Ngày:* ${btcText}\n`;
  text += `• *Đóng nến 4H kế:* ${next4hTime()}\n\n`;

  if (cand4h.length > 0) {
    text += `📌 *Sóng lớn 4H:*\n${cand4h.join("\n")}\n\n`;
  }
  if (cand1h.length > 0) {
    text += `⚡ *Lướt sóng 1H:*\n${cand1h.join("\n")}\n\n`;
  }
  if (cand4h.length === 0 && cand1h.length === 0) {
    text += `⚪ *Hiện tại:* Chưa có coin nào xuất hiện điểm vào đạt chuẩn. Đứng ngoài an toàn.`;
  }

  return text;
}

async function scanKeyLevels(): Promise<string> {
  const nearHigh: string[] = [];
  const nearLow: string[] = [];

  for (const c of COINS) {
    try {
      const c4 = await candles(`${c}-USDT-SWAP`, "4H", 60);
      const { highs, lows } = swings(c4);
      if (!highs.length || !lows.length) continue;
      const lastHigh = c4[highs.at(-1)!].h;
      const lastLow = c4[lows.at(-1)!].l;
      const lastPrice = c4.at(-1)!.c;

      const distHighPct = (lastHigh - lastPrice) / lastPrice;
      const distLowPct = (lastPrice - lastLow) / lastPrice;

      if (distHighPct >= -0.005 && distHighPct <= 0.02) {
        const pct = (Math.abs(distHighPct) * 100).toFixed(2);
        nearHigh.push(`• *${c}* (\`${f(lastPrice)}\` ➔ Đỉnh \`${f(lastHigh)}\`, cách *${pct}%*)`);
      }

      if (distLowPct >= -0.005 && distLowPct <= 0.02) {
        const pct = (Math.abs(distLowPct) * 100).toFixed(2);
        nearLow.push(`• *${c}* (\`${f(lastPrice)}\` ➔ Đáy \`${f(lastLow)}\`, cách *${pct}%*)`);
      }
    } catch {}
  }

  let text = `🧭 *RADAR CANH ĐỈNH / ĐÁY (4H)*\n\n`;

  if (nearHigh.length > 0) {
    text += `🏔️ *GẦN ĐỈNH CŨ:*\n${nearHigh.join("\n")}\n\n`;
  } else {
    text += `🏔️ *Đỉnh cũ:* Không có coin nào cách <= 2%.\n\n`;
  }

  if (nearLow.length > 0) {
    text += `🏖️ *GẦN ĐÁY CŨ:*\n${nearLow.join("\n")}\n`;
  } else {
    text += `🏖️ *Đáy cũ:* Không có coin nào cách <= 2%.\n`;
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
        reply_markup: {
          keyboard: [
            [{ text: "🔍 Kèo" }, { text: "🧭 Canh Đỉnh/Đáy" }],
            [{ text: "🏦 Xem Vốn & Tier" }],
            [{ text: "SOL" }, { text: "WIF" }, { text: "DOGE" }]
          ],
          resize_keyboard: true,
          is_persistent: true,
        },
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
      welcome += `• Nhắn \`canh\` hoặc \`/canh\` để *bật Radar canh coin sắp chạm Đỉnh cũ / Đáy cũ*.\n`;
      welcome += `• Nhắn \`keo\` hoặc \`quét\` để quét setup paper 4H.\n`;
      welcome += `• Nhắn tên coin (ví dụ: \`SOL\`, \`BTC\`, \`TIA\`) để xem chi tiết thông số vào lệnh, SL, TP.\n`;
      welcome += `• Nhắn \`von\` hoặc \`luật\` để xem policy paper 40$, rủi ro tối đa 10%.\n`;
      await sendTelegramReply(token, chatId, welcome);
      return NextResponse.json({ ok: true });
    }

    // 2. Proximity Radar (Canh đỉnh cũ / đáy cũ)
    if (
      lower.includes("canh") ||
      lower.includes("đỉnh") ||
      lower.includes("dinh") ||
      lower.includes("đáy") ||
      lower.includes("day") ||
      lower === "/canh" ||
      lower === "/radar"
    ) {
      const radarRes = await scanKeyLevels();
      await sendTelegramReply(token, chatId, radarRes);
      return NextResponse.json({ ok: true });
    }

    // 3. Scan market
    if (
      lower.includes("kèo") ||
      lower.includes("keo") ||
      lower.includes("quét") ||
      lower.includes("quet") ||
      lower.includes("thị trường") ||
      lower.includes("thi truong") ||
      lower.includes("top") ||
      lower.includes("lọc") ||
      lower.includes("loc") ||
      lower === "/scan"
    ) {
      const scanRes = await scanWatchlist();
      await sendTelegramReply(token, chatId, scanRes);
      return NextResponse.json({ ok: true });
    }

    // 3. Capital & Discipline rule & Capital Tiers
    if (
      lower.includes("vốn") ||
      lower.includes("von") ||
      lower.includes("tier") ||
      lower.includes("sodu") ||
      lower.includes("số dư") ||
      lower.includes("luật") ||
      lower.includes("luat") ||
      lower.includes("kỷ luật")
    ) {
      const asset = await getMexcAccountAsset(CAPITAL);
      const tier = getCapitalTier(asset.equity);
      let rule = `🏦 *TÀI KHOẢN & VỐN BẬC THANG*\n\n`;
      rule += `• *Số dư ví:* \`${asset.equity.toFixed(2)} USDT\` ${asset.isMock ? "_(Paper)_" : "_(MEXC Live)_"}\n`;
      rule += `• *Cấp bậc:* *${tier.name}*\n`;
      rule += `• *Rủi ro mỗi lệnh (1R):* \`${tier.riskPerTradeUsd} USDT\`\n`;
      rule += `• *Số lệnh mở tối đa:* \`${tier.maxOpenTrades} lệnh đồng thời\`\n`;
      rule += `• *Mốc bảo vệ lãi (Ratchet):* \`${tier.ratchetFloorUsd} USDT\``;
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
    let reply = `🤖 *Nhận được:* "${rawText}"\n\n`;
    reply += `• Soi coin: Nhắn tên coin (ví dụ: \`SOL\`, \`WIF\`, \`DOGE\`...)\n`;
    reply += `• Xem kèo: Nhắn \`kèo\` hoặc bấm nút [ 🔍 Kèo ]\n`;
    reply += `• Xem vốn: Nhắn \`vốn\` hoặc bấm nút [ 🏦 Xem Vốn & Tier ]`;

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

