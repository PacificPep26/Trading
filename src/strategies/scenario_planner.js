/**
 * SCENARIO_PLANNER.JS - Vùng cản/hỗ trợ và kịch bản Short/Long tính từ cấu trúc của CHÍNH khung đang xem.
 * Hàm thuần, nến dạng [giây, mở, cao, thấp, đóng, khối lượng] tăng dần theo thời gian.
 * Kế hoạch (entry/SL/TP1/TP2) lấy từ vùng thật; đường đi `path` chỉ là MINH HỌA theo kế hoạch, không phải dự báo.
 */

/** ATR(n) giản đơn trên nến dạng mảng. */
export function atr(rows, n = 14) {
  if (!rows || rows.length < 2) return 0;
  const from = Math.max(1, rows.length - n);
  let sum = 0;
  for (let i = from; i < rows.length; i++) sum += Math.max(rows[i][2] - rows[i][3], Math.abs(rows[i][2] - rows[i - 1][4]), Math.abs(rows[i][3] - rows[i - 1][4]));
  return sum / (rows.length - from);
}

/** Cụm pivot (fractal L nến mỗi bên) thành vùng cản/hỗ trợ, sắp theo giá giảm dần. */
export function buildLevels(rows, price, { lookback = 600, L = 3, maxDistPct = 0.12 } = {}) {
  if (!rows || rows.length < 4 * L + 2) return [];
  const w = rows.slice(-lookback), a = atr(w), tol = Math.max(0.5 * a, 0.003 * price), pad = 0.15 * a;
  const piv = [];
  for (let i = L; i < w.length - L; i++) {
    let hi = true, lo = true;
    for (let d = 1; d <= L; d++) {
      if (!(w[i][2] > w[i - d][2] && w[i][2] > w[i + d][2])) hi = false;
      if (!(w[i][3] < w[i - d][3] && w[i][3] < w[i + d][3])) lo = false;
    }
    if (hi) piv.push({ p: w[i][2], i });
    if (lo) piv.push({ p: w[i][3], i });
  }
  piv.sort((x, y) => x.p - y.p);
  const zones = []; let cur = null;
  for (const q of piv) {
    // cụm không dày quá 2 ATR (tránh dính chuỗi thành một dải khổng lồ)
    if (cur && q.p - cur.max <= tol && q.p - cur.min <= 2 * a) { cur.max = q.p; cur.n++; cur.last = Math.max(cur.last, q.i); }
    else { cur = { min: q.p, max: q.p, n: 1, last: q.i }; zones.push(cur); }
  }
  return zones
    .map(z => ({ top: z.max + pad, bottom: z.min - pad, mid: (z.max + z.min) / 2, touches: z.n, lastIdx: z.last, kind: (z.max + z.min) / 2 > price ? 'res' : 'sup' }))
    .filter(z => z.touches >= 2 && Math.abs(z.mid - price) / price <= maxDistPct)
    .sort((x, y) => y.mid - x.mid);
}

/** Giữ lại tối đa `perSide` vùng gần giá nhất mỗi phía (cộng vùng mạnh nhất mỗi phía) để biểu đồ không rối. */
export function pickKeyLevels(levels, perSide = 3) {
  const out = new Set();
  for (const kind of ['res', 'sup']) {
    const side = levels.filter(z => z.kind === kind);
    const nearest = kind === 'res' ? [...side].sort((x, y) => x.mid - y.mid) : [...side].sort((x, y) => y.mid - x.mid);
    nearest.slice(0, perSide).forEach(z => out.add(z));
    const strongest = [...side].sort((x, y) => y.touches - x.touches)[0];
    if (strongest) out.add(strongest);
  }
  return [...out].sort((x, y) => y.mid - x.mid);
}

const r2 = (v) => Math.round(v * 100) / 100;
const legBars = (dist, a) => Math.max(3, Math.min(25, Math.round(Math.abs(dist) / (a || 1) * 2.5)));

