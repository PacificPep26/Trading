import { evaluatePosition, scan, summarizeFrame, type PositionInput } from "@/lib/analysis";
import { fetchNews } from "@/lib/news";
import { candles, funding, longShortRatio, openInterest, openInterestHistory, ticker } from "@/lib/okx";

const INSTRUMENTS = new Set(["SOL-USDT-SWAP", "BTC-USDT-SWAP", "ETH-USDT-SWAP", "HYPE-USDT-SWAP"]);

function positionFrom(url: URL): PositionInput | null {
  const side = url.searchParams.get("side");
  if (side !== "long" && side !== "short") return null;
  const values = ["entry", "tp", "sl", "margin", "leverage"].map((k) => Number(url.searchParams.get(k)));
  if (values.some((x) => !Number.isFinite(x) || x <= 0)) return null;
  return { side, entry: values[0], tp: values[1], sl: values[2], margin: values[3], leverage: values[4] };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const inst = INSTRUMENTS.has(url.searchParams.get("inst") ?? "") ? url.searchParams.get("inst")! : "SOL-USDT-SWAP";
  const ccy = inst.split("-")[0];
  try {
    const [c15, c1h, c4h, btc1h, tk, fr, oi, oiHistory, ratios, news] = await Promise.all([
      candles(inst, "15m", 300), candles(inst, "1H", 300), candles(inst, "4H", 300), candles("BTC-USDT-SWAP", "1H", 30),
      ticker(inst), funding(inst), openInterest(inst), openInterestHistory(ccy), longShortRatio(ccy), fetchNews(),
    ]);
    const frames = { "15m": summarizeFrame(c15, "15m"), "1H": summarizeFrame(c1h, "1H"), "4H": summarizeFrame(c4h, "4H") };
    const btcClosed = btc1h.filter((c) => c.closed);
    // stats bucket BTC by its 1h return (4 x 15m bars), see build_analysis_stats.py
    const btcReturn1h = btcClosed.at(-1)!.c / btcClosed.at(-2)!.c - 1;
    const position = positionFrom(url);
    const oiChange4h = oiHistory.length >= 5 ? oiHistory[0].oiUsd / oiHistory[4].oiUsd - 1 : null;
    return Response.json({
      inst, ticker: tk, funding: fr, openInterest: oi, oiHistory, oiChange4h,
      longShortRatio: ratios[0]?.ratio ?? null, longShortHistory: ratios,
      candles: { "15m": c15, "1H": c1h, "4H": c4h }, frames, btcReturn1h,
      scanner: scan(inst, frames["15m"], btcReturn1h),
      positionAnalysis: position ? evaluatePosition(inst, frames["15m"], btcReturn1h, tk.last, position, frames["1H"]) : null,
      news, fetchedAt: Date.now(),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không phân tích được thị trường" }, { status: 502 });
  }
}
