// Trạng thái 3 kèo của 21 coin cho trang web (cache 5 phút).
import { COINS } from "@/lib/telegram-alerts";
import { coinSnapshot, type Snapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 5 * 60_000) return Response.json(cache.body);
  const coins: Snapshot[] = [], failed: string[] = [];
  // OKX giới hạn tốc độ /market/candles: quét theo lô 5 coin
  for (let i = 0; i < COINS.length; i += 5) {
    if (i) await new Promise((r) => setTimeout(r, 400));
    const res = await Promise.allSettled(COINS.slice(i, i + 5).map(coinSnapshot));
    res.forEach((r, k) => (r.status === "fulfilled" ? coins.push(r.value) : failed.push(COINS[i + k])));
  }
  const body = { coins, failed, fetchedAt: Date.now() };
  cache = { at: Date.now(), body };
  return Response.json(body);
}
