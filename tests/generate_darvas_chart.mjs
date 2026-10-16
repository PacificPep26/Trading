import fs from "fs";
import path from "path";
import { generateCandleChartPng } from "../lib/chart-generator.ts";
import { extractDarvasBox, detectDarvasSignal } from "../lib/darvas-box.ts";

function makeCandle(t, o, h, l, c, v = 1000) {
  return { t, o, h, l, c, v, closed: true };
}

const M15 = 15 * 60 * 1000;
const now = Date.now();
const candles = [];

// Tái hiện chính xác hình ảnh BTC trên sàn OKX của Victor:
// Chiếc hộp tím cạnh dưới 81,650 - cạnh trên 82,650
const boxTop = 82650;
const boxBottom = 81650;

// 1. Quá trình đi ngang trong hộp (40 nến ~ 10 tiếng)
for (let i = 0; i < 35; i++) {
  const t = now - (40 - i) * M15;
  const o = 82000 + Math.sin(i) * 250;
  const c = 82000 + Math.cos(i) * 250;
  const h = Math.max(o, c) + 120;
  const l = Math.min(o, c) - 120;
  candles.push(makeCandle(t, o, Math.min(boxTop, h), Math.max(boxBottom + 100, l), c, 2000));
}

// 2. Nhịp test đáy lần 1: Nến đâm xuống 81,660 rút chân lên 82,100
candles.push(makeCandle(now - 4 * M15, 82100, 82150, 81660, 82050, 4200));

// 3. Nến đi ngang hồi nhẹ
candles.push(makeCandle(now - 3 * M15, 82050, 82300, 82000, 82250, 2500));
candles.push(makeCandle(now - 2 * M15, 82250, 82350, 82100, 82150, 2200));

// 4. Nhịp test đáy lần 2 (ĐÚNG NHẬN ĐỊNH CỦA VICTOR):
// Giá đạp về 81,680 (chạm cạnh dưới hộp tím lần 2), rút chân nến búa Pinbar mạnh mẽ đóng tại 81,850
candles.push(makeCandle(now - M15, 81820, 81890, 81680, 81860, 5800));

// Kiểm tra tín hiệu từ bot
const sig = detectDarvasSignal("BTC", candles, { allowLong: true, isBtcStrongPump: false });
if (!sig) {
  console.error("Lỗi: Bot không bắt được tín hiệu!");
  process.exit(1);
}

console.log("✅ Đã bắt đúng Setup:", sig.kind);
console.log("- Entry:", sig.entry);
console.log("- Stop Loss:", sig.stop);
console.log("- Take Profit (Đỉnh Hộp):", sig.tp1);

// Xuất biểu đồ vẽ Hộp Darvas màu tím + Entry/SL/TP
const chartBuf = await generateCandleChartPng({
  symbol: "BTC/USDT",
  timeframe: "15m",
  candles,
  statusText: "DARVAS BOX: NHỊP TEST ĐÁY LẦN 2 (2ND WICK BOUNCE)",
  entry: sig.entry,
  stop: sig.stop,
  tp: sig.tp1,
  zone: {
    top: sig.box.top,
    bottom: sig.box.bottom,
    label: "Hộp Darvas (Nicolas Darvas)",
    side: 1,
  },
});

const outPath = "C:/Users/HP/.gemini/antigravity/brain/b41f11af-1e9c-4f79-b5d6-13d28014757c/darvas_box_simulation.png";
fs.writeFileSync(outPath, chartBuf);
console.log(`\n🎉 ĐÃ XUẤT ẢNH BIỂU ĐỒ MINH HỌA TẠI: ${outPath}`);
