/**
 * CALENDAR_FEED.JS - Lịch kinh tế Mỹ: nguồn tuần (faireconomy / ForexFactory, công khai, không có khóa) gộp với lịch gõ cứng FOMC/CPI/NFP.
 * Chỉ để HIỂN THỊ và cảnh báo; việc bot tạm dừng vào lệnh vẫn do news_calendar.js (FOMC/CPI/NFP, ±2 giờ) quyết định.
 * shortcut: nguồn tuần là bên thứ ba không chính thức; mất kết nối thì chỉ còn lịch gõ cứng, không làm hỏng gì khác.
 */
import { NEWS_EVENTS } from './news_calendar.js';

const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', TTL = 30 * 60 * 1000;
const LABELS = [
  [/adp/i, 'Việc làm tư nhân ADP'], // phải đứng trước NFP vì tiêu đề ADP cũng chứa 'Non-Farm'
  [/non-farm/i, 'Bảng lương phi nông nghiệp (NFP)'], [/unemployment rate/i, 'Tỷ lệ thất nghiệp'], [/average hourly/i, 'Lương theo giờ'],
  [/unemployment claims/i, 'Đơn xin trợ cấp thất nghiệp'], [/ism manufacturing/i, 'PMI sản xuất ISM'], [/ism services/i, 'PMI dịch vụ ISM'],
  [/jolts/i, 'Cơ hội việc làm JOLTS'], [/\bcpi\b/i, 'CPI - Lạm phát'], [/fomc|federal funds rate/i, 'FOMC - Lãi suất'],
  [/final manufacturing pmi/i, 'PMI sản xuất S&P (chốt)'], [/final services pmi/i, 'PMI dịch vụ S&P (chốt)'], [/crude oil inventories/i, 'Tồn kho dầu thô EIA'],
  [/consumer sentiment/i, 'Niềm tin tiêu dùng UoM'], [/inflation expectations/i, 'Kỳ vọng lạm phát UoM'], [/retail sales/i, 'Doanh số bán lẻ'], [/ppi/i, 'PPI - Giá sản xuất']
];
const labelOf = (title) => (LABELS.find(([re]) => re.test(title)) || [0, title])[1];
const ALSO_LOW = /ADP Non-Farm|Final (Manufacturing|Services) PMI|Crude Oil Inventories/i; // nguồn xếp mức Thấp nhưng có trong lịch người dùng theo dõi
const PAUSES = /FOMC|CPI|NFP|Non-Farm/i; // nhóm tin mà bot tạm dừng vào lệnh mới (news_calendar.js); ADP không thuộc nhóm này
const pauses = (e) => !/ADP/i.test(e.title || '') && (PAUSES.test(e.title) || PAUSES.test(e.label))

/** Giữ tin USD mức Trung bình/Cao (+ ADP, PMI chốt, tồn kho dầu mức Thấp), đổi giờ về UTC (ms), sắp theo thời gian. */
export function normalizeCalendar(feed) {
  return (Array.isArray(feed) ? feed : [])
    .filter(e => e && e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium' || (e.impact === 'Low' && ALSO_LOW.test(e.title || ''))))
    .map(e => ({ title: e.title, label: labelOf(e.title), tsMs: new Date(e.date).getTime(), impact: e.impact, forecast: e.forecast || '', previous: e.previous || '', source: 'feed' }))
    .filter(e => Number.isFinite(e.tsMs)).sort((a, b) => a.tsMs - b.tsMs);
}

/** Bổ sung tin gõ cứng (FOMC/CPI/NFP) chưa có trong nguồn tuần (trùng nếu cách nhau <= 90 phút). */
export function mergeStatic(events, staticEvents = NEWS_EVENTS) {
  const out = [...events];
  for (const s of staticEvents) {
    if (events.some(e => Math.abs(e.tsMs - s.tsMs) <= 90 * 60000)) continue;
    out.push({ title: s.name, label: labelOf(s.name) === s.name ? s.name : labelOf(s.name), tsMs: s.tsMs, impact: 'High', forecast: '', previous: '', source: 'static' });
  }
  return out.sort((a, b) => a.tsMs - b.tsMs);
}

/** Tin gần nhất trong cửa sổ [-30 phút, +windowH giờ] quanh bây giờ; null nếu không có. */
export function nearestNews(events, nowMs, windowH = 3) {
  const e = events.filter(x => x.tsMs >= nowMs - 30 * 60000 && x.tsMs <= nowMs + windowH * 3600000).sort((a, b) => a.tsMs - b.tsMs)[0];
  return e ? { title: e.title, label: e.label, minutes: Math.round((e.tsMs - nowMs) / 60000), impact: e.impact, botPauses: pauses(e) } : null;
}

let cache = null;
/** Lịch đã gộp; nguồn tuần lỗi thì chỉ còn lịch gõ cứng. Bộ nhớ đệm 30 phút. */
export async function loadCalendar(nowMs = Date.now()) {
  if (cache && nowMs - cache.t < TTL) return cache.v;
  let feed = [];
  try { const r = await fetch(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }); if (r.ok) feed = await r.json(); } catch { /* chỉ dùng lịch gõ cứng */ }
  const v = mergeStatic(normalizeCalendar(feed));
  cache = { t: nowMs, v };
  return v;
}

export const describeNews = (n) => (n ? `${n.label} ${n.minutes >= 0 ? `sau ${n.minutes} phút` : `vừa ra ${-n.minutes} phút trước`}` : '');
