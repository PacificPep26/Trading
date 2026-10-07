import { candles, funding, openInterest, ticker, type Candle } from "@/lib/okx";

const INSTRUMENTS = ["SOL-USDT-SWAP", "BTC-USDT-SWAP", "ETH-USDT-SWAP", "HYPE-USDT-SWAP"];
const BARS = ["15m", "1H", "4H"];

type Alert = { level: "warn" | "info"; text: string };

function volumeRatio(cs: Candle[]): number | null {
  const closed = cs.filter((c) => c.closed);
  if (closed.length < 21) return null;
  const last = closed[closed.length - 1];
  const prev = closed.slice(-21, -1);
  return last.v / (prev.reduce((s, c) => s + c.v, 0) / prev.length);
}

function lastClosedMove(cs: Candle[]): number | null {
  const closed = cs.filter((c) => c.closed);
  const last = closed[closed.length - 1];
  return last ? last.c / last.o - 1 : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const inst = INSTRUMENTS.includes(url.searchParams.get("inst") ?? "") ? url.searchParams.get("inst")! : INSTRUMENTS[0];
  const bar = BARS.includes(url.searchParams.get("bar") ?? "") ? url.searchParams.get("bar")! : "15m";

  try {
    const [cs, tk, fr, oi, btc1h] = await Promise.all([
      candles(inst, bar, 120),
      ticker(inst),
      funding(inst),
      openInterest(inst),
      candles("BTC-USDT-SWAP", "1H", 30),
    ]);

    const alerts: Alert[] = [];
    const vr = volumeRatio(cs);
    if (vr !== null && vr >= 3) alerts.push({ level: "warn", text: `Khối lượng nến ${bar} vừa đóng gấp ${vr.toFixed(1)} lần trung bình 20 nến: có thể đang quét thanh lý hoặc có tin.` });
    const btcMove = lastClosedMove(btc1h);
    if (btcMove !== null && Math.abs(btcMove) >= 0.01) alerts.push({ level: "warn", text: `BTC vừa ${btcMove > 0 ? "tăng" : "giảm"} ${(btcMove * 100).toFixed(2)}% trong 1 giờ. Altcoin thường chạy theo cùng lúc.` });
    if (Math.abs(fr.rate) >= 0.0003) alerts.push({ level: "warn", text: `Funding ${(fr.rate * 100).toFixed(3)}%: phe ${fr.rate > 0 ? "long" : "short"} đang đông, dễ bị quét ngược.` });
    if (alerts.length === 0) alerts.push({ level: "info", text: "Chưa có tín hiệu bất thường (khối lượng, BTC 1h, funding)." });

    return Response.json({
      inst, bar, ticker: tk, funding: fr, openInterest: oi, candles: cs,
      volumeRatio: vr, btc1hMove: btcMove, btcLast: btc1h[btc1h.length - 1]?.c ?? null,
      alerts, fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Lỗi không xác định" }, { status: 502 });
  }
}
