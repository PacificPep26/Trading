/**
 * DERIVATIVES_DATA.JS
 * Module nghiên cứu & phân tích Dữ liệu Vi cấu trúc Phái sinh (OKX Public API):
 * 1. Open Interest (OI) History (/api/v5/rubik/stat/contracts/open-interest-history)
 * 2. Funding Rate History (/api/v5/public/funding-rate-history)
 * 
 * Mục đích:
 * - Xác nhận cú quét thanh khoản thật (True Liquidation Sweep):
 *   Khi giá quét râu đáy H4 VÀ OI sụt giảm mạnh (Long Flush) -> cá mập hấp thụ thanh khoản thật.
 * - Nhận diện độ lệch đám đông (Funding Rate Extreme):
 *   Funding rate âm sâu -> Retail đang FOMO Short ở đáy -> Khả năng Short Squeeze cao.
 */

import { BOT_CONFIG } from '../config.js';

const OKX_BASE_URL = BOT_CONFIG.okxBaseUrl || 'https://www.okx.com';

/**
 * Fetch lịch sử Open Interest từ OKX Rubik API
 * @param {string} instId - Ví dụ: 'BTC-USDT-SWAP'
 * @param {string} period - '1H' | '1D'
 * @param {number} limit - Tối đa 100
 * @returns {Promise<Array<{ ts: number, oi: number, oiCcy: number }>>}
 */
export async function fetchOpenInterestHistory(instId, period = '1H', limit = 100) {
  const cleanInstId = instId.includes('-SWAP') ? instId : `${instId}-SWAP`;
  const url = `${OKX_BASE_URL}/api/v5/rubik/stat/contracts/open-interest-history?instId=${cleanInstId}&period=${period}&limit=${limit}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];

    // Dữ liệu OKX trả về: [ [ts, oi, oiCcy], ... ] sắp xếp từ mới -> cũ
    return json.data.map(item => ({
      ts: parseInt(item[0], 10),
      oi: parseFloat(item[1]),
      oiCcy: parseFloat(item[2])
    })).reverse(); // Đảo lại theo thứ tự thời gian tăng dần
  } catch (err) {
    console.error(`[DERIVATIVES] Lỗi fetch Open Interest ${cleanInstId}:`, err.message);
    return [];
  }
}

/**
 * Fetch lịch sử Funding Rate từ OKX Public API
 * @param {string} instId - Ví dụ: 'BTC-USDT-SWAP'
 * @param {number} limit - Tối đa 100
 * @returns {Promise<Array<{ ts: number, fundingRate: number, fundingTime: number }>>}
 */
export async function fetchFundingRateHistory(instId, limit = 100) {
  const cleanInstId = instId.includes('-SWAP') ? instId : `${instId}-SWAP`;
  const url = `${OKX_BASE_URL}/api/v5/public/funding-rate-history?instId=${cleanInstId}&limit=${limit}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];

    return json.data.map(item => ({
      ts: parseInt(item.fundingTime, 10),
      fundingRate: parseFloat(item.fundingRate),
      realizedRate: parseFloat(item.realizedRate || item.fundingRate)
    })).reverse();
  } catch (err) {
    console.error(`[DERIVATIVES] Lỗi fetch Funding Rate ${cleanInstId}:`, err.message);
    return [];
  }
}

/**
 * Phân tích cú sụt giảm OI đột ngột (Liquidation Flush Analysis)
 * @param {Array<{ ts: number, oi: number }>} oiHistory
 * @param {number} lookback - Chu kỳ so sánh
 * @param {number} dropThresholdPct - Ngưỡng sụt giảm % (mặc định -2.0%)
 * @returns {{ hasFlush: boolean, dropPct: number, currentOi: number, prevOi: number }}
 */
export function analyzeOiFlush(oiHistory, lookback = 3, dropThresholdPct = -2.0) {
  if (!oiHistory || oiHistory.length < lookback + 1) {
    return { hasFlush: false, dropPct: 0, currentOi: 0, prevOi: 0 };
  }

  const cur = oiHistory[oiHistory.length - 1];
  const prev = oiHistory[oiHistory.length - 1 - lookback];

  if (!prev || prev.oi <= 0) {
    return { hasFlush: false, dropPct: 0, currentOi: cur.oi, prevOi: 0 };
  }

  const dropPct = ((cur.oi - prev.oi) / prev.oi) * 100;
  const hasFlush = dropPct <= dropThresholdPct;

  return {
    hasFlush,
    dropPct: parseFloat(dropPct.toFixed(2)),
    currentOi: cur.oi,
    prevOi: prev.oi
  };
}