function build(dir, { price, levels, atr: a }) {
  const short = dir === 'SHORT';
  const near = levels.filter(z => (short ? z.kind === 'res' : z.kind === 'sup')).sort((x, y) => (short ? x.mid - y.mid : y.mid - x.mid));
  const far = levels.filter(z => (short ? z.kind === 'sup' : z.kind === 'res')).sort((x, y) => (short ? y.mid - x.mid : x.mid - y.mid));
  if (!near.length || !(a > 0)) return null;
  const zone = near[0], entry = zone.mid, sgn = short ? 1 : -1;
  const sl = short ? zone.top + 0.6 * a : zone.bottom - 0.6 * a, risk = Math.abs(sl - entry);
  if (!(risk > 0)) return null;
  const edge = (z) => (short ? z.top : z.bottom); // mép gần entry của vùng mục tiêu
  const rrOf = (tp) => Math.abs(entry - tp) / risk;
  const targets = far.filter(z => (short ? edge(z) < entry : edge(z) > entry));
  let tp1 = null, i1 = -1;
  for (let i = 0; i < targets.length; i++) if (rrOf(edge(targets[i])) >= 1.5) { tp1 = edge(targets[i]); i1 = i; break; }
  let tp1Note = 'Vùng hỗ trợ/cản kế tiếp';
  if (tp1 == null) { tp1 = entry - sgn * 2 * risk; tp1Note = 'Không có vùng đủ xa: dùng 2R'; }
  const nxt = i1 >= 0 ? targets[i1 + 1] : null;
  const tp2 = nxt ? edge(nxt) : entry - sgn * Math.max(3.5 * risk, Math.abs(entry - tp1) + 1.5 * risk); // luôn xa entry hơn TP1
  const sweepPrice = // đỉnh/đáy cú quét: vượt vùng một chút nhưng chưa tới SL
    short ? Math.min(sl - 0.1 * a, zone.top + 0.3 * a) : Math.max(sl + 0.1 * a, zone.bottom - 0.3 * a);
  const pts = [{ price, label: 'Giá hiện tại' }, { price: sweepPrice, label: 'Quét thanh khoản' }, { price: entry, label: 'Vào lệnh' }];
  const bounce = (from, to, f) => from + (to - from) * f;
  pts.push({ price: bounce(entry, tp1, 0.55), label: 'Rời vùng' }, { price: bounce(entry, tp1, 0.3), label: 'Hồi retest' }, { price: tp1, label: 'TP1' }, { price: bounce(tp1, entry, 0.25), label: 'Nhịp hồi' }, { price: tp2, label: 'TP2' });
  let bars = 0;
  const path = pts.map((p, k) => { if (k) bars += legBars(p.price - pts[k - 1].price, a); return { bars, price: r2(p.price), label: p.label }; });
  path[0].price = price;
  const scale = path[path.length - 1].bars > 60 ? 60 / path[path.length - 1].bars : 1; // tối đa 60 nến phía trước
  if (scale < 1) path.forEach((p, k) => { p.bars = k ? Math.max(path[k - 1].bars + 1, Math.round(p.bars * scale)) : 0; });
  return {
    dir, entry: r2(entry), sl: r2(sl), tp1: r2(tp1), tp2: r2(tp2), rr1: r2(rrOf(tp1)), rr2: r2(rrOf(tp2)), tp1Note,
    zone: { top: r2(zone.top), bottom: r2(zone.bottom), touches: zone.touches }, slPct: r2(risk / entry * 100), path,
    trigger: short
      ? `Chờ nến đóng cửa quay lại DƯỚI ${r2(zone.bottom)} sau khi quét lên vùng ${r2(zone.bottom)}-${r2(zone.top)} thì mới Short; hủy nếu đóng cửa trên ${r2(sl)}.`
      : `Chờ nến đóng cửa quay lại TRÊN ${r2(zone.top)} sau khi quét xuống vùng ${r2(zone.bottom)}-${r2(zone.top)} thì mới Long; hủy nếu đóng cửa dưới ${r2(sl)}.`
  };
}

/** Kế hoạch Short (tại kháng cự gần nhất phía trên) và Long (tại hỗ trợ gần nhất phía dưới). null nếu thiếu vùng. */
export function planScenarios({ rows, price, levels, atr: a }) {
  if (!rows || !rows.length || !levels || !levels.length) return { short: null, long: null };
  const ctx = { price, levels, atr: a };
  return { short: build('SHORT', ctx), long: build('LONG', ctx) };
}
