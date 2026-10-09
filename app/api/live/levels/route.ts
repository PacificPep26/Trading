import { trendFor } from "@/lib/live-levels";

export const runtime = "nodejs";

const COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"];
const CACHE_MS = 60_000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) return Response.json(cache.body);
  type Row = Awaited<ReturnType<typeof trendFor>>;
  const rows: Row[] = [];
  const failed: string[] = [];
  // OKX rate-limits bursts on /market/candles: small batches, one retry
  for (let i = 0; i < COINS.length; i += 4) {
    if (i) await new Promise((r) => setTimeout(r, 500));
    const batch = await Promise.allSettled(COINS.slice(i, i + 4).map((coin) =>
      trendFor(coin).catch(async () => { await new Promise((r) => setTimeout(r, 900)); return trendFor(coin); })));
    batch.forEach((r, j) => (r.status === "fulfilled" ? rows.push(r.value) : failed.push(COINS[i + j])));
  }
  const body = { rows, failed, computedAt: Date.now() };
  cache = { at: Date.now(), body };
  return Response.json(body);
}
