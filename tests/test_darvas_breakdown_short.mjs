import { detectDarvasSignal } from "../lib/darvas-box.ts";

function makeCandle(t, o, h, l, c, v = 1000) {
  return { t, o, h, l, c, v, closed: true };
}

console.log("=== KIỂM THỬ KÈO DARVAS BREAKDOWN SHORT (THỦNG ĐÁY HỘP) ===");

const M15 = 15 * 60 * 1000;
const now = Date.now();
const candles = [];

// 1. Hộp đi ngang tích luỹ phân phối quanh 82,000 - 82,600
const boxTop = 82600;
const boxBottom = 82000;

for (let i = 0; i < 20; i++) {
  const t = now - (25 - i) * M15;
  candles.push(makeCandle(t, 82200, 82800, 82000, 82300, 2000));
}

// 2. Cây nến xả thủng đáy hộp đóng tại 81,800 với Volume bán tháo 2.8x
candles.push(makeCandle(now - 2 * M15, 82100, 82150, 81750, 81800, 7000));

// 3. Cây nến hồi test mép dưới đáy hộp:
// Giá nhú lên 81,990 (chạm sát đáy hộp cũ 82,000), bị phe gấu dội gậy rút râu trên dài, đóng nến đỏ tại 81,850
candles.push(makeCandle(now - M15, 81920, 81990, 81820, 81850, 4500));

const sig = detectDarvasSignal("BTC", candles, {
  allowLong: true,
  allowShort: true,
  isBtcStrongPump: false,
});

if (sig && sig.kind === "DARVAS_BREAKDOWN_SHORT" && sig.side === -1) {
  console.log("✅ THÀNH CÔNG: ĐÃ BẮT ĐÚNG KÈO BREAKDOWN SHORT!");
  console.log("- Side: 🔴 SHORT");
  console.log("- Entry:", sig.entry);
  console.log("- Stop Loss (trên đáy hộp cũ):", sig.stop.toFixed(1));
  console.log("- TP1 (Hộp dưới):", sig.tp1);
  console.log("- R:R:", sig.rrRatio);
  console.log("- Ghi chú:", sig.note);
} else {
  console.error("LỖI: Chưa bắt được tín hiệu Breakdown Short!", sig);
  process.exit(1);
}
