/**
 * EXPORT_REPLAY.MJS
 * Xuất dữ liệu để TUA LẠI từng nến: nến M15 thật từ cache OKX + toàn bộ tín hiệu/lệnh của bot (cùng cấu hình & cùng
 * backtestSymbol với backtest chính) trong một khoảng thời gian, rồi nhúng vào docs/replay/replay.html (mở trực tiếp bằng trình duyệt).
 * Chạy: node scripts/export_replay.mjs [từ=2026-09-01] [đến=2026-10-31]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCandle } from '../src/indicators.js';
import { backtestSymbol } from './backtest_1year.mjs';
import { BOT_CONFIG } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, '../data/cache_1year');
const SYMS = ['BTC', 'ETH', 'SOL', 'HYPE', 'NEAR', 'LINK'];
const [fromStr, toStr] = [process.argv[2] || '2026-09-01', process.argv[3] || '2026-10-31'];
const startTs = Date.parse(fromStr + 'T00:00:00Z'), endTs = Date.parse(toStr + 'T23:59:59Z');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')).map(normalizeCandle);
const num = (v) => Number(Number(v).toPrecision(7));

const btcH1 = rd('BTC-USDT-SWAP_1H.json'), btcH4 = rd('BTC-USDT-SWAP_4H.json');
const coins = {};
for (const sym of SYMS) {
  const signalLog = [];
  const trades = await backtestSymbol(`${sym}-USDT-SWAP`, btcH1, btcH4, { signalLog }, startTs, endTs);
  const candles = rd(`${sym}-USDT-SWAP_15m.json`).filter(c => c.confirm === 1 && c.ts >= startTs - 86400000 && c.ts <= endTs)
    .map(c => [c.ts, num(c.open), num(c.high), num(c.low), num(c.close), Math.round(c.vol)]);
  coins[sym] = {
    candles,
    trades: trades.map(t => ({
      dir: t.direction, strat: t.strategy, signalTs: t.triggerTime, entryTs: t.entryTime, entry: num(t.entry), sl: num(t.initialStopLoss), tp: num(t.takeProfit),
      exitTs: t.exitTime, exitPrice: num(t.exitPrice), outcome: t.outcome, r: Number(t.netR.toFixed(2)), score: t.qualityScore, why: (t.qualityReasons || []).slice(0, 4)
    })),
    signals: signalLog.filter(x => x.ts >= startTs && x.ts <= endTs).map(x => ({
      ts: x.ts, dir: x.direction, strat: x.strategy, entry: x.entry && num(x.entry), sl: x.stopLoss && num(x.stopLoss), tp: x.takeProfit && num(x.takeProfit),
      score: x.score, status: x.status, reason: x.reason, why: (x.reasons || []).slice(0, 3)
    }))
  };
  console.log(sym.padEnd(5), `${candles.length} nến | ${trades.length} lệnh | ${coins[sym].signals.length} tín hiệu (${coins[sym].signals.filter(s => s.status === 'entered').length} vào, ${coins[sym].signals.filter(s => s.status === 'low_score').length} điểm thấp, ${coins[sym].signals.filter(s => s.status === 'cancelled').length} hủy khi chờ, ${coins[sym].signals.filter(s => s.status === 'blocked').length} bị chặn)`);
}

const data = {
  meta: {
    from: fromStr, to: toStr, generatedAt: new Date().toISOString(),
    config: {
      minScore: BOT_CONFIG.minSetupQualityScore, entryDelayBars: BOT_CONFIG.entryDelayBars, minRR: BOT_CONFIG.minRR,
      session: `${BOT_CONFIG.sessionStartHourUtc}-${BOT_CONFIG.sessionEndHourUtc} UTC`, chopSleep: BOT_CONFIG.enableChopSleepMode,
      trendAlign: BOT_CONFIG.enableTrendAlignFilter, beManagement: BOT_CONFIG.beTriggerR < 99, riskUsd: BOT_CONFIG.riskUsd, leverage: BOT_CONFIG.leverage
    }
  },
  coins
};
const outDir = path.join(__dirname, '../docs/replay');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'replay_data.json'), JSON.stringify(data));
const tpl = path.join(outDir, 'replay_template.html');
if (fs.existsSync(tpl)) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c'); // an toàn khi nhúng trong <script>
  const fragment = fs.readFileSync(tpl, 'utf8').replace('/*__DATA__*/null', () => json);
  fs.writeFileSync(path.join(outDir, 'replay_artifact.html'), fragment); // dạng mảnh để đăng artifact
  fs.writeFileSync(path.join(outDir, 'replay.html'), `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">${fragment}</body></html>`);
  console.log('Đã ghi docs/replay/replay.html (mở trực tiếp) và replay_artifact.html');
}
console.log('Đã ghi docs/replay/replay_data.json', (fs.statSync(path.join(outDir, 'replay_data.json')).size / 1e6).toFixed(2) + ' MB');
