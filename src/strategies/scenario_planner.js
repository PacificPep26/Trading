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

/** Gộp các vùng chồng lên nhau hoặc cách nhau <= gap thành một (hợp biên, cộng số lần chạm). */
export function mergeZones(levels, gap = 0, maxSpan = Infinity) {
  const sorted = [...levels].sort((x, y) => x.bottom - y.bottom), out = [];
  for (const z of sorted) {
    const last = out[out.length - 1];
    if (last && z.bottom <= last.top + gap && Math.max(last.top, z.top) - Math.min(last.bottom, z.bottom) <= maxSpan) { // không gộp nếu vùng mới dày quá maxSpan
      last.top = Math.max(last.top, z.top); last.bottom = Math.min(last.bottom, z.bottom); last.touches += z.touches; last.lastIdx = Math.max(last.lastIdx, z.lastIdx); last.mid = (last.top + last.bottom) / 2;
    } else out.push({ ...z });
  }
  return out.sort((x, y) => y.mid - x.mid);
}

/** Giữ lại tối đa `perSide` vùng gần giá nhất mỗi phía (cộng vùng mạnh nhất mỗi phía), đã gộp vùng chồng nhau, để biểu đồ không rối. */
export function pickKeyLevels(levels, perSide = 3, gap = 0, maxSpan = Infinity) {
  const out = new Set();
  const merged = mergeZones(levels, gap, maxSpan);
  for (const kind of ['res', 'sup']) {
    const side = merged.filter(z => z.kind === kind);
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
  const zone = near[0], entry = short ? zone.bottom : zone.top, sgn = short ? 1 : -1; // vào khi nến đóng cửa quay lại qua mép vùng (khớp điều kiện kích hoạt và backtest), không phải giữa vùng hay ngọn nến
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

/**
 * Mô hình 2 đỉnh / 2 đáy: hai đỉnh (đáy) gần bằng nhau (lệch <= 0.6 ATR), đường cổ là đáy (đỉnh) giữa hai điểm,
 * mục tiêu đo theo chiều cao mô hình (TP1 = 1x, TP2 = 1.618x). Trả về kế hoạch cùng dạng với planScenarios kèm `pattern`
 * (3 điểm đỉnh-cổ-đỉnh để vẽ). null nếu không có, hoặc giá đã chạy gần hết mục tiêu (không gợi ý vào muộn).
 */
export function planPattern({ rows, price, atr: a, L = 3, maxBars = 200 }) {
  if (!rows || rows.length < 40 || !(a > 0)) return null;
  const w = rows.slice(-maxBars), found = [];
  const piv = [];
  for (let i = L; i < w.length - L; i++) {
    let hi = true, lo = true;
    for (let d = 1; d <= L; d++) {
      if (!(w[i][2] > w[i - d][2] && w[i][2] > w[i + d][2])) hi = false;
      if (!(w[i][3] < w[i - d][3] && w[i][3] < w[i + d][3])) lo = false;
    }
    if (hi) piv.push({ i, p: w[i][2], type: 'top' });
    if (lo) piv.push({ i, p: w[i][3], type: 'bot' });
  }
  for (const type of ['top', 'bot']) {
    const top = type === 'top', same = piv.filter(q => q.type === type);
    if (same.length < 2) continue;
    const b = same[same.length - 1], a1 = same[same.length - 2], gap = b.i - a1.i;
    if (gap < 8 || gap > 120 || w.length - 1 - b.i > 60 || Math.abs(a1.p - b.p) > 0.6 * a) continue;
    let ni = a1.i; // vị trí đường cổ: đáy thấp nhất (đỉnh cao nhất) giữa hai điểm
    for (let j = a1.i; j <= b.i; j++) if (top ? w[j][3] < w[ni][3] : w[j][2] > w[ni][2]) ni = j;
    const neck = top ? w[ni][3] : w[ni][2], ext = top ? Math.max(a1.p, b.p) : Math.min(a1.p, b.p), height = Math.abs((a1.p + b.p) / 2 - neck);
    if (height < 1.5 * a) continue;
    const after = w.slice(b.i + 1);
    if (after.some(r => (top ? r[4] > ext + 0.3 * a : r[4] < ext - 0.3 * a))) continue; // đã vượt đỉnh/đáy thứ hai: mô hình hỏng
    const broken = after.some(r => (top ? r[4] < neck : r[4] > neck)), sgn = top ? 1 : -1;
    const tp1 = neck - sgn * height, tp2 = neck - sgn * 1.618 * height, sl = ext + sgn * 0.3 * a, risk = Math.abs(sl - neck);
    if (Math.abs(price - neck) > 0.9 * height && (top ? price < neck : price > neck)) continue; // giá đã gần hết mục tiêu
    const mid = (x, y, f) => x + (y - x) * f, bars = [];
    const pts = [{ price, label: 'Giá hiện tại' }, { price: neck - sgn * 0.3 * a, label: 'Thủng cổ' }, { price: neck, label: 'Hồi test cổ' }, { price: neck - sgn * 0.1 * a, label: 'Vào lệnh' },
      { price: mid(neck, tp1, 0.55), label: 'Rời cổ' }, { price: tp1, label: 'TP1' }, { price: mid(tp1, neck, 0.25), label: 'Nhịp hồi' }, { price: tp2, label: 'TP2' }];
    let acc = 0;
    const path = pts.map((p, k) => { if (k) acc += legBars(p.price - pts[k - 1].price, a); bars.push(acc); return { bars: acc, price: r2(p.price), label: p.label }; });
    path[0].price = price;
    const name = top ? 'Mô hình 2 đỉnh' : 'Mô hình 2 đáy', word = top ? 'THỦNG' : 'VƯỢT', dirWord = top ? 'Short' : 'Long';
    found.push({
      dir: top ? 'SHORT' : 'LONG', name, state: broken ? 'BROKEN' : 'FORMING', entry: r2(neck), sl: r2(sl), tp1: r2(tp1), tp2: r2(tp2),
      rr1: r2(height / risk), rr2: r2(1.618 * height / risk), tp1Note: 'Mục tiêu đo theo chiều cao mô hình (1×), TP2 = 1,618×',
      zone: { top: r2(neck + 0.15 * a), bottom: r2(neck - 0.15 * a), touches: 2 }, slPct: r2(risk / neck * 100), path, lastBar: w.length - 1 - b.i,
      pattern: { neckline: r2(neck), height: r2(height), points: [{ t: w[a1.i][0], price: r2(a1.p), label: top ? 'Đỉnh 1' : 'Đáy 1' }, { t: w[ni][0], price: r2(neck), label: 'Cổ' }, { t: w[b.i][0], price: r2(b.p), label: top ? 'Đỉnh 2' : 'Đáy 2' }] },
      trigger: broken
        ? `Đã ${word} cổ ${r2(neck)}. Chỉ vào ${dirWord} khi giá hồi test lại cổ rồi bị từ chối (nến đóng cửa ${top ? 'dưới' : 'trên'} ${r2(neck)}); hủy nếu đóng cửa ${top ? 'trên' : 'dưới'} ${r2(sl)}.`
        : `Chờ nến đóng cửa ${word} cổ ${r2(neck)} (xác nhận mô hình) rồi mới vào ${dirWord}; hủy nếu đóng cửa ${top ? 'trên' : 'dưới'} ${r2(sl)}.`
    });
  }
  return found.sort((x, y) => x.lastBar - y.lastBar)[0] || null; // lấy mô hình hoàn thành gần đây nhất
}

/**
 * Nhánh xử lý cho một kịch bản (Short ở kháng cự / Long ở hỗ trợ), nhận trạng thái từ nến đã đóng gần nhất:
 *  REJECT   - từ chối / quét thanh khoản rồi quay lại (kế hoạch chính)
 *  BREAKOUT - đóng cửa vượt vùng (có khối lượng >= 1.5x thì chắc, yếu thì nghi phá giả): hủy kế hoạch chính, đảo vai tại retest
 *  FAKE     - đã đóng cửa vượt vùng nhưng trong <= 8 nến đóng lại quay về phía cũ: phá giả (bẫy), vào theo hướng kế hoạch chính, SL ngoài đỉnh/đáy cú phá giả
 * Nến dạng [giây, mở, cao, thấp, đóng, khối lượng]; nến cuối là nến đang chạy nên bị bỏ qua.
 */
export function planBranches({ sc, rows, levels, atr: a }) {
  if (!sc || !rows || rows.length < 30 || !(a > 0)) return null;
  const short = sc.dir === 'SHORT', z = sc.zone, closed = rows.slice(0, -1), recent = closed.slice(-8), last = recent[recent.length - 1];
  const beyond = (c) => (short ? c[4] > z.top : c[4] < z.bottom);
  let state = 'APPROACH', relVol = 0;
  if (beyond(last) || recent.some(beyond)) {
    let k = closed.length - 1; while (k > 0 && beyond(closed[k - 1]) && closed.length - k < 8) k--; // nến đầu tiên của chuỗi đóng cửa vượt vùng
    while (k < closed.length - 1 && !beyond(closed[k])) k++;
    const base = closed.slice(Math.max(0, k - 20), k), avg = base.length ? base.reduce((s, r) => s + r[5], 0) / base.length : 0;
    relVol = avg > 0 ? closed[k][5] / avg : 0;
    state = beyond(last) ? (relVol >= 1.5 ? 'BREAKOUT' : 'BREAKOUT_WEAK') : 'FAKE';
  }
  const edge = short ? z.top : z.bottom, dirWord = short ? 'Short' : 'Long', flipWord = short ? 'Long' : 'Short', over = short ? 'trên' : 'dưới', back = short ? 'dưới' : 'trên';
  // nhánh đảo vai: vùng bị phá đổi vai (kháng cự -> hỗ trợ), vào tại retest mép vừa phá
  const entryB = edge, slB = short ? z.bottom - 0.3 * a : z.top + 0.3 * a, riskB = Math.abs(entryB - slB);
  const ahead = (levels || []).filter(q => (short ? q.kind === 'res' && q.bottom > entryB : q.kind === 'sup' && q.top < entryB)).sort((x, y) => (short ? x.bottom - y.bottom : y.top - x.top))[0];
  const tp1B = ahead ? (short ? ahead.bottom : ahead.top) : entryB + (short ? 2 : -2) * riskB;
  // nhánh phá giả: SL ngoài cực trị của cú phá giả
  const ext = short ? Math.max(...recent.map(r => r[2])) : Math.min(...recent.map(r => r[3])), slF = ext + (short ? 0.2 : -0.2) * a, entryF = short ? z.bottom : z.top, riskF = Math.abs(slF - entryF);
  const branches = [
    { id: 'REJECT', title: 'Từ chối / quét thanh khoản (kế hoạch chính)', when: sc.trigger, plan: { dir: sc.dir, entry: sc.entry, sl: sc.sl, tp1: sc.tp1, rr1: sc.rr1 } },
    { id: 'BREAKOUT', title: `Phá ${short ? 'lên' : 'xuống'} thật: hủy ${dirWord}, đảo vai`,
      when: `Nếu nến đóng cửa ${over} ${r2(edge)} KÈM khối lượng >= 1.5× trung bình, rồi hồi test ${r2(edge)} mà không đóng cửa ngược lại -> hủy ${dirWord}, vùng đổi vai, canh ${flipWord} tại retest.`,
      plan: { dir: short ? 'LONG' : 'SHORT', entry: r2(entryB), sl: r2(slB), tp1: r2(tp1B), rr1: r2(Math.abs(tp1B - entryB) / riskB) } },
    { id: 'FAKE', title: `Phá ${short ? 'lên' : 'xuống'} giả rồi quay đầu (bẫy)`,
      when: `Nếu nến đóng cửa ${over} ${r2(edge)} nhưng trong tối đa 8 nến đóng cửa quay lại ${back} ${r2(entryF)} -> phá giả (bẫy), vào ${dirWord} với SL ngoài đỉnh/đáy cú phá giả.`,
      plan: { dir: sc.dir, entry: r2(entryF), sl: r2(slF), tp1: sc.tp1, rr1: r2(Math.abs(entryF - sc.tp1) / riskF) } }
  ];
  const stateText = {
    BREAKOUT: `Đang đóng cửa ${over} vùng với khối lượng ${relVol.toFixed(1)}×: kế hoạch ${dirWord} bị đe dọa, theo dõi retest để đảo vai.`,
    BREAKOUT_WEAK: `Đóng cửa ${over} vùng nhưng khối lượng yếu (${relVol.toFixed(1)}×): nghi phá giả, chờ xác nhận thêm.`,
    FAKE: `Đã đóng cửa ${over} vùng rồi quay lại: dấu hiệu phá giả (bẫy), kế hoạch ${dirWord} mạnh hơn nhưng SL phải ngoài cực trị cú phá.`,
    APPROACH: `Giá chưa vượt vùng: kế hoạch chính (từ chối) đang hiệu lực.`
  }[state];
  return { state, relVol: r2(relVol), active: state === 'FAKE' ? 'FAKE' : state === 'APPROACH' ? 'REJECT' : 'BREAKOUT', stateText, branches };
}

/**
 * Vùng thanh khoản CỦA ENGINE (tier 1: cụm đỉnh/đáy nhiều lần chạm; tier 2: đỉnh/đáy lớn) lấy thẳng từ radar của bot, gộp vùng chồng nhau,
 * loại vùng xa quá maxDistPct. Đây là các vùng mà bot thực sự giao dịch, dùng làm nguồn duy nhất cho kế hoạch.
 */
export function engineZonesFromRadar(radar, price, maxDistPct = 0.15) {
  if (!radar || !(price > 0)) return [];
  const zs = [];
  for (const t of [...(radar.tier1InducementHighs || []), ...(radar.tier1InducementLows || [])]) zs.push({ bottom: t.minPrice, top: t.maxPrice, touches: t.touchCount || 1 });
  for (const p of [radar.tier2MajorHigh, radar.tier2MajorLow]) if (p > 0) zs.push({ bottom: p * 0.999, top: p * 1.001, touches: 1 });
  return mergeZones(zs.map(z => ({ ...z, mid: (z.top + z.bottom) / 2, lastIdx: 0, kind: 'res' })), 0)
    .map(z => ({ ...z, kind: z.mid > price ? 'res' : 'sup' }))
    .filter(z => Math.abs(z.mid - price) / price <= maxDistPct);
}

/** Đổi đường đi minh họa sang đơn vị nến của khung đang xem: nhân hệ số, giữ tăng dần và nguyên, tổng không quá cap. */
export function rescalePath(sc, factor, cap = 70) {
  const raw = sc.path.map(p => p.bars), total = raw[raw.length - 1] * factor, k = total > cap ? cap / total : 1;
  let prev = 0;
  const path = sc.path.map((p, i) => { const b = i === 0 ? 0 : Math.max(prev + 1, Math.round(p.bars * factor * k)); prev = b; return { ...p, bars: b }; });
  return { ...sc, path };
}
