import fs from "fs";
import { generateCandleChartPng } from "../lib/chart-generator.ts";
import { detectDarvasSignal, extractDarvasBox } from "../lib/darvas-box.ts";

function makeCandle(t, o, h, l, c, v = 1000) {
  return { t, o, h, l, c, v, closed: true };
}

console.log("=== BẮT ĐẦU TEST KÈO DARVAS BOX BREAKOUT (PHÁ HỘP CHỒNG HỘP) ===");

const M15 = 15 * 60 * 1000;
const now = Date.now();
const candles = [];

// 1. Giai đoạn đi ngang tích luỹ trong hộp (Hộp 1: 81,600 - 82,300)
const boxTop = 82300;
const boxBottom = 81600;

for (let i = 0; i < 20; i++) {
  const t = now - (25 - i) * M15;
  candles.push(makeCandle(t, 81900, 82250, 81650, 82000, 2000));
}

// 2. Cú bùng nổ Breakout thật: Nến đâm thẳng vượt đỉnh hộp đóng tại 82,550 với Volume nổ 2.5x
candles.push(makeCandle(now - 2 * M15, 82100, 82600, 82050, 82550, 6000));

// 3. Nhịp Retest chuẩn sách giáo khoa Nicolas Darvas:
// Nến sau nhúng đỏ về chạm lại mép đỉnh hộp cũ (Low = 82,310), rút chân xanh đóng nến tại 82,480 giữ vững trên cản!
candles.push(makeCandle(now - M15, 82350, 82520, 82310, 82480, 4000));

const sig = detectDarvasSignal("BTC", candles, { allowLong: true, isBtcStrongPump: false });
if (!sig || sig.kind !== "DARVAS_BREAKOUT") {
  console.error("LỖI: Chưa bắt được tín hiệu DARVAS_BREAKOUT!", sig);
  process.exit(1);
}

console.log("✅ ĐÃ BẮT ĐÚNG KÈO DARVAS BREAKOUT:");
console.log("- Entry:", sig.entry);
console.log("- Stop Loss (dưới đỉnh hộp cũ):", sig.stop.toFixed(1));
console.log("- Take Profit 1 (Hộp mới cao hơn):", sig.tp1);
console.log("- Ghi chú:", sig.note);

// Xuất biểu đồ minh họa kèo Breakout
const chartBuf = await generateCandleChartPng({
  symbol: "BTC/USDT",
  timeframe: "15m",
  candles,
  statusText: "DARVAS BREAKOUT: BỨT PHÁ HỘP KÈM RETEST GIỮ ĐỈNH",
  entry: sig.entry,
  stop: sig.stop,
  tp: sig.tp1,
  zone: {
    top: boxTop,
    bottom: boxBottom,
    label: "Hộp Cũ Đã Phá (Biến thành Hỗ Trợ)",
    side: 1,
  },
  zones: [
    {
      top: sig.tp1,
      bottom: boxTop,
      label: "Hộp Mới Bậc Thang (Mục Tiêu TP)",
      side: 1,
    }
  ]
});

const outPath = "C:/Users/HP/.gemini/antigravity/brain/b41f11af-1e9c-4f79-b5d6-13d28014757c/darvas_breakout_simulation.png";
fs.writeFileSync(outPath, chartBuf);
console.log(`\n🎉 ĐÃ XUẤT ẢNH BIỂU ĐỒ BREAKOUT TẠI: ${outPath}`);
