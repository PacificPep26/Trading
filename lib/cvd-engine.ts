// Phân tích Cumulative Volume Delta (CVD) & Phát hiện Phân kỳ dòng tiền (Absorption Divergence)
import { takerVolumeContract } from "./okx.ts";

export interface CvdAnalysis {
  coin: string;
  delta1h: number;         // Delta giờ gần nhất (Buy Vol - Sell Vol)
  delta4hTotal: number;    // Tổng delta 4 giờ qua
  isCvdAccumulating: boolean; // CVD dốc lên mạnh (Phe mua chủ động gom)
  isCvdDistributing: boolean; // CVD dốc xuống mạnh (Phe bán chủ động xả)
  ratioBuySell4h: number;  // Tỷ lệ Tổng Mua / Tổng Bán trong 4h
}

const cvdCache = new Map<string, { data: CvdAnalysis; exp: number }>();

export async function getCvdAnalysis(coin: string): Promise<CvdAnalysis | null> {
  const now = Date.now();
  const cached = cvdCache.get(coin);
  if (cached && cached.exp > now) return cached.data;

  try {
    const instId = `${coin}-USDT-SWAP`;
    const rows = await takerVolumeContract(instId, "1H").catch(() => []);
    if (!rows.length) return null;

    // rows[0] là giờ gần nhất
    const delta1h = rows[0].buyVol - rows[0].sellVol;

    const recent4 = rows.slice(0, 4);
    const totalBuy4h = recent4.reduce((s, r) => s + r.buyVol, 0);
    const totalSell4h = recent4.reduce((s, r) => s + r.sellVol, 0);
    const delta4hTotal = totalBuy4h - totalSell4h;

    const ratioBuySell4h = totalSell4h > 0 ? totalBuy4h / totalSell4h : 1;

    // Gom hàng ngầm: Tỷ lệ mua/bán > 1.15 hoặc Delta 4h dương mạnh
    const isCvdAccumulating = ratioBuySell4h >= 1.15 || (delta4hTotal > 0 && delta1h > 0);
    // Xả hàng ngầm: Tỷ lệ mua/bán < 0.85 hoặc Delta 4h âm sâu
    const isCvdDistributing = ratioBuySell4h <= 0.85 || (delta4hTotal < 0 && delta1h < 0);

    const result: CvdAnalysis = {
      coin,
      delta1h,
      delta4hTotal,
      isCvdAccumulating,
      isCvdDistributing,
      ratioBuySell4h,
    };

    cvdCache.set(coin, { data: result, exp: now + 5 * 60_000 });
    return result;
  } catch (err) {
    console.error(`[CVD ENGINE] Lỗi phân tích ${coin}:`, err);
    return null;
  }
}

/**
 * Đánh giá phân kỳ CVD so với hành vi giá (Absorption Divergence):
 * - Giá đi ngang / giảm nhẹ ở hỗ trợ nhưng CVD mua chủ động dốc lên -> CÁ VOI GOM NGẦM (Cộng điểm mạnh!)
 * - Giá kéo lên cản nhưng CVD dốc xuống (bán chủ động nhiều hơn mua) -> KÉO XẢ BẪY BULLTRAP (Trừ điểm / Chặn Long)
 */
export function evaluateCvdSignal(
  side: 1 | -1,
  cvd: CvdAnalysis | null
): { scoreBonus: number; reason?: string } {
  if (!cvd) return { scoreBonus: 0 };

  if (side > 0) {
    // Muốn LONG:
    if (cvd.isCvdAccumulating) {
      return {
        scoreBonus: 1,
        reason: `CVD gom ngầm (Taker Buy ${(cvd.ratioBuySell4h * 100 - 100 >= 0 ? "+" : "")}${(cvd.ratioBuySell4h * 100 - 100).toFixed(0)}%)`,
      };
    }
    if (cvd.isCvdDistributing) {
      return {
        scoreBonus: -1,
        reason: `CVD xả ngầm (Taker Sell áp đảo)`,
      };
    }
  } else {
    // Muốn SHORT:
    if (cvd.isCvdDistributing) {
      return {
        scoreBonus: 1,
        reason: `CVD xả chủ động (Taker Sell áp đảo)`,
      };
    }
    if (cvd.isCvdAccumulating) {
      return {
        scoreBonus: -1,
        reason: `CVD gom ngầm cản đường Short`,
      };
    }
  }

  return { scoreBonus: 0 };
}

