// Trang xem kịch bản: lấy nến OKX trực tiếp, chạy đúng engine/radar của bot, ghép lệnh thật từ API của bot.
import './env.mjs';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { normalizeCandle } from './src/indicators.js';
import { generateKeyLevelRadar } from './src/strategies/radar.js';
import { evaluateMarket } from './src/engine.js';
import { BOT_CONFIG } from './src/config.js';
import { loadDailyHistory } from './src/market_history.js';
import { atr as atrOf, buildLevels, mergeZones, pickKeyLevels, planScenarios, planPattern, planBranches } from './src/strategies/scenario_planner.js';
import { analyzeVolume, buildVerdict } from './src/strategies/verdict.js';
import { buildMacroContext, resample } from './src/strategies/macro_context.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const COINS = ['BTC', 'ETH', 'SOL', 'LINK', 'NEAR', 'HYPE'];
const BARS = { '15m': '15m', '1H': '1H', '4H': '4H', '1D': '1Dutc', '1W': null, '1M': null }; // 1W/1M gộp từ toàn bộ nến ngày
const OKX = 'https://www.okx.com/api/v5/market/candles';
const cache = new Map();

async function okx(inst, bar, limit = 300) {
  const r = await fetch(`${OKX}?instId=${inst}-USDT-SWAP&bar=${bar}&limit=${limit}`);
  const j = await r.json();
  if (!Array.isArray(j.data)) throw new Error(`OKX không trả nến ${inst} ${bar}`);
  return j.data.map(normalizeCandle).reverse();
}
const closed = (c) => c.filter(x => x.confirm === 1);

function buildLines(radar, macro) {
  const l = [{ price: radar.ema34, label: 'EMA34 H4', color: '#f59e0b' }, { price: radar.ema89, label: 'EMA89 H4', color: '#a78bfa' }];
  const m = radar.macroRange;
  if (m) l.push({ price: m.rangeHigh, label: 'Trần hộp vĩ mô', color: '#ef4444' }, { price: m.rangeLow, label: 'Sàn hộp vĩ mô', color: '#22c55e' }, { price: m.equilibrium, label: 'Trục giữa hộp', color: '#94a3b8' });
  if (macro && macro.levels) {
    const L = macro.levels;
    l.push({ price: L.ath, label: 'Đỉnh lịch sử', color: '#fbbf24' }, { price: L.yearOpen, label: 'Mở cửa năm', color: '#38bdf8' }, { price: L.monthOpen, label: 'Mở cửa tháng', color: '#60a5fa' }, { price: L.weekOpen, label: 'Mở cửa tuần', color: '#93c5fd' });
    if (L.prevMonthHigh) l.push({ price: L.prevMonthHigh, label: 'Đỉnh tháng trước', color: '#fb7185' }, { price: L.prevMonthLow, label: 'Đáy tháng trước', color: '#4ade80' });
  }
  return l.filter(x => x.price);
}

// Kịch bản + cách vào lệnh bằng chữ, chỉ dựa trên số thật của radar/engine.
function buildPlaybook(radar, signal) {
  const f = (v) => (v >= 1000 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(4));
  const steps = [];
  if (signal && !signal.isBlocked) {
    const dir = signal.direction === 'LONG' ? 'Long' : 'Short';
    steps.push(`Bot đang có tín hiệu ${dir} (${signal.strategy}).`, `Vào lệnh tại ${f(signal.entry)}, cắt lỗ ${f(signal.stopLoss)}, chốt lời ${f(signal.takeProfit)} (R:R ${signal.riskReward}).`, 'Bot chờ thêm 4 nến M15 (60 phút) để xác nhận rồi mới vào lệnh thật; nếu SL/TP gốc bị chạm trong lúc chờ thì hủy.');
  } else {
    const side = radar.radarStatus === 'APPROACHING_RESISTANCE' ? 'Short' : radar.radarStatus === 'APPROACHING_SUPPORT' ? 'Long' : null;
    if (side) {
      const lvl = side === 'Short' ? radar.nearestRes : radar.nearestSup;
      steps.push(`Giá áp sát ${side === 'Short' ? 'kháng cự' : 'hỗ trợ'} ${f(lvl)}.`, `Chỉ canh ${side} khi nến M15 thọc qua mốc ${f(lvl)} rồi ĐÓNG CỬA quay lại kèm râu dài và volume hấp thụ.`, 'Không vào khi nến chưa đóng; SL đặt ngoài đỉnh/đáy của cú quét.');
    } else steps.push('Giá đang ở giữa vùng, chưa có kịch bản. Chờ giá tới cản hoặc hỗ trợ.');
    if (signal && signal.isBlocked) steps.push(`Setup bị bộ lọc chặn: ${String(signal.blockReason).split(':')[0]}.`);
  }
  return { headline: radar.scenario || 'Chưa có kịch bản.', steps, plan: radar.limitPlan || null };
}

