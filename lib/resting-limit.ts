// Paper cho kèo "đặt sẵn Limit bắt râu quét" (lib/patterns.ts restingLimit), đúng luật sweep_limit_study:
// chờ khớp 24 nến 1H; nến chạm Limit là khớp; huỷ nếu giá chạm TP trước khi khớp;
// khớp ở min(limit, giá mở); nến khớp mà chạm SL = thua; tối đa 48 nến; phí 0% (MEXC), trượt giá 0.04%.
import fs from "fs";
import path from "path";

export type RestingLimit = {
  coin: string;
  side: 1 | -1;
  level: number;
  limit: number;
  stop: number;
  tp: number;
  atr: number;
  createdBar: number; // open time nến 1H xác nhận swing
  status: "pending" | "open" | "closed" | "cancelled";
  checkedTo: number;
  entry?: number;
  fillBar?: number;
  exitPrice?: number;
  r?: number;
  note?: string;
  market?: boolean; // vào Market ở giá mở nến kế (không chờ Limit); được tính TP ngay trong nến đó như backtest
  stopEntry?: boolean; // lệnh chờ PHÁ (buy/sell stop) tại `limit`: khớp khi giá vượt qua, huỷ nếu chạm SL trước hoặc quá 3 nến
  barMs?: number; // độ dài nến của kèo (mặc định 1H): giữ tối đa 48 nến
};

const H1 = 3_600_000;
const SLIP = 0.0004;
const FILE = path.join(process.cwd(), "data", "paper-limit.json");
type Bar = { t: number; o: number; h: number; l: number; c: number; closed?: boolean };

export function loadLimits(file = FILE): RestingLimit[] {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error("[LIMIT] Không đọc được:", e);
  }
  return [];
}

function save(rs: RestingLimit[], file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rs, null, 2), "utf-8");
}

/** Thêm lệnh chờ mới nếu coin chưa có lệnh chờ/đang mở. */
// replacePending: đáy mới thay lệnh chờ cũ chưa khớp (live_replay_study 2026-10-14: giữ lệnh cũ +0.013R, thay bằng đáy mới +0.032R)
export function addLimit(coin: string, s: Omit<RestingLimit, "coin" | "createdBar" | "status" | "checkedTo"> & { barTime: number }, file = FILE, replacePending = false): boolean {
  const rs = loadLimits(file);
  if (rs.some((x) => x.coin === coin && x.status === "open")) return false;
  const old = rs.find((x) => x.coin === coin && x.status === "pending");
  if (old && !replacePending) return false;
  if (old) { old.status = "cancelled"; old.note = "thay bằng đáy mới"; }
  const { barTime, ...rest } = s;
  rs.push({ coin, ...rest, createdBar: barTime, status: "pending", checkedTo: barTime });
  save(rs, file);
  return true;
}

const tag = (x: RestingLimit) => `${x.side > 0 ? "🟢 LONG" : "🔴 SHORT"} *${x.coin}*`;

/** Chạy các nến 1H mới đóng qua lệnh của coin. Trả tin cần gửi. */
export function stepLimits(coin: string, bars: Bar[], file = FILE): string[] {
  const rs = loadLimits(file);
  const x = rs.find((r) => r.coin === coin && (r.status === "pending" || r.status === "open"));
  if (!x) return [];
  const msgs: string[] = [];
  const closed = bars.filter((b) => b.closed !== false && b.t > x.checkedTo);
  for (const b of closed) {
    x.checkedTo = b.t;
    const bar = x.barMs ?? H1;
    if (x.status === "pending" && x.stopEntry) {
      if (b.t > x.createdBar + 3 * bar || (x.side > 0 ? b.l <= x.stop : b.h >= x.stop)) {
        x.status = "cancelled"; x.note = "không kích hoạt";
        msgs.push(`⌛ ${tag(x)} · lệnh chờ phá ${x.limit} không kích hoạt → huỷ`); break;
      }
      if (x.side > 0 ? b.h >= x.limit : b.l <= x.limit) {
        x.status = "open";
        x.entry = x.side > 0 ? Math.max(x.limit, b.o) : Math.min(x.limit, b.o);
        x.fillBar = b.t;
        msgs.push(`🧪 ${tag(x)} · paper KHỚP ${x.entry} · SL ${x.stop} · TP ${x.tp}`);
      }
    }
    if (x.status === "pending" && x.market) {
      x.status = "open";
      x.entry = b.o;
      x.fillBar = b.t;
      msgs.push(`🧪 ${tag(x)} · paper KHỚP ${x.entry} · SL ${x.stop} · TP ${x.tp}`);
    }
    if (x.status === "pending" && !x.stopEntry) {
      if (b.t > x.createdBar + 24 * H1) { x.status = "cancelled"; x.note = "hết 24h chưa khớp"; msgs.push(`⌛ ${tag(x)} · hết 24h chưa khớp → huỷ Limit ${x.limit}`); break; }
      // chạm Limit trước: nến chọc qua Limit thì lệnh đã khớp dù sau đó đóng thủng sâu (lỗi backtest cũ bỏ sót lệnh này)
      if (x.side > 0 ? b.l <= x.limit : b.h >= x.limit) {
        x.status = "open";
        x.entry = x.side > 0 ? Math.min(x.limit, b.o) : Math.max(x.limit, b.o);
        x.fillBar = b.t;
        msgs.push(`🧪 ${tag(x)} · paper KHỚP ${x.entry} · SL ${x.stop} · TP ${x.tp}`);
        if (x.side > 0 ? b.l <= x.stop : b.h >= x.stop) { close(x, x.stop, msgs); break; } // cùng nến chạm SL = thua
        continue;
      }
      if (x.side > 0 ? b.h >= x.tp : b.l <= x.tp) { x.status = "cancelled"; x.note = "chạy tới TP trước"; msgs.push(`↗️ ${tag(x)} · giá chạy tới TP trước → huỷ Limit ${x.limit}`); break; }
    } else if (x.status === "open") {
      if (x.side > 0 ? b.l <= x.stop : b.h >= x.stop) { close(x, x.stop, msgs); break; }
      if (x.side > 0 ? b.h >= x.tp : b.l <= x.tp) { close(x, x.tp, msgs); break; }
      if (b.t >= x.fillBar! + 47 * bar) { close(x, b.c, msgs); break; }
    }
  }
  save(rs, file);
  return msgs;
}

function close(x: RestingLimit, px: number, msgs: string[]) {
  const risk = Math.abs(x.entry! - x.stop) / x.entry!;
  x.status = "closed";
  x.exitPrice = px;
  x.r = (x.side * (px / x.entry! - 1) - SLIP) / risk;
  msgs.push(`🧪 ${tag(x)} · paper ĐÓNG ${x.entry} → ${px} · *${x.r >= 0 ? "+" : ""}${x.r.toFixed(2)}R*`);
}

export function limitStats(rs: RestingLimit[]) {
  const done = rs.filter((x) => x.status === "closed");
  const n = done.length, sum = done.reduce((s, x) => s + x.r!, 0);
  return { n, wins: done.filter((x) => x.r! > 0).length, avgR: n ? sum / n : 0, sumR: sum,
    pending: rs.filter((x) => x.status === "pending").length, open: rs.filter((x) => x.status === "open").length };
}
