// Lịch tin Mỹ (CPI, NFP, FOMC) từ lib/us-events.json, giờ New York → UTC.
// Backtest news_follow_study 2026-10-15: vào theo nến đầu sau tin LỖ (2025 −0.31R, 2026 −0.22R) → chỉ báo tin, không ra kèo.
import data from "./us-events.json" with { type: "json" };

/** Giờ New York → UTC ms. Giờ hè Mỹ: Chủ nhật thứ 2 tháng 3 → Chủ nhật thứ 1 tháng 11. */
export function nyToUtcMs(s: string): number {
  const [d, hm] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const sunday = (mon: number, n: number) => { const first = new Date(Date.UTC(y, mon - 1, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); };
  const t = (mo: number, dd: number) => mo * 100 + dd;
  const dst = t(m, day) >= t(3, sunday(3, 2)) && t(m, day) < t(11, sunday(11, 1));
  return Date.UTC(y, m - 1, day, hh + (dst ? 4 : 5), mm);
}

export const US_EVENTS: { t: number; type: string }[] = (data.events as [string, string][]).map(([s, type]) => ({ t: nyToUtcMs(s), type }));

const vn = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

/** Tin cần gửi lúc `now`: ⏰ trước giờ tin ≤ 60 phút, ⚡ khi nến 5m đầu của BTC đã đóng (trong 30 phút sau tin). Ghi key vào `sent`. */
export function newsMessages(events: { t: number; type: string }[], now: number, sent: Set<string>,
  btc5m: { t: number; o: number; c: number; closed?: boolean }[]): string[] {
  const out: string[] = [];
  for (const ev of events) {
    const pre = `NEWS:pre:${ev.t}`, post = `NEWS:post:${ev.t}`;
    if (ev.t > now && ev.t - now <= 3_600_000 && !sent.has(pre)) {
      sent.add(pre);
      out.push(`⏰ ${vn(ev.t)} tin ${ev.type} Mỹ (còn ~${Math.round((ev.t - now) / 60_000)} phút) · giữ Limit 📌, đừng đuổi nến đầu`);
    }
    const bar = now >= ev.t + 300_000 && now < ev.t + 1_800_000 && !sent.has(post) ? btc5m.find((b) => b.t === ev.t && b.closed !== false) : undefined;
    if (bar) {
      sent.add(post);
      const chg = (bar.c / bar.o - 1) * 100;
      out.push(`⚡ ${ev.type} vừa ra · BTC nến 5m đầu ${chg < 0 ? "🔴" : "🟢"} ${chg.toFixed(2)}% (${bar.o} → ${bar.c}) · chỉ là thông tin, đánh theo nến đầu backtest lỗ`);
    }
  }
  return out;
}
