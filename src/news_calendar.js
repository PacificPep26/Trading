/**
 * NEWS_CALENDAR.JS
 * Lịch cứng các tin kinh tế Mỹ TÁC ĐỘNG MẠNH NHẤT tới crypto (FOMC lãi suất,
 * CPI lạm phát, NFP việc làm). Dùng để bot TẠM DỪNG VÀO LỆNH MỚI trong khoảng
 * ±newsBlackoutHours quanh mỗi mốc - tránh bị quét 2 đầu lúc tin ra (giá giật
 * mạnh, khó đoán, Market Maker hay rũ hàng).
 *
 * TẠI SAO LỊCH CỨNG, KHÔNG DÙNG API: các tin này do chính phủ Mỹ công bố LỊCH
 * TRƯỚC cả năm, cố định, không đổi -> lịch cứng chính xác & tin cậy hơn API
 * free (Eulerpool đã test: bị Cloudflare chặn HTTP 403 từ server, không dùng
 * được). Nguồn: federalreserve.gov (FOMC), bls.gov (CPI/NFP).
 *
 * CẬP NHẬT: khi hết các mốc bên dưới (sau ~1/2027), thêm mốc mới từ nguồn
 * chính thức. NFP = Thứ Sáu đầu tiên mỗi tháng 8:30 ET; CPI ~giữa tháng;
 * FOMC 8 lần/năm. Giờ ET -> UTC: EDT=UTC-4 (tới hết 01/11/2026), EST=UTC-5.
 */

// Mỗi mốc là thời điểm tin CÔNG BỐ (UTC, ISO). name chỉ để log/thông báo.
const NEWS_EVENTS = [
  { name: 'FOMC - Quyết định lãi suất Mỹ', ts: '2026-10-28T18:00:00Z' }, // 2PM EDT
  { name: 'NFP - Bảng lương phi nông nghiệp', ts: '2026-11-06T13:30:00Z' }, // 8:30 EST
  { name: 'CPI - Lạm phát Mỹ (tháng 10)', ts: '2026-11-10T13:30:00Z' },
  { name: 'NFP - Bảng lương phi nông nghiệp', ts: '2026-12-04T13:30:00Z' },
  { name: 'FOMC - Quyết định lãi suất Mỹ', ts: '2026-12-09T19:00:00Z' }, // 2PM EST
  { name: 'CPI - Lạm phát Mỹ (tháng 11)', ts: '2026-12-10T13:30:00Z' },
  { name: 'FOMC - Quyết định lãi suất Mỹ', ts: '2027-01-27T19:00:00Z' }
].map(e => ({ name: e.name, tsMs: new Date(e.ts).getTime() }));

/**
 * Kiểm tra thời điểm hiện tại có đang nằm trong vùng cấm giao dịch quanh tin không.
 * @param {number} nowMs - Date.now()
 * @param {number} windowHours - bán kính vùng cấm trước/sau tin (tiếng)
 * @returns {{ blocked: boolean, event: string|null, minutesToEvent: number|null }}
 */
export function isNewsBlackout(nowMs, windowHours = 2) {
  const windowMs = windowHours * 60 * 60 * 1000;
  for (const e of NEWS_EVENTS) {
    if (Math.abs(nowMs - e.tsMs) <= windowMs) {
      return {
        blocked: true,
        event: e.name,
        minutesToEvent: Math.round((e.tsMs - nowMs) / 60000)
      };
    }
  }
  return { blocked: false, event: null, minutesToEvent: null };
}

/**
 * Tin lớn kế tiếp còn ở tương lai (để thông báo/hiển thị cho người dùng biết trước).
 * @param {number} nowMs
 * @returns {{ name: string, tsMs: number, hoursAway: number } | null}
 */
export function getNextNewsEvent(nowMs) {
  const future = NEWS_EVENTS.filter(e => e.tsMs > nowMs).sort((a, b) => a.tsMs - b.tsMs);
  if (future.length === 0) return null;
  const e = future[0];
  return { name: e.name, tsMs: e.tsMs, hoursAway: (e.tsMs - nowMs) / 3600000 };
}

export { NEWS_EVENTS };
