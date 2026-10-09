import { analyse } from "@/lib/patterns";
import { candles } from "@/lib/okx";

export const runtime = "nodejs";

const COINS = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"
];

async function dailyTrend(coin: string): Promise<1 | -1 | 0> {
  const d = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
  if (d.length < 60) return 0;
  let ema = d[0].c;
  for (const c of d) ema += (2 / 51) * (c.c - ema);
  return d.at(-1)!.c > ema ? 1 : -1;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  const CRON_SECRET = process.env.CRON_SECRET;

  if (CRON_SECRET && secretParam !== CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN || "8671237237:AAHA_apGlj03UhrIsJfOQgVap4KtyTzNGbE";
  const chatId = process.env.TELEGRAM_CHAT_ID || "6282967183";

  if (!botToken || !chatId) {
    return Response.json({ error: "Missing Telegram credentials" }, { status: 500 });
  }

  const btcDaily = await dailyTrend("BTC").catch(() => 0 as const);
  const alerts: string[] = [];

  for (const coin of COINS) {
    try {
      const cs = await candles(`${coin}-USDT-SWAP`, "4H", 300);
      const ownTrend = coin === "BTC" ? btcDaily : await dailyTrend(coin);
      const a = analyse(cs);

      const triggeredSetups = a.setups.filter((s) => {
        if (s.state !== "triggered") return false;
        const risk = Math.abs(s.entry - s.stop) / s.entry;
        if (risk < 0.004 || risk > 0.08) return false;

        if (s.style === "bos" && s.side < 0) return false;
        if (s.style === "double_top_bottom" && !(btcDaily === s.side && ownTrend === s.side)) return false;
        return true;
      });

      for (const s of triggeredSetups) {
        const sideStr = s.side > 0 ? "🟢 LONG" : "🔴 SHORT";
        const riskPct = (Math.abs(s.entry - s.stop) / s.entry) * 100;
        const lev = Math.max(1, Math.min(20, Math.floor(2.5 / (riskPct / 100))));
        const title = s.style === "bos" ? "Phá vỡ cấu trúc (BOS)" : "Hai đỉnh / Hai đáy";

        alerts.push(
          `🚨 TÍN HIỆU 4H: ${coin}-USDT\n` +
          `• Setup: ${title} (${sideStr})\n` +
          `• Giá nến đóng: ${s.entry}\n` +
          `• Entry tham chiếu: ${s.entry}\n` +
          `• Dừng lỗ (SL): ${s.stop} (${riskPct.toFixed(2)}%)\n` +
          `• Chốt lời 1.5R: ${s.tp15.toFixed(4)}\n` +
          `• Đòn bẩy gợi ý: ~${lev}x (mất ~$2.5 với vốn $40)`
        );
      }
    } catch (e) {
      console.error(`Error scanning ${coin}`, e);
    }
  }

  const message = alerts.length > 0
    ? `⚡ CẢNH BÁO SETUP 4H HÔM NAY (${alerts.length} coin) ⚡\n\n` + alerts.join("\n-------------------\n")
    : "ℹ️ Báo cáo quét 4h (Railway Cron): Hiện tại chưa phát hiện setup 4h mới thỏa mãn bộ lọc (BOS LONG hoặc Hai đỉnh/đáy cùng xu hướng ngày).";

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true
      }),
    });
  } catch (err) {
    console.error("Telegram send error", err);
  }

  return Response.json({ status: "ok", scanned: COINS.length, alerts: alerts.length });
}