async function botState() {
  const url = process.env.BOT_API_URL, token = process.env.VIEWER_TOKEN;
  if (!url || !token) return { connected: false, reason: 'chưa cấu hình BOT_API_URL/VIEWER_TOKEN' };
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/api/state', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { connected: false, reason: `bot trả ${r.status}` };
    return { connected: true, ...(await r.json()) };
  } catch (e) { return { connected: false, reason: e.message }; }
}

// ---- Kho nến M15 từ lúc bắt đầu (gói tĩnh trong history/) + phần mới nhất lấy trực tiếp từ OKX; gộp ra 1H/4H theo yêu cầu ----
const STEP = { '15m': 900, '1H': 3600, '4H': 14400 }, INIT = 3000;
const stores = new Map(), tradesCache = new Map();
function store(coin) {
  if (!stores.has(coin)) {
    const f = path.join(ROOT, 'history', `${coin}_15m.json`);
    stores.set(coin, { base: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [], tail: new Map(), tailAt: 0, gapDone: false, cache: new Map() });
  }
  return stores.get(coin);
}
const row = (c) => [Math.floor(c.ts / 1000), c.open, c.high, c.low, c.close, c.vol];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function refreshTail(coin) { // bù phần từ cuối gói tới hiện tại + nến đang chạy (làm tươi tối đa 20 giây một lần)
  const s = store(coin);
  if (!s.base.length || Date.now() - s.tailAt < 20000) return;
  s.tailAt = Date.now();
  const lastBase = s.base[s.base.length - 1][0];
  const rows = await okx(coin, '15m', 300);
  rows.forEach(c => s.tail.set(Math.floor(c.ts / 1000), row(c)));
  if (!s.gapDone) { // gói đã cũ hơn 300 nến: lấy thêm các trang cũ hơn cho tới khi nối liền với gói
    let oldest = Math.min(...s.tail.keys()), guard = 0;
    while (oldest > lastBase + 900 && guard++ < 80) {
      const j = await (await fetch(`https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT-SWAP&bar=15m&limit=100&after=${oldest * 1000}`)).json();
      if (!Array.isArray(j.data) || !j.data.length) break;
      j.data.map(normalizeCandle).forEach(c => s.tail.set(Math.floor(c.ts / 1000), row(c)));
      oldest = Math.min(...s.tail.keys()); await sleep(120);
    }
    s.gapDone = true;
  }
  s.cache.clear();
}
function series(coin, bar) { // nến tăng dần theo thời gian: [giây, mở, cao, thấp, đóng, khối lượng]
  const s = store(coin);
  if (s.cache.has(bar)) return s.cache.get(bar);
  let m = s.base;
  if (s.tail.size) { const tail = [...s.tail.values()].sort((a, b) => a[0] - b[0]), t0 = tail[0][0]; let i = m.length; while (i > 0 && m[i - 1][0] >= t0) i--; m = m.slice(0, i).concat(tail); }
  if (bar !== '15m') {
    const out = []; let cur = null;
    for (const r of m) {
      const k = Math.floor(r[0] / STEP[bar]) * STEP[bar];
      if (cur && cur[0] === k) { cur[2] = Math.max(cur[2], r[2]); cur[3] = Math.min(cur[3], r[3]); cur[4] = r[4]; cur[5] += r[5]; }
      else { cur = [k, r[1], r[2], r[3], r[4], r[5]]; out.push(cur); }
    }
    m = out;
  }
  s.cache.set(bar, m);
  return m;
}

