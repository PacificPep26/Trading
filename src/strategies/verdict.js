/**
 * VERDICT.JS - Phán quyết thống nhất: đọc khối lượng + ghép với quyết định THẬT của engine bot.
 * Nguyên tắc: người quyết định là engine của bot (đã backtest, điểm >= ngưỡng). Chưa có tín hiệu thì chỉ CHỜ,
 * kèm phần đọc khối lượng và danh sách điều kiện còn thiếu; không tự bịa thêm tín hiệu vào lệnh.
 * Nến dạng [giây, mở, cao, thấp, đóng, khối lượng] tăng dần; nến cuối coi là nến đang chạy, phân tích nến đóng gần nhất.
 */

export function analyzeVolume(rows, n = 20) {
  if (!rows || rows.length < n + 2) return { kind: 'UNKNOWN', relVol: 0, text: 'Chưa đủ dữ liệu để đọc khối lượng.' };
  const bar = rows[rows.length - 2], prev = rows.slice(rows.length - 2 - n, rows.length - 2);
  const avg = prev.reduce((s, r) => s + r[5], 0) / n, range = bar[2] - bar[3];
  const relVol = avg > 0 ? bar[5] / avg : 0;
  const upper = range > 0 ? (bar[2] - Math.max(bar[1], bar[4])) / range : 0, lower = range > 0 ? (Math.min(bar[1], bar[4]) - bar[3]) / range : 0;
  const hi = Math.max(...prev.map(r => r[2])), lo = Math.min(...prev.map(r => r[3]));
  let kind = 'NORMAL', text = `Khối lượng bình thường (${relVol.toFixed(1)}× trung bình ${n} nến).`;
  if (relVol >= 1.8 && upper >= 0.5) { kind = 'CLIMAX_UP_REJECT'; text = `Khối lượng đột biến ${relVol.toFixed(1)}× + râu trên dài: lực bán hấp thụ lực mua ở đỉnh.`; }
  else if (relVol >= 1.8 && lower >= 0.5) { kind = 'CLIMAX_DOWN_REJECT'; text = `Khối lượng đột biến ${relVol.toFixed(1)}× + râu dưới dài: lực mua hấp thụ lực bán ở đáy.`; }
  else if (relVol >= 1.8 && bar[4] > hi) { kind = 'BREAKOUT_UP'; text = `Phá lên có khối lượng ${relVol.toFixed(1)}×: đóng cửa vượt đỉnh ${n} nến.`; }
  else if (relVol >= 1.8 && bar[4] < lo) { kind = 'BREAKOUT_DOWN'; text = `Phá xuống có khối lượng ${relVol.toFixed(1)}×: đóng cửa thủng đáy ${n} nến.`; }
  else if (relVol < 0.6) { kind = 'DRYING'; text = `Khối lượng cạn (${relVol.toFixed(1)}× trung bình): thị trường thiếu lực.`; }
  return { kind, relVol: Number(relVol.toFixed(2)), upperWick: Number(upper.toFixed(2)), lowerWick: Number(lower.toFixed(2)), text };
}

const SUPPORTS = { SHORT: 'CLIMAX_UP_REJECT', LONG: 'CLIMAX_DOWN_REJECT' };
const VETO = { SHORT: 'BREAKOUT_UP', LONG: 'BREAKOUT_DOWN' };

export function buildVerdict({ signal, blocked, volTf, radarStatus, pattern = null, branch = null, zoneEngine = null }) {
  const notes = [];
  if (blocked) notes.push(`Engine đang chặn setup: ${String(blocked).split(':')[0]}.`);
  if (signal) {
    return { decision: signal.direction, source: 'BOT', favored: signal.direction, avoid: null, notes,
      headline: `BOT ĐANG CÓ TÍN HIỆU ${signal.direction} (${signal.strategy}): sẽ chờ xác nhận 60 phút rồi vào lệnh.`,
      checklist: [{ ok: true, text: 'Engine của bot đã phát tín hiệu và qua bộ lọc' }] };
  }
  const withPattern = (v) => { // nhắc mô hình 2 đỉnh/đáy và đối chiếu hướng với ưu tiên
    if (!pattern) return v;
    const dir = pattern.dir === 'SHORT' ? 'Short' : 'Long', st = pattern.state === 'BROKEN' ? 'đã thủng cổ' : 'chưa thủng cổ';
    const rel = v.favored ? (v.favored === pattern.dir ? 'cùng hướng với ưu tiên của hệ thống' : 'NGƯỢC hướng ưu tiên của hệ thống: thận trọng, chờ thêm xác nhận') : 'không trùng kịch bản nào của hệ thống';
    v.notes.push(`Phát hiện ${pattern.name} (${st}), hướng ${dir}, ${rel}. Xem nút "Mô hình".`);
    return v;
  };
  if (zoneEngine === false && radarStatus && radarStatus !== 'NEUTRAL') notes.push('Vùng của kịch bản chỉ là cụm cấu trúc, không phải vùng thanh khoản engine giao dịch: bot sẽ không vào ở đây dù nến rút râu. Đo lịch sử: vào mọi lần chạm kiểu này đều lỗ (PF 0,67 ở 15m, 0,85 ở 1H, 0,82 ở 4H).');
  const side = radarStatus === 'APPROACHING_RESISTANCE' ? 'SHORT' : radarStatus === 'APPROACHING_SUPPORT' ? 'LONG' : null;
  const kind = volTf ? volTf.kind : 'UNKNOWN';
  if (branch && branch.state && branch.state !== 'APPROACH') notes.push(branch.stateText);
  if (side && (kind === VETO[side] || (branch && branch.state === 'BREAKOUT'))) {
    notes.push(`Giá áp sát ${side === 'SHORT' ? 'kháng cự' : 'hỗ trợ'} nhưng đang phá ${side === 'SHORT' ? 'lên' : 'xuống'} có khối lượng: không bắt ${side === 'SHORT' ? 'đỉnh' : 'đáy'}.`);
    return withPattern({ decision: 'WAIT', source: 'PLAN', favored: null, avoid: side, notes, headline: `Đứng ngoài: tránh ${side} vì giá đang phá có khối lượng.`, checklist: [] });
  }
  if (!side) return withPattern({ decision: 'WAIT', source: 'PLAN', favored: null, avoid: null, notes, headline: 'Đứng ngoài: giá đang ở giữa vùng, chưa có kịch bản.', checklist: [] });
  const confirmed = kind === SUPPORTS[side];
  return withPattern({ decision: 'WAIT', source: 'PLAN', favored: side, avoid: null, notes,
    headline: `Chưa vào lệnh: ưu tiên canh ${side}, chờ xác nhận.`,
    checklist: [
      { ok: true, text: `Giá đang áp sát ${side === 'SHORT' ? 'kháng cự' : 'hỗ trợ'}` },
      { ok: confirmed, text: `Khối lượng xác nhận (climax + râu): ${volTf && volTf.text ? volTf.text : 'chưa có dữ liệu'}` },
      { ok: false, text: 'Nến M15 đóng cửa quay lại + râu dài + khối lượng hấp thụ (điều kiện bot cần)' },
      { ok: false, text: 'Bot chưa phát tín hiệu (cần điểm chất lượng đạt ngưỡng)' }
    ] });
}
