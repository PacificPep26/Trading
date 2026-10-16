import fs from "fs";
import { generateCandleChartPng } from "../lib/chart-generator.ts";
import { candles as getCandles } from "../lib/okx.ts";

console.log("=== BẮT ĐẦU VẼ CHART THEO ĐÚNG HÌNH ẢNH TRỰC TIẾP CỦA VICTOR TRÊN OKX ===");

// Lấy nến 15m thật từ OKX
const raw = await getCandles("BTC-USDT-SWAP", "15m", 60);
const closed = raw.filter((c) => c.closed !== false);

// Tái hiện chính xác 2 chiếc hộp màu tím của Victor:
// 1. Hộp Đáy (Vùng gom hàng / Nhịp rút chân lần 2): 81,650 - 81,950
// 2. Hộp Đỉnh (Vùng chốt lời / Kháng cự): 82,500 - 82,800
const bottomBox = {
  top: 81950,
  bottom: 81650,
  label: "Hop Day Darvas - Vung Mua",
  side: 1,
  startIndex: 12,
  endIndex: 58,
};

const topBox = {
  top: 82800,
  bottom: 82500,
  label: "Hop Dinh Darvas - Vung TP",
  side: -1,
  startIndex: 12,
  endIndex: 58,
};

const lastPrice = closed.at(-1)?.c || 81700;

const chartBuf = await generateCandleChartPng({
  symbol: "BTC/USDT",
  timeframe: "15m",
  candles: closed,
  statusText: "HOP DARVAS: DAY HO TRO VA DINH CHOT LOI",
  entry: 81780,
  stop: 81540,
  tp: 82600,
  zone: bottomBox,
  zones: [topBox],
});

const outPath = "C:/Users/HP/.gemini/antigravity/brain/b41f11af-1e9c-4f79-b5d6-13d28014757c/darvas_boxes_okx_style.png";
fs.writeFileSync(outPath, chartBuf);
console.log(`\n🎉 ĐÃ VẼ XONG CHART THEO ĐÚNG HÌNH OKX TẠI: ${outPath}`);
