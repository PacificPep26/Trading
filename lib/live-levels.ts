// Pullback zones for the owner's trend-riding plan (same rules as service/scripts/trend_ride_study.py):
// 4h and 1h structure agree -> wait for price to come back into the zone between the 1h EMA20 and the
// last 1h swing (high for shorts, low for longs) -> enter on a closed 15m rejection candle.
import { candles, type Candle } from "@/lib/okx";
import { swings, trendOf } from "@/lib/patterns";

export type Zone = {
  coin: string;
  side: 1 | -1;
  zoneLow: number;
  zoneHigh: number;
  stop: number;
  target2: number; // opposite 1h swing: next structural target
  ema20: number;
  swing: number;
  stopPct: number; // stop distance from the zone edge where entries happen
  last15m: Candle | null; // last closed 15m candle when the levels were computed
};

const STOP_BUFFER = 0.002; // 0.2% beyond the 1h swing, as in the SOL plan (swing 117.17 -> stop 117.4)

function ema(values: number[], n: number) {
  const k = 2 / (n + 1);
  return values.reduce((acc, v, i) => (i === 0 ? v : acc + k * (v - acc)), values[0]);
}

export async function zoneFor(coin: string): Promise<{ coin: string; trend4h: number; trend1h: number; zone: Zone | null; last15m: Candle | null }> {
  const inst = `${coin}-USDT-SWAP`;
  const [c4, c1, c15] = await Promise.all([candles(inst, "4H", 300), candles(inst, "1H", 300), candles(inst, "15m", 3)]);
  const h4 = c4.filter((c) => c.closed), h1 = c1.filter((c) => c.closed);
  const s4 = swings(h4), s1 = swings(h1);
  const trend4h = trendOf(h4, s4.highs, s4.lows), trend1h = trendOf(h1, s1.highs, s1.lows);
  const last15m = c15.filter((c) => c.closed).at(-1) ?? null;
  if (trend4h === 0 || trend4h !== trend1h || !s1.highs.length || !s1.lows.length) return { coin, trend4h, trend1h, zone: null, last15m };

  const side = trend4h as 1 | -1;
  const e20 = ema(h1.map((c) => c.c), 20);
  const swingHigh = h1[s1.highs.at(-1)!].h, swingLow = h1[s1.lows.at(-1)!].l;
  const swing = side < 0 ? swingHigh : swingLow;
  const zoneLow = Math.min(e20, swing), zoneHigh = Math.max(e20, swing);
  const stop = side < 0 ? zoneHigh * (1 + STOP_BUFFER) : zoneLow * (1 - STOP_BUFFER);
  const edge = side < 0 ? zoneLow : zoneHigh; // entries start at the near edge of the zone
  return {
    coin, trend4h, trend1h, last15m,
    zone: { coin, side, zoneLow, zoneHigh, stop, target2: side < 0 ? swingLow : swingHigh, ema20: e20, swing, stopPct: Math.abs(stop - edge) / edge, last15m },
  };
}
