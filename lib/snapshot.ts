// Trạng thái 3 kèo của 1 coin (web /api/watchlist và lệnh gõ tên coin trên Telegram dùng chung).
import { candles, ticker } from "@/lib/okx";
import { analyse } from "@/lib/patterns";
import { loadLimits, type RestingLimit } from "@/lib/resting-limit";
import { loadSwings, type Swing } from "@/lib/swing-4h";
import { ICT_PAPER, dailyTrend } from "@/lib/telegram-alerts";

export type Snapshot = {
  coin: string;
  price: number | null;
  daily: 1 | -1 | 0;
  ict?: RestingLimit; // 🎯 đang chờ khớp / đang mở
  limit?: RestingLimit; // 📌 đang chờ khớp / đang mở
  swing?: Swing; // 📊 4H đang mở
  pending4h: { side: 1 | -1; trigger: number; stop: number; distancePct: number }[]; // hai đỉnh/đáy 4H chờ nến đóng qua neckline
};

const active = (x: RestingLimit, coin: string) => x.coin === coin && (x.status === "pending" || x.status === "open");

export async function coinSnapshot(coin: string): Promise<Snapshot> {
  const [bars4h, daily, t] = await Promise.all([
    candles(`${coin}-USDT-SWAP`, "4H", 300), dailyTrend(coin), ticker(`${coin}-USDT-SWAP`).catch(() => null),
  ]);
  return {
    coin,
    price: t?.last ?? null,
    daily,
    ict: loadLimits(ICT_PAPER).find((x) => active(x, coin)),
    limit: loadLimits().find((x) => active(x, coin)),
    swing: loadSwings().find((x) => x.coin === coin && x.status === "open"),
    pending4h: analyse(bars4h).setups
      .filter((s) => s.style === "double_top_bottom" && s.state === "pending")
      .map((s) => ({ side: s.side, trigger: s.entry, stop: s.stop, distancePct: s.distancePct })),
  };
}
