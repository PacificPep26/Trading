const { extractDarvasBox, detectDarvasSignal } = await import("../lib/darvas-box.ts");

function makeCandle(t, o, h, l, c, v = 1000) {
  return { t, o, h, l, c, v, closed: true };
}

console.log("=== BẮT ĐẦU TEST CHIẾN LƯỢC HỘP DARVAS BOX & NHỊP TEST ĐÁY LẦN 2 ===");

const M15 = 15 * 60 * 1000;
const now = Date.now();
const candles = [];

// 1. Tạo hộp Darvas đi ngang quanh vùng đáy 81,600 đến đỉnh 82,600 (như hình BTC của Victor):
// Box Top: 82,600 | Box Bottom: 81,650
const boxTop = 82600;
const boxBottom = 81650;

// 18 nến đi ngang trong hộp (High 82,600, Low 81,800)
for (let i = 0; i < 18; i++) {
  const t = now - (22 - i) * M15;
  candles.push(makeCandle(t, 82000, 82600, 81800, 82100, 2000));
}

// 2. Nhịp test đáy lần 1: Nến nhúng xuống 81,660 rút chân lên 82,000
candles.push(makeCandle(now - 3 * M15, 82000, 82100, 81660, 81950, 3500));

// 3. Nến đi ngang giữa hộp
candles.push(makeCandle(now - 2 * M15, 81950, 82200, 81900, 82100, 2000));

// 4. Nhịp test đáy lần 2 (đúng như nhận định của Victor):
// Giá đạp về 81,680 (chạm cạnh dưới hộp tím), rút chân nến búa mạnh mẽ đóng ở 81,850
candles.push(makeCandle(now - M15, 81820, 81860, 81680, 81850, 4500));

const box = extractDarvasBox(candles);
console.log("\n[Test 1] Kết quả trích xuất Hộp Darvas:");
console.log("- Đỉnh hộp (Resistance):", box?.top);
console.log("- Đáy hộp (Support):", box?.bottom);
console.log("- Chiều cao hộp (%):", box?.heightPct.toFixed(2) + "%");
console.log("- Số lần test đáy:", box?.testCount);

if (!box || box.testCount < 1) {
  throw new Error("LỖI: Không nhận diện được Hộp Darvas hoặc nhịp test đáy!");
}

const last15 = candles[candles.length - 1];
const rng = last15.h - last15.l;
const lowerWick = Math.min(last15.o, last15.c) - last15.l;
const stop = Math.min(last15.l, box.bottom) - last15.c * 0.0025;
const risk = (last15.c - stop) / last15.c;
const reward = box.top - last15.c;
const rrRatio = reward / (last15.c - stop);

console.log("\n[Debug variables]:");
console.log("- last15.l:", last15.l, "box.bottom:", box.bottom, "tolerance:", box.bottom + (box.top - box.bottom) * 0.25);
console.log("- lowerWick:", lowerWick, "rng:", rng, "ratio:", lowerWick / rng);
console.log("- risk:", (risk * 100).toFixed(2) + "%");
console.log("- rrRatio:", rrRatio.toFixed(2));

const sig = detectDarvasSignal("BTC", candles, { allowLong: true, isBtcStrongPump: false });
console.log("\n[Test 2] Kết quả Bắt Tín Hiệu Nhịp Test Đáy Lần 2:");
if (sig && sig.kind === "DARVAS_2ND_BOUNCE") {
  console.log("✅ THÀNH CÔNG: Đã bắt đúng Setup Săn Đáy Lần 2!");
  console.log("- Entry:", sig.entry);
  console.log("- Stop Loss (ngay dưới đáy hộp):", sig.stop.toFixed(1));
  console.log("- TP1 (Cạnh trên đỉnh hộp):", sig.tp1);
  console.log("- R:R:", sig.rrRatio);
  console.log("- Ghi chú:", sig.note);
} else {
  console.log("Sig:", sig);
  throw new Error("LỖI: Chưa bắt được tín hiệu DARVAS_2ND_BOUNCE!");
}

console.log("\n=== TEST HOÀN TẤT THÀNH CÔNG 100%! ===");