async function analysis(coin, bar) {
  const key = `${coin}:${bar}`, hit = cache.get(key);
  if (hit && Date.now() - hit.t < 20000) return hit.v;
  const longTf = ['1D', '1W', '1M'].includes(bar);
  const [m15, h1, h4, d1, bh1, bh4, hist] = await Promise.all([okx(coin, '15m'), okx(coin, '1H'), okx(coin, '4H'), okx(coin, '1Dutc'), okx('BTC', '1H'), okx('BTC', '4H'), loadDailyHistory(coin).catch(() => null)]);
  const macro = hist && hist.length >= 200 ? buildMacroContext(hist) : null;
  let rows;
  if (longTf && hist) rows = (bar === '1D' ? hist : resample(hist, bar === '1W' ? 'W' : 'M')).map(row);
  else {
    await refreshTail(coin).catch(() => {});
    rows = STEP[bar] ? series(coin, bar) : [];
    if (!rows.length) rows = (await okx(coin, BARS[bar] || '15m')).map(row); // chưa có gói lịch sử: dùng 300 nến gần nhất
  }
  const price = m15[m15.length - 1].close;
  const initial = longTf ? rows : rows.slice(-INIT);
  // vùng + kịch bản tính từ CHÍNH cấu trúc của khung đang xem (không dùng chung vùng H4 cho mọi khung)
  const TFCFG = { '15m': [800, 0.04], '1H': [800, 0.08], '4H': [700, 0.12], '1D': [700, 0.3], '1W': [400, 0.6], '1M': [200, 0.9] }[bar];
  const win = rows.slice(-TFCFG[0]), a0 = atrOf(win), levels = mergeZones(buildLevels(win, price, { lookback: TFCFG[0], maxDistPct: TFCFG[1] }), 0.6 * a0, 3 * a0); // gộp vùng chồng nhau (dày tối đa 3 ATR): vùng vẽ = vùng dùng lập kế hoạch
  const scenarios = planScenarios({ rows: win, price, levels, atr: atrOf(win) });
  scenarios.pattern = planPattern({ rows: win, price, atr: atrOf(win) });
  for (const k of ['short', 'long']) if (scenarios[k]) scenarios[k].branches = planBranches({ sc: scenarios[k], rows: win, levels, atr: a0 }); // nhánh: từ chối / phá thật / phá giả
  // số đo lịch sử của mô hình (vào tại cổ khi đóng cửa thủng, SL ngoài đỉnh/đáy 2, TP1 = chiều cao, phí 2 chiều): xem RESEARCH_LOG mục 13
  const PATTERN_STAT = { '1H': 'Đo lịch sử 5 coin khung 1H: PF 0,88 (LỖ), không nên vào theo mô hình này ở 1H.', '4H': 'Đo lịch sử 5 coin khung 4H: 744 lệnh, thắng 68%, PF 1,17 (BTC 1,51; ETH 1,24; SOL 0,91; LINK/NEAR ~1,0). Lợi thế nhỏ, R:R gần 1:1.' }[bar] || 'Khung này chưa được đo lịch sử.';
  if (scenarios.pattern) scenarios.pattern.statNote = PATTERN_STAT;
  const volTf = analyzeVolume(rows), volM15 = analyzeVolume(series(coin, '15m')); // bot quyết định trên M15 nên phán quyết dùng khối lượng M15
  const radar = generateKeyLevelRadar({ symbol: `${coin}-USDT`, candlesH4: closed(h4), curPrice: price, candlesH1: closed(h1) });
  const signal = evaluateMarket({ symbol: `${coin}-USDT`, candlesH4: closed(h4), candlesH1: closed(h1), candlesM15: closed(m15), candlesD1: closed(d1), btcH1Candles: closed(bh1), btcH4Candles: closed(bh4), config: BOT_CONFIG });
  const v = {
    coin, bar, price, generatedAt: Date.now(), trendH4: radar.trendH4, radarStatus: radar.radarStatus,
    candles: initial, firstSec: rows.length ? rows[0][0] : null, total: rows.length,
    volume: { tf: volTf, m15: volM15 }, verdict: buildVerdict({ signal: signal && !signal.isBlocked ? signal : null, blocked: signal && signal.isBlocked ? signal.blockReason : null, volTf: volM15, radarStatus: radar.radarStatus, pattern: scenarios.pattern, branch: ((radar.radarStatus === 'APPROACHING_RESISTANCE' ? scenarios.short : radar.radarStatus === 'APPROACHING_SUPPORT' ? scenarios.long : null) || {}).branches || null }),
    zones: pickKeyLevels(levels, 2, 0.6 * a0, 3 * a0).map(z => ({ kind: z.kind, top: z.top, bottom: z.bottom, label: `${z.kind === 'res' ? 'Kháng cự' : 'Hỗ trợ'} ${bar} (${z.touches} lần chạm)` })), scenarios, lines: buildLines(radar, macro), macro, firstTs: hist && hist.length ? hist[0].ts : null, playbook: buildPlaybook(radar, signal),
    signal: signal && !signal.isBlocked ? { direction: signal.direction, entry: signal.entry, sl: signal.stopLoss, tp: signal.takeProfit, rr: signal.riskReward, strategy: signal.strategy } : null,
    blocked: signal && signal.isBlocked ? String(signal.blockReason) : null
  };
  cache.set(key, { t: Date.now(), v });
  return v;
}

