/**
 * MARKET_HISTORY.JS - Toàn bộ lịch sử nến NGÀY: OKX từ lúc niêm yết hợp đồng; BTC/ETH nối thêm Bitstamp
 * (BTC từ 2011, ETH từ 2017) để thấy nhiều chu kỳ. Nến trả về đã qua normalizeCandle, chỉ gồm ngày đã đóng.
 * shortcut: nối giá spot USD (Bitstamp) với hợp đồng USDT (OKX), lệch nhỏ, đủ cho bối cảnh lớn; bộ nhớ đệm 6 giờ.
 */
import { normalizeCandle } from './indicators.js';
import { buildMacroContext } from './strategies/macro_context.js';

const DAY = 86400000, TTL = 6 * 3600 * 1000, BITSTAMP = { BTC: 'btcusd', ETH: 'ethusd' };
const cache = new Map(), sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
  return r.json();
}

async function okxDaily(coin) {
  const out = []; let after = '';
  for (let i = 0; i < 60; i++) { // 60 x 100 nến ~ 16 năm, đủ cho mọi hợp đồng
    const j = await getJson(`https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT-SWAP&bar=1Dutc&limit=100${after ? '&after=' + after : ''}`);
    if (!Array.isArray(j.data) || !j.data.length) break;
    out.push(...j.data); after = j.data[j.data.length - 1][0];
    await sleep(120); // giới hạn tốc độ của OKX
  }
  return out.map(normalizeCandle).sort((a, b) => a.ts - b.ts);
}

async function bitstampDaily(pair, beforeTs) {
  const rows = []; let start = 1300000000;
  for (let i = 0; i < 40; i++) {
    const j = await getJson(`https://www.bitstamp.net/api/v2/ohlc/${pair}/?step=86400&limit=1000&start=${start}`);
    const o = j.data && j.data.ohlc;
    if ((!o || !o.length) && !rows.length && start < beforeTs / 1000) { start += 365 * 86400; continue; } // cặp chưa niêm yết ở mốc start: nhảy tiến từng năm
    if (!o || !o.length) break;
    rows.push(...o); start = Number(o[o.length - 1].timestamp) + 86400;
    if (o.length < 1000) break;
    await sleep(120);
  }
  return rows.filter(r => Number(r.timestamp) * 1000 < beforeTs)
    .map(r => normalizeCandle([String(Number(r.timestamp) * 1000), r.open, r.high, r.low, r.close, r.volume, r.volume, r.volume, '1']));
}

/** Nến ngày đã đóng, tăng dần theo thời gian, từ xa nhất có thể. */
export async function loadDailyHistory(coin) {
  const hit = cache.get(coin);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const okx = await okxDaily(coin);
  let all = okx;
  if (BITSTAMP[coin] && okx.length) { try { all = [...(await bitstampDaily(BITSTAMP[coin], okx[0].ts)), ...okx]; } catch { /* Bitstamp lỗi thì dùng riêng OKX */ } }
  const v = all.filter(c => c.ts + DAY <= Date.now());
  cache.set(coin, { t: Date.now(), v });
  return v;
}

/** Bối cảnh lớn của một coin ('BTC'...), null nếu không lấy được dữ liệu. */
export async function getMacroContext(coin) {
  try { const d1 = await loadDailyHistory(coin); return { ...buildMacroContext(d1), source: d1 }; } catch (e) { console.error(`[MACRO] ${coin}:`, e.message); return null; }
}
