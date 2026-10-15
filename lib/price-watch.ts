// Theo dõi giá do chủ tài khoản đặt qua Telegram: chạm mức vào → báo để tự vào lệnh (bot KHÔNG tự đặt lệnh).
// data/ là Railway volume → sống qua redeploy.
import fs from "fs";
import path from "path";

export type Watch = {
  coin: string;
  side: 1 | -1; // suy ra từ SL: SL dưới giá vào = LONG
  entry: number;
  stop: number;
  tp: number;
  btcCancel?: number; // LONG: BTC dưới mức này thì huỷ; SHORT: BTC trên mức này thì huỷ
  expires: number;
  near?: boolean; // đã báo "gần tới" (cách điểm vào < 0.5%)
};

const NEAR = 0.005;

const FILE = path.join(process.cwd(), "data", "price-watch.json");

export function loadWatches(file = FILE): Watch[] {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error("[WATCH] Không đọc được:", e);
  }
  return [];
}

export function saveWatches(ws: Watch[], file = FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ws, null, 2), "utf-8");
}

/** "theo dõi SUI 1.041 1.029 1.085 btc 82750" → Watch (hết hạn 23:59 giờ VN hôm nay). */
export function parseWatch(text: string, coins: string[], now = Date.now()): Watch | null {
  const m = text.match(/theo d[õo]i\s+([a-z0-9]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+btc\s+([\d.]+))?/i);
  if (!m) return null;
  const coin = m[1].toUpperCase();
  const [entry, stop, tp] = [+m[2], +m[3], +m[4]];
  if (!coins.includes(coin) || ![entry, stop, tp].every((x) => x > 0) || stop === entry) return null;
  const side: 1 | -1 = stop < entry ? 1 : -1;
  if (side * (tp - entry) <= 0) return null; // TP phải cùng phía lợi nhuận
  const vnDay = Math.floor((now + 7 * 3_600_000) / 86_400_000);
  const expires = (vnDay + 1) * 86_400_000 - 7 * 3_600_000 - 60_000;
  return { coin, side, entry, stop, tp, btcCancel: m[5] ? +m[5] : undefined, expires };
}

/** Kiểm tra một lượt: trả các tin cần gửi và danh sách watch còn lại. */
/** Thêm/thay theo dõi của coin (bot tự gọi khi gửi kèo Limit). */
export function addWatch(w: Watch, file = FILE) {
  saveWatches([...loadWatches(file).filter((x) => x.coin !== w.coin), w], file);
}

export function evaluateWatches(
  ws: Watch[],
  price: Record<string, number>,
  now = Date.now(),
  context?: { allowLong?: boolean; allowShort?: boolean }
) {
  const msgs: string[] = [];
  const keep: Watch[] = [];
  for (const w of ws) {
    const p = price[w.coin], btc = price.BTC;
    const label = `${w.side > 0 ? "LONG" : "SHORT"} ${w.coin} @${w.entry}`;
    if (now > w.expires) { msgs.push(`⌛ Hết hạn theo dõi ${label} (chưa chạm).`); continue; }
    if (w.side < 0 && context && context.allowShort === false) {
      msgs.push(`🛡️ *HUỶ THEO DÕI:* ${label} — Thị trường / BTC đang tăng mạnh (CẤM SHORT chặn đầu xe lửa).`);
      continue;
    }
    if (w.side > 0 && context && context.allowLong === false) {
      msgs.push(`🛡️ *HUỶ THEO DÕI:* ${label} — Thị trường / BTC đang xả mạnh (CẤM BẮT DAO RƠI).`);
      continue;
    }
    if (w.btcCancel && Number.isFinite(btc) && (w.side > 0 ? btc < w.btcCancel : btc > w.btcCancel)) {
      msgs.push(`❌ BTC ${btc} đã ${w.side > 0 ? "mất" : "vượt"} ${w.btcCancel} → *HUỶ lệnh Limit ${label} trên MEXC*.`);
      continue;
    }
    if (Number.isFinite(p) && !w.near && (w.side > 0 ? p > w.entry : p < w.entry) && Math.abs(p - w.entry) / w.entry <= NEAR) {
      w.near = true;
      msgs.push(`⏰ *GẦN TỚI ĐIỂM VÀO* ${w.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${w.coin}* — giá ${p}, cách ${(Math.abs(p - w.entry) / w.entry * 100).toFixed(2)}%\n• Vào ${w.entry} · SL ${w.stop} · TP ${w.tp}`);
    }
    if (Number.isFinite(p) && (w.side > 0 ? p <= w.entry : p >= w.entry)) {
      if (w.side > 0 ? p <= w.stop : p >= w.stop) { msgs.push(`❌ ${label}: giá ${p} đã qua luôn SL ${w.stop}, bỏ kèo.`); continue; }
      // Nếu giá đã đục qua điểm vào > 0.3% mà không phản ứng rút râu -> HỦY KÈO (Breakout, cấm chặn đầu)
      if (w.side < 0 && p > w.entry * 1.003) {
        msgs.push(`🛡️ *HUỶ KÈO:* ${label} — Giá ${p} đã đục qua cản (>0.3% đà tăng mạnh), bỏ lệnh Short.`);
        continue;
      }
      if (w.side > 0 && p < w.entry * 0.997) {
        msgs.push(`🛡️ *HUỶ KÈO:* ${label} — Giá ${p} đã đâm thủng đáy (>0.3% đà xả mạnh), bỏ lệnh Long.`);
        continue;
      }
      const r = Math.abs(w.entry - w.stop), rr = Math.abs(w.tp - w.entry) / r;
      msgs.push(
        `🔔 *CHẠM ĐIỂM VÀO* ${w.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${w.coin}* — giá ${p}\n` +
        `• Vào ~${w.entry} · SL ${w.stop} · TP ${w.tp} (${rr.toFixed(1)}R)\n` +
        `_Đã đặt Limit trên sàn thì sàn tự khớp; chưa thì vào x10 Isolated, tick TP/SL._`
      );
      continue;
    }
    keep.push(w);
  }
  return { msgs, keep };
}