const gz = new Map(); // trang tua lại + dữ liệu nặng: nén gzip một lần rồi giữ trong RAM
function sendGz(res, rel, type) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
  if (!gz.has(rel)) gz.set(rel, zlib.gzipSync(fs.readFileSync(f)));
  res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=3600' });
  res.end(gz.get(rel));
}
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/') return send(res, 200, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    if (u.pathname === '/replay') { res.writeHead(301, { Location: '/replay/' }); return res.end(); }
    if (u.pathname === '/replay/') return sendGz(res, 'replay/index.html', 'text/html; charset=utf-8');
    const rd = u.pathname.match(/^\/replay\/data\/([A-Z0-9]+)\.json$/); // chỉ đúng mẫu này, không đọc đường dẫn tự do
    if (rd) return sendGz(res, `replay/data/${rd[1]}.json`, 'application/json');
    if (u.pathname === '/api/trades') { // các lệnh backtest 2021-26 của bot (cùng cấu hình hiện tại) để đánh dấu BUY/SELL lên biểu đồ
      const coin = u.searchParams.get('coin');
      if (!COINS.includes(coin)) return send(res, 400, { error: 'coin không hợp lệ' });
      if (!tradesCache.has(coin)) {
        const f = path.join(ROOT, 'replay', 'data', `${coin}.json`);
        tradesCache.set(coin, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).trades.map(t => ({ t: t.entryTs, x: t.exitTs, dir: t.dir, r: t.r, entry: t.entry, sl: t.sl, tp: t.tp, exit: t.exitPrice })) : []);
      }
      return send(res, 200, { trades: tradesCache.get(coin) });
    }
    if (u.pathname === '/api/candles') { // trang nến cũ hơn mốc `before` (giây), để cuộn sang trái là tự nạp thêm như TradingView
      const coin = u.searchParams.get('coin'), bar = u.searchParams.get('bar'), before = Number(u.searchParams.get('before')), limit = Math.min(Number(u.searchParams.get('limit')) || 20000, 50000);
      if (!COINS.includes(coin) || !STEP[bar] || !before) return send(res, 400, { error: 'tham số không hợp lệ' });
      const full = series(coin, bar); let lo = 0, hi = full.length; while (lo < hi) { const m = (lo + hi) >> 1; if (full[m][0] < before) lo = m + 1; else hi = m; }
      return send(res, 200, { candles: full.slice(Math.max(0, lo - limit), lo), hasMore: lo - limit > 0 });
    }
    if (u.pathname === '/api/analysis') {
      const coin = u.searchParams.get('coin') || 'BTC', bar = u.searchParams.get('bar') || '15m';
      if (!COINS.includes(coin) || !(bar in BARS)) return send(res, 400, { error: 'coin/bar không hợp lệ' });
      const [a, bot] = await Promise.all([analysis(coin, bar), botState()]);
      const sym = `${coin}-USDT`;
      return send(res, 200, { ...a, bot: { connected: bot.connected, reason: bot.reason, positions: (bot.positions || []).filter(p => p.symbol === sym), pending: (bot.pending || []).filter(p => p.symbol === sym), history: (bot.history || []).filter(h => h.symbol === sym).slice(-5) } });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(process.env.PORT || 3000, () => console.log('Viewer on', process.env.PORT || 3000));
COINS.forEach(c => { try { store(c); } catch (e) { console.error('[history]', c, e.message); } }); // nạp gói lịch sử ngay khi khởi động
