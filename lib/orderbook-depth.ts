// Phân tích độ sâu sổ lệnh 100 tầng (Orderbook Imbalance & Tường thanh khoản Limit Walls)
import { orderbookDepth } from "./okx.ts";

export interface OrderbookAnalysis {
  coin: string;
  bidAskRatio: number;      // Tỷ lệ Tổng Mua / Tổng Bán trong 100 tầng
  strongestBidWallPrice?: number; // Mức giá của tường mua khổng lồ nhất
  strongestBidWallVol?: number;
  strongestAskWallPrice?: number; // Mức giá của tường bán khổng lồ nhất
  strongestAskWallVol?: number;
  isBidWallGuarded: boolean; // Có tường mua lớn đỡ giá gần entry?
  isAskWallBlocking: boolean; // Có tường bán lớn chặn đường lên?
}

const obCache = new Map<string, { data: OrderbookAnalysis; exp: number }>();

export async function getOrderbookAnalysis(coin: string, currentPrice?: number): Promise<OrderbookAnalysis | null> {
  const now = Date.now();
  const cached = obCache.get(coin);
  if (cached && cached.exp > now) return cached.data;

  try {
    const instId = `${coin}-USDT-SWAP`;
    const book = await orderbookDepth(instId, 100).catch(() => null);
    if (!book || !book.bids.length || !book.asks.length) return null;

    const totalBidVol = book.bids.reduce((s, b) => s + b.vol, 0);
    const totalAskVol = book.asks.reduce((s, a) => s + a.vol, 0);
    const bidAskRatio = totalAskVol > 0 ? totalBidVol / totalAskVol : 1;

    // Tìm tường mua/bán nổi bật (lớn hơn 3.5 lần khối lượng trung bình mỗi tầng)
    const avgBidVol = totalBidVol / book.bids.length;
    const avgAskVol = totalAskVol / book.asks.length;

    const bidWalls = book.bids.filter((b) => b.vol >= 3.5 * avgBidVol);
    const askWalls = book.asks.filter((a) => a.vol >= 3.5 * avgAskVol);

    const strongestBid = bidWalls.sort((a, b) => b.vol - a.vol)[0];
    const strongestAsk = askWalls.sort((a, b) => b.vol - a.vol)[0];

    const refPrice = currentPrice ?? book.bids[0].price;

    // Tường mua bảo vệ: nằm dưới giá hiện tại trong khoảng 0.3% - 2.5%
    const isBidWallGuarded = strongestBid ? (refPrice - strongestBid.price) / refPrice >= 0.003 && (refPrice - strongestBid.price) / refPrice <= 0.025 : false;

    // Tường bán cản đường: nằm ngay trên đầu trong khoảng 0.2% - 1.2%
    const isAskWallBlocking = strongestAsk ? (strongestAsk.price - refPrice) / refPrice >= 0.002 && (strongestAsk.price - refPrice) / refPrice <= 0.012 : false;

    const result: OrderbookAnalysis = {
      coin,
      bidAskRatio,
      strongestBidWallPrice: strongestBid?.price,
      strongestBidWallVol: strongestBid?.vol,
      strongestAskWallPrice: strongestAsk?.price,
      strongestAskWallVol: strongestAsk?.vol,
      isBidWallGuarded,
      isAskWallBlocking,
    };

    obCache.set(coin, { data: result, exp: now + 3 * 60_000 });
    return result;
  } catch (err) {
    console.error(`[ORDERBOOK] Lỗi phân tích ${coin}:`, err);
    return null;
  }
}

/**
 * Đánh giá điều kiện Orderbook cho hướng vào lệnh:
 * - LONG: nếu có tường mua đỡ bên dưới (isBidWallGuarded) hoặc tổng Bid áp đảo (>= 1.5) -> CỘNG ĐIỂM
 * - LONG: nếu có tường bán chặn ngay trên đầu (isAskWallBlocking) -> TRỪ ĐIỂM
 */
export function evaluateOrderbookSignal(
  side: 1 | -1,
  ob: OrderbookAnalysis | null
): { scoreBonus: number; reason?: string; suggestedStop?: number } {
  if (!ob) return { scoreBonus: 0 };

  if (side > 0) {
    if (ob.isAskWallBlocking) {
      return {
        scoreBonus: -1,
        reason: `Tường bán cản @${ob.strongestAskWallPrice}`,
      };
    }
    if (ob.isBidWallGuarded || ob.bidAskRatio >= 1.4) {
      return {
        scoreBonus: 1,
        reason: `Tường mua đỡ (Bids x${ob.bidAskRatio.toFixed(1)}${ob.strongestBidWallPrice ? ` @${ob.strongestBidWallPrice}` : ""})`,
        suggestedStop: ob.strongestBidWallPrice ? ob.strongestBidWallPrice * 0.999 : undefined,
      };
    }
  } else {
    // SHORT:
    if (ob.isBidWallGuarded) {
      return {
        scoreBonus: -1,
        reason: `Tường mua cản đường Short @${ob.strongestBidWallPrice}`,
      };
    }
    if (ob.isAskWallBlocking || ob.bidAskRatio <= 0.7) {
      return {
        scoreBonus: 1,
        reason: `Tường bán ép giá (Asks x${(1 / ob.bidAskRatio).toFixed(1)}${ob.strongestAskWallPrice ? ` @${ob.strongestAskWallPrice}` : ""})`,
        suggestedStop: ob.strongestAskWallPrice ? ob.strongestAskWallPrice * 1.001 : undefined,
      };
    }
  }

  return { scoreBonus: 0 };
}
