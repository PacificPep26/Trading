// Đóng gói TOÀN BỘ nến M15 từ lúc có dữ liệu cho trang xem: deploy/viewer/history/<COIN>_15m.json, mỗi nến [giây, mở, cao, thấp, đóng, khối lượng].
// BTC/ETH dùng cache_long (Bitstamp nối OKX: BTC từ 2014, ETH từ 2017), các coin khác dùng cache OKX. Server tự gộp M15 -> 1H/4H/1D và bù phần mới nhất từ OKX.
// Chạy lại khi muốn cập nhật gói: node scripts/build_history_pack.mjs
import fs from 'fs';

const OUT = 'deploy/viewer/history';
fs.mkdirSync(OUT, { recursive: true });
const num = (v) => Number(Number(v).toPrecision(7));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cache cũ có thể bắt đầu sau ngày niêm yết (HYPE, LINK): lấy nốt phần cũ hơn từ OKX cho tới khi hết dữ liệu.
async function backfill(coin, firstSec) {
  const out = []; let after = String(firstSec * 1000);
  for (let i = 0; i < 400; i++) {
    const j = await (await fetch(`https://www.okx.com/api/v5/market/history-candles?instId=${coin}-USDT-SWAP&bar=15m&limit=100&after=${after}`, { signal: AbortSignal.timeout(15000) })).json();
    if (!Array.isArray(j.data) || !j.data.length) break;
    for (const r of j.data) if (r[8] === '1') out.push([Math.floor(Number(r[0]) / 1000), num(r[1]), num(r[2]), num(r[3]), num(r[4]), Math.round(Number(r[5]))]);
    after = j.data[j.data.length - 1][0];
    await sleep(120);
  }
  return out;
}
let total = 0;
for (const coin of ['BTC', 'ETH', 'SOL', 'LINK', 'NEAR', 'HYPE']) {
  const dir = ['BTC', 'ETH'].includes(coin) && fs.existsSync(`data/cache_long/${coin}-USDT-SWAP_15m.json`) ? 'data/cache_long' : 'data/cache_1year';
  const rows = JSON.parse(fs.readFileSync(`${dir}/${coin}-USDT-SWAP_15m.json`, 'utf8'))
    .filter(c => c.confirm === 1)
    .map(c => [Math.floor(c.ts / 1000), num(c.open), num(c.high), num(c.low), num(c.close), Math.round(c.vol)]);
  if (!['BTC', 'ETH'].includes(coin) || dir === 'data/cache_1year') {
    const older = await backfill(coin, Math.min(...rows.slice(0, 1).map(r => r[0])));
    if (older.length) console.log(`  ${coin}: bù thêm ${older.length} nến cũ hơn từ OKX`);
    const seen = new Set(rows.map(r => r[0]));
    for (const r of older) if (!seen.has(r[0])) rows.push(r);
  }
  rows.sort((a, b) => a[0] - b[0]);
  if (dir === 'data/cache_long') { // Bitstamp tính khối lượng theo coin, OKX theo hợp đồng (BTC 0.01 coin/hợp đồng, ETH 0.1): quy đổi giai đoạn Bitstamp sang hợp đồng cho liền mạch
    // shortcut: hệ số theo kích thước hợp đồng hiện tại; khối lượng OKX 3 tuần đầu sau niêm yết (12/2019) cao bất thường là của dữ liệu gốc
    const mult = { BTC: 100, ETH: 10 }[coin], okxFirst = JSON.parse(fs.readFileSync(`data/cache_1year/${coin}-USDT-SWAP_15m.json`, 'utf8'))[0].ts / 1000;
    for (const r of rows) if (r[0] < okxFirst) r[5] = Math.round(r[5] * mult);
    console.log(`  ${coin}: quy đổi khối lượng giai đoạn Bitstamp x${mult} sang đơn vị hợp đồng OKX`);
  }
  fs.writeFileSync(`${OUT}/${coin}_15m.json`, JSON.stringify(rows));
  const mb = fs.statSync(`${OUT}/${coin}_15m.json`).size / 1e6; total += mb;
  console.log(coin.padEnd(5), String(rows.length).padStart(7), 'nến', new Date(rows[0][0] * 1000).toISOString().slice(0, 10), '->', new Date(rows.at(-1)[0] * 1000).toISOString().slice(0, 10), mb.toFixed(1) + 'MB');
}
console.log('Tổng', total.toFixed(1) + 'MB (chưa nén)');
