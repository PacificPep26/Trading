// Phân tích dòng vốn phái sinh & bẫy thanh lý (Open Interest, Long/Short Ratio, Funding Rate)
import { openInterestHistory, longShortRatio, funding } from "./okx.ts";

export interface DerivativesFlow {
  coin: string;
  oiChange4hPct: number;    // Thay đổi OI 4 giờ qua (%)
  oiChange1hPct: number;    // Thay đổi OI 1 giờ qua (%)
  lsrCurrent: number;       // Tỷ lệ tài khoản Long/Short hiện tại
  lsrAvg4h: number;         // Tỷ lệ LSR trung bình 4 giờ qua
  fundingRate: number;      // Tỷ lệ funding rate hiện tại
  isCrowdedLong: boolean;   // Đám đông đang fomo Long quá đông?
  isCrowdedShort: boolean;  // Đám đông đang fomo Short quá đông?
  isOiSurging: boolean;     // OI đang phình to đột biến?
}

// Bộ nhớ đệm 5 phút tránh spam API
const cache = new Map<string, { data: DerivativesFlow; exp: number }>();

export async function getDerivativesFlow(coin: string): Promise<DerivativesFlow | null> {
  const now = Date.now();
  const cached = cache.get(coin);
  if (cached && cached.exp > now) return cached.data;

  try {
    const [oiHist, lsrHist, fData] = await Promise.all([
      openInterestHistory(coin, "1H").catch(() => []),
      longShortRatio(coin, "1H").catch(() => []),
      funding(`${coin}-USDT-SWAP`).catch(() => ({ rate: 0, nextTime: 0 })),
    ]);

    if (!oiHist.length || !lsrHist.length) return null;

    // Tính biến động OI
    const currentOi = oiHist[0].oiUsd;
    const oi1hAgo = oiHist[1]?.oiUsd ?? currentOi;
    const oi4hAgo = oiHist[4]?.oiUsd ?? oi1hAgo;

    const oiChange1hPct = oi1hAgo > 0 ? (currentOi - oi1hAgo) / oi1hAgo : 0;
    const oiChange4hPct = oi4hAgo > 0 ? (currentOi - oi4hAgo) / oi4hAgo : 0;

    // Tính tỷ lệ Long/Short
    const lsrCurrent = lsrHist[0]?.ratio ?? 1;
    const lsrAvg4h = lsrHist.slice(0, 4).reduce((s, x) => s + x.ratio, 0) / Math.min(4, lsrHist.length);

    // Điều kiện đám đông bị dồn toa (Crowded trades)
    // Long quá đông: LSR > 1.35 hoặc (LSR > 1.2 kèm Funding Rate dương cao > 0.015%)
    const isCrowdedLong = lsrCurrent > 1.35 || (lsrCurrent > 1.2 && fData.rate > 0.00015);
    // Short quá đông: LSR < 0.75 hoặc Funding Rate âm sâu < -0.015%
    const isCrowdedShort = lsrCurrent < 0.75 || (lsrCurrent < 0.85 && fData.rate < -0.00015);

    // OI tăng vọt >= 5% trong 4h hoặc >= 3% trong 1h
    const isOiSurging = oiChange4hPct >= 0.05 || oiChange1hPct >= 0.03;

    const result: DerivativesFlow = {
      coin,
      oiChange4hPct,
      oiChange1hPct,
      lsrCurrent,
      lsrAvg4h,
      fundingRate: fData.rate,
      isCrowdedLong,
      isCrowdedShort,
      isOiSurging,
    };

    cache.set(coin, { data: result, exp: now + 5 * 60_000 });
    return result;
  } catch (err) {
    console.error(`[DERIVATIVES FLOW] Lỗi lấy dữ liệu ${coin}:`, err);
    return null;
  }
}

/**
 * Kiểm tra xem có bẫy thanh lý (Liquidation Trap) ngược chiều với lệnh dự kiến hay không.
 * Nếu muốn LONG nhưng đám đông đang bị kẹt Long quá dày + OI tăng vọt -> BẪY THANH LÝ LONG.
 */
export function evaluateLiquidationRisk(
  side: 1 | -1,
  flow: DerivativesFlow | null
): { isTrap: boolean; scoreBonus: number; warningReason?: string } {
  if (!flow) return { isTrap: false, scoreBonus: 0 };

  // 1. CẢNH BÁO BẪY ĐÒN BẨY ĐÁM ĐÔNG (Crowded Trap)
  if (side > 0) {
    // Muốn LONG nhưng đám đông fomo Long quá mức và OI đang phình to
    if (flow.isCrowdedLong && flow.isOiSurging) {
      return {
        isTrap: true,
        scoreBonus: -1,
        warningReason: `Bẫy Long (LSR ${flow.lsrCurrent.toFixed(2)}, OI +${(flow.oiChange4hPct * 100).toFixed(1)}%)`,
      };
    }
    // Nếu Short đang bị kẹt (LSR thấp / Short đông) mà giá bắt đầu hồi -> Tiềm năng SHORT SQUEEZE (Cộng điểm mạnh!)
    if (flow.isCrowdedShort) {
      return {
        isTrap: false,
        scoreBonus: 1,
        warningReason: `Tiềm năng Short Squeeze (LSR ${flow.lsrCurrent.toFixed(2)})`,
      };
    }
  } else {
    // Muốn SHORT nhưng đám đông fomo Short quá mức và OI đang phình to
    if (flow.isCrowdedShort && flow.isOiSurging) {
      return {
        isTrap: true,
        scoreBonus: -1,
        warningReason: `Bẫy Short (LSR ${flow.lsrCurrent.toFixed(2)}, OI +${(flow.oiChange4hPct * 100).toFixed(1)}%)`,
      };
    }
    // Nếu Long đang bị kẹt mà giá thủng hỗ trợ -> Tiềm năng LONG LIQUIDATION CASCADE (Cộng điểm mạnh!)
    if (flow.isCrowdedLong) {
      return {
        isTrap: false,
        scoreBonus: 1,
        warningReason: `Tiềm năng Long Flush (LSR ${flow.lsrCurrent.toFixed(2)})`,
      };
    }
  }

  return { isTrap: false, scoreBonus: 0 };
}

