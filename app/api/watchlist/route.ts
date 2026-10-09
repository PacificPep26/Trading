import { analyse } from "@/lib/patterns";
import { candles } from "@/lib/okx";
import styles from "@/lib/styles-stats.json";
import { evaluateSetup } from "@/lib/decision-engine";
import { paperSummary } from "@/lib/paper-ledger";

export const runtime = "nodejs";

// OKX USDT perps matching the 21 backtested Binance symbols (1000PEPE -> PEPE)
const COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "ADA", "AVAX", "LINK", "DOT", "LTC", "SUI", "ARB", "OP", "NEAR", "APT", "INJ", "TIA", "PEPE", "WIF"];
const CACHE_MS = 5 * 60_000;
let cache: { at: number; body: unknown } | null = null;

type Row = { style: string; interval: string; target: string; train: { n: number; winRate?: number; expR?: number; coinsPositive?: number }; test: { n: number; expR?: number } };
const STATS = Object.fromEntries(
  (styles.results as Row[])
    .filter((r) => r.interval === "4h" && r.target === "1.5R")
    .map((r) => [r.style, { n: r.train.n, winRate: r.train.winRate, expR: r.train.expR, coinsPositive: r.train.coinsPositive, expR2026: r.test.expR }]),
);

// Daily trend = last closed daily candle vs daily EMA50 (same as service/scripts/rule_study.py)
async function dailyTrend(coin: string): Promise<1 | -1 | 0> {
  const d = (await candles(`${coin}-USDT-SWAP`, "1Dutc", 300)).filter((c) => c.closed);
  if (d.length < 60) return 0;
  let ema = d[0].c;
  for (const c of d) ema += (2 / 51) * (c.c - ema);
  return d.at(-1)!.c > ema ? 1 : -1;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) return Response.json(cache.body);
  const paper = paperSummary(Number(process.env.ALERT_CAPITAL ?? 40));
  const btcDaily = await dailyTrend("BTC").catch(() => 0 as const);
  const scanOne = async (coin: string) => {
    const [a, own] = await Promise.all([analyse(await candles(`${coin}-USDT-SWAP`, "4H", 300)), coin === "BTC" ? btcDaily : dailyTrend(coin)]);
    const setups = a.setups.map((s) => {
      const decision = evaluateSetup(s, { coin, timeframe: "4H", btcDaily, ownDaily: own, equity: paper.equity, peakEquity: paper.peakEquity, lastBarTime: a.lastBarTime });
      return { ...s, decision, blocked: decision.accepted || decision.code === "PENDING_CONFIRMATION" ? null : decision.code };
    });
    return { coin, ...a, daily: own, setups };
  };
  // OKX rate-limits bursts on /market/candles: scan in small batches and retry once
  const results: PromiseSettledResult<Awaited<ReturnType<typeof scanOne>>>[] = [];
  for (let i = 0; i < COINS.length; i += 5) {
    if (i) await new Promise((r) => setTimeout(r, 400));
    results.push(...(await Promise.allSettled(COINS.slice(i, i + 5).map((coin) =>
      scanOne(coin).catch(async () => {
        await new Promise((r) => setTimeout(r, 800));
        return scanOne(coin);
      })))));
  }
  const coins = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = COINS.filter((_, i) => results[i].status === "rejected");
  const body = { coins, failed, stats: STATS, btcDaily, paper, fetchedAt: Date.now() };
  cache = { at: Date.now(), body };
  return Response.json(body);
}
