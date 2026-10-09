// 4h and 1h structure trend for the scanner's "no setup" note (same swing/trend rules as service/backtest/patterns.py).
import { candles } from "@/lib/okx";
import { swings, trendOf } from "@/lib/patterns";

export async function trendFor(coin: string): Promise<{ coin: string; trend4h: number; trend1h: number }> {
  const inst = `${coin}-USDT-SWAP`;
  const [c4, c1] = await Promise.all([candles(inst, "4H", 300), candles(inst, "1H", 300)]);
  const h4 = c4.filter((c) => c.closed), h1 = c1.filter((c) => c.closed);
  const s4 = swings(h4), s1 = swings(h1);
  return { coin, trend4h: trendOf(h4, s4.highs, s4.lows), trend1h: trendOf(h1, s1.highs, s1.lows) };
}
