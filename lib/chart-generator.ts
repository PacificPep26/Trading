import { Resvg } from "@resvg/resvg-js";
import type { Candle } from "./okx";

export type ChartIndicators = {
  ma5: (number | null)[];
  ma10: (number | null)[];
  ma20: (number | null)[];
  bollUB: (number | null)[];
  bollLB: (number | null)[];
  supertrend: (number | null)[];
  stSide: 1 | -1;
  support: number;
  resistance: number;
  rsi14: (number | null)[];
};

/**
 * Tính toán mảng chỉ số kỹ thuật cho từng nến
 */
export function calculateSeriesIndicators(candles: Candle[]): ChartIndicators {
  const n = candles.length;
  const closes = candles.map((c) => c.c);

  const ma5 = closes.map((_, i) => (i < 4 ? null : candles.slice(i - 4, i + 1).reduce((s, x) => s + x.c, 0) / 5));
  const ma10 = closes.map((_, i) => (i < 9 ? null : candles.slice(i - 9, i + 1).reduce((s, x) => s + x.c, 0) / 10));
  const ma20 = closes.map((_, i) => (i < 19 ? null : candles.slice(i - 19, i + 1).reduce((s, x) => s + x.c, 0) / 20));

  // Bollinger Bands (20, 2)
  const bollUB: (number | null)[] = [];
  const bollLB: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const m = ma20[i];
    if (i < 19 || m === null) {
      bollUB.push(null);
      bollLB.push(null);
      continue;
    }
    const slice = closes.slice(i - 19, i + 1);
    const variance = slice.reduce((s, x) => s + Math.pow(x - m, 2), 0) / 20;
    const std = Math.sqrt(variance);
    bollUB.push(m + 2 * std);
    bollLB.push(m - 2 * std);
  }

  // Supertrend ATR 10, Multiplier 3
  const supertrend: (number | null)[] = [];
  let atr = candles[0].h - candles[0].l;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    atr = (atr * 9 + tr) / 10;
    const hl2 = (candles[i].h + candles[i].l) / 2;
    const isBull = closes[i] >= hl2;
    supertrend.push(isBull ? hl2 - 3 * atr : hl2 + 3 * atr);
  }
  const lastC = closes[n - 1] ?? 0;
  const lastSt = supertrend.at(-1) ?? lastC;
  const stSide: 1 | -1 = lastC >= lastSt ? 1 : -1;

  // RSI(14)
  const rsi14: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (i < 14) {
      rsi14.push(null);
      continue;
    }
    let gains = 0, losses = 0;
    for (let j = i - 13; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    if (avgLoss === 0) rsi14.push(100);
    else {
      const rs = avgGain / avgLoss;
      rsi14.push(100 - (100 / (1 + rs)));
    }
  }

  const support = Math.min(...candles.slice(-20).map((c) => c.l));
  const resistance = Math.max(...candles.slice(-20).map((c) => c.h));

  return { ma5, ma10, ma20, bollUB, bollLB, supertrend, stSide, support, resistance, rsi14 };
}

/**
 * Tạo ảnh PNG biểu đồ NẾN NHẬT CHUẨN TRADINGVIEW (Candlesticks + Wicks + MA + Bollinger + Supertrend + Kèo Entry/TP/SL)
 */
export async function generateCandleChartPng(params: {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  statusText?: string;
  entry?: number;
  stop?: number;
  tp?: number;
  zone?: { top: number; bottom: number; label: string; side?: 1 | -1 };
  width?: number;
  height?: number;
}): Promise<Buffer | null> {
  const {
    symbol,
    timeframe,
    candles: rawCandles,
    statusText,
    entry,
    stop,
    tp,
    zone,
    width = 920,
    height = 580,
  } = params;

  // Lấy 60 nến gần nhất (15 giờ trên M15) để bao quát toàn bộ cấu trúc nền và bối cảnh thị trường
  const closed = rawCandles.filter((c) => c.closed !== false);
  const n = closed.length;
  if (n < 15) return null;

  const displayCount = Math.min(60, n);
  const candles = closed.slice(-displayCount);
  const ind = calculateSeriesIndicators(closed);

  // Cắt các mảng chỉ số tương ứng với displayCount nến hiển thị
  const sliceInd = {
    ma5: ind.ma5.slice(-displayCount),
    ma10: ind.ma10.slice(-displayCount),
    ma20: ind.ma20.slice(-displayCount),
    bollUB: ind.bollUB.slice(-displayCount),
    bollLB: ind.bollLB.slice(-displayCount),
    supertrend: ind.supertrend.slice(-displayCount),
    rsi14: ind.rsi14.slice(-displayCount),
  };

  // Tọa độ các khung
  const paddingLeft = 16;
  const paddingRight = 85;
  const paddingTop = 65;
  const mainHeight = 350;
  const gap = 12;
  const volHeight = 40;
  const rsiHeight = 55;

  const mainTop = paddingTop;
  const mainBottom = mainTop + mainHeight;
  const volTop = mainBottom + gap;
  const volBottom = volTop + volHeight;
  const rsiTop = volBottom + gap;
  const rsiBottom = rsiTop + rsiHeight;

  // Tìm min/max giá của nến và các đường chỉ báo để scale trục Y
  let minP = Math.min(...candles.map((c) => c.l));
  let maxP = Math.max(...candles.map((c) => c.h));

  if (entry) { minP = Math.min(minP, entry); maxP = Math.max(maxP, entry); }
  if (stop) { minP = Math.min(minP, stop); maxP = Math.max(maxP, stop); }
  if (tp) { minP = Math.min(minP, tp); maxP = Math.max(maxP, tp); }

  for (const v of sliceInd.bollUB) if (v !== null) maxP = Math.max(maxP, v);
  for (const v of sliceInd.bollLB) if (v !== null) minP = Math.min(minP, v);

  const pRange = maxP - minP || 1;
  const pMargin = pRange * 0.06;
  const yMin = minP - pMargin;
  const yMax = maxP + pMargin;
  const yRange = yMax - yMin;

  const maxVol = Math.max(...candles.map((c) => c.v || 0)) || 1;

  const chartWidth = width - paddingLeft - paddingRight;
  const step = chartWidth / displayCount;
  const candleBodyWidth = Math.max(6, step * 0.68);

  const yPrice = (p: number) => mainBottom - ((p - yMin) / yRange) * mainHeight;
  const yVol = (v: number) => volBottom - (v / maxVol) * volHeight;
  const yRsi = (r: number) => rsiBottom - (Math.min(100, Math.max(0, r)) / 100) * rsiHeight;

  const elements: string[] = [];

  // Nền chính phong cách TradingView Pro Dark
  elements.push(`<rect width="${width}" height="${height}" fill="#131722"/>`);

  // Lưới giá ngang (Grid lines) & Nhãn trục Y bên phải
  const gridSteps = 6;
  for (let i = 0; i <= gridSteps; i++) {
    const p = yMin + (yRange / gridSteps) * i;
    const y = yPrice(p);
    elements.push(`<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#202430" stroke-width="1" stroke-dasharray="2 3"/>`);
    elements.push(`<text x="${width - paddingRight + 8}" y="${y + 4}" fill="#787b86" font-size="11" font-family="monospace">${p.toFixed(p > 100 ? 1 : 4)}</text>`);
  }

  // 🟦 HỘP DARVAS BOX / FVG / ORDER BLOCK / VÙNG CUNG CẦU (SHADED BUY/SELL ZONE)
  if (zone && zone.top && zone.bottom) {
    const yTop = yPrice(Math.max(zone.top, zone.bottom));
    const yBottom = yPrice(Math.min(zone.top, zone.bottom));
    const boxHeight = Math.max(4, yBottom - yTop);
    const isDarvas = zone.label.toLowerCase().includes("darvas") || zone.label.toLowerCase().includes("hộp");
    const isBullZone = zone.side === 1 || zone.label.toLowerCase().includes("buy") || zone.label.toLowerCase().includes("cầu");
    
    const fillColor = isDarvas
      ? "rgba(171, 71, 188, 0.22)" // Màu tím đặc trưng của hộp Darvas
      : isBullZone
      ? "rgba(8, 153, 129, 0.18)"
      : "rgba(242, 54, 69, 0.18)";
    const strokeColor = isDarvas ? "#ab47bc" : isBullZone ? "#089981" : "#f23645";

    elements.push(`<rect x="${paddingLeft}" y="${yTop}" width="${chartWidth}" height="${boxHeight}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5" stroke-dasharray="3 3"/>`);
    elements.push(`<rect x="${paddingLeft + 8}" y="${yTop + 4}" width="220" height="18" fill="${strokeColor}" rx="3" opacity="0.90"/>`);
    elements.push(`<text x="${paddingLeft + 14}" y="${yTop + 16}" fill="#ffffff" font-size="10" font-weight="bold">${zone.label} (${zone.bottom.toFixed(zone.bottom > 100 ? 1 : 4)} - ${zone.top.toFixed(zone.top > 100 ? 1 : 4)})</text>`);
  }

  // Kháng cự & Hỗ trợ (Resistance / Support)
  if (ind.resistance) {
    const yr = yPrice(ind.resistance);
    elements.push(`<line x1="${paddingLeft}" y1="${yr}" x2="${width - paddingRight}" y2="${yr}" stroke="#f23645" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.6"/>`);
    elements.push(`<text x="${paddingLeft + 6}" y="${yr - 4}" fill="#f23645" font-size="10" font-weight="bold">Kháng cự: ${ind.resistance.toFixed(ind.resistance > 100 ? 1 : 4)}</text>`);
  }
  if (ind.support) {
    const ys = yPrice(ind.support);
    elements.push(`<line x1="${paddingLeft}" y1="${ys}" x2="${width - paddingRight}" y2="${ys}" stroke="#089981" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.6"/>`);
    elements.push(`<text x="${paddingLeft + 6}" y="${ys - 4}" fill="#089981" font-size="10" font-weight="bold">Hỗ trợ: ${ind.support.toFixed(ind.support > 100 ? 1 : 4)}</text>`);
  }

  // Bollinger Bands (UB / LB)
  const ubPoints: string[] = [];
  const lbPoints: string[] = [];
  for (let i = 0; i < displayCount; i++) {
    const x = paddingLeft + i * step + step / 2;
    if (sliceInd.bollUB[i] !== null) ubPoints.push(`${x},${yPrice(sliceInd.bollUB[i]!)}`);
    if (sliceInd.bollLB[i] !== null) lbPoints.push(`${x},${yPrice(sliceInd.bollLB[i]!)}`);
  }
  if (ubPoints.length > 1) {
    elements.push(`<polyline points="${ubPoints.join(" ")}" fill="none" stroke="#2962ff" stroke-width="1.2" stroke-dasharray="3 3"/>`);
  }
  if (lbPoints.length > 1) {
    elements.push(`<polyline points="${lbPoints.join(" ")}" fill="none" stroke="#2962ff" stroke-width="1.2" stroke-dasharray="3 3"/>`);
  }

  // MA Lines (MA5: Vàng, MA10: Cyan, MA20: Magenta)
  const ma5Points: string[] = [];
  const ma10Points: string[] = [];
  const ma20Points: string[] = [];
  for (let i = 0; i < displayCount; i++) {
    const x = paddingLeft + i * step + step / 2;
    if (sliceInd.ma5[i] !== null) ma5Points.push(`${x},${yPrice(sliceInd.ma5[i]!)}`);
    if (sliceInd.ma10[i] !== null) ma10Points.push(`${x},${yPrice(sliceInd.ma10[i]!)}`);
    if (sliceInd.ma20[i] !== null) ma20Points.push(`${x},${yPrice(sliceInd.ma20[i]!)}`);
  }
  if (ma20Points.length > 1) {
    elements.push(`<polyline points="${ma20Points.join(" ")}" fill="none" stroke="#ab47bc" stroke-width="1.5"/>`);
  }
  if (ma10Points.length > 1) {
    elements.push(`<polyline points="${ma10Points.join(" ")}" fill="none" stroke="#00e5ff" stroke-width="1.5"/>`);
  }
  if (ma5Points.length > 1) {
    elements.push(`<polyline points="${ma5Points.join(" ")}" fill="none" stroke="#ffeb3b" stroke-width="1.8"/>`);
  }

  // ĐƯỜNG KÈO THỰC CHIẾN: Entry, SL, TP (nếu có kèo)
  if (entry) {
    const ye = yPrice(entry);
    elements.push(`<line x1="${paddingLeft}" y1="${ye}" x2="${width - paddingRight}" y2="${ye}" stroke="#ffeb3b" stroke-width="1.8" stroke-dasharray="5 3"/>`);
    elements.push(`<rect x="${width - paddingRight + 4}" y="${ye - 10}" width="76" height="18" fill="#ffeb3b" rx="2"/>`);
    elements.push(`<text x="${width - paddingRight + 8}" y="${ye + 3}" fill="#000000" font-size="10" font-weight="bold">ENTRY ${entry.toFixed(entry > 100 ? 1 : 4)}</text>`);
  }
  if (stop) {
    const ysl = yPrice(stop);
    elements.push(`<line x1="${paddingLeft}" y1="${ysl}" x2="${width - paddingRight}" y2="${ysl}" stroke="#f23645" stroke-width="1.8" stroke-dasharray="5 3"/>`);
    elements.push(`<rect x="${width - paddingRight + 4}" y="${ysl - 10}" width="76" height="18" fill="#f23645" rx="2"/>`);
    elements.push(`<text x="${width - paddingRight + 8}" y="${ysl + 3}" fill="#ffffff" font-size="10" font-weight="bold">SL ${stop.toFixed(stop > 100 ? 1 : 4)}</text>`);
  }
  if (tp) {
    const ytp = yPrice(tp);
    elements.push(`<line x1="${paddingLeft}" y1="${ytp}" x2="${width - paddingRight}" y2="${ytp}" stroke="#089981" stroke-width="1.8" stroke-dasharray="5 3"/>`);
    elements.push(`<rect x="${width - paddingRight + 4}" y="${ytp - 10}" width="76" height="18" fill="#089981" rx="2"/>`);
    elements.push(`<text x="${width - paddingRight + 8}" y="${ytp + 3}" fill="#ffffff" font-size="10" font-weight="bold">TP ${tp.toFixed(tp > 100 ? 1 : 4)}</text>`);
  }

  // KHUNG SUB-PANEL KHỐI LƯỢNG (VOLUME PANEL)
  elements.push(`<rect x="${paddingLeft}" y="${volTop}" width="${chartWidth}" height="${volHeight}" fill="#171b26" stroke="#252934"/>`);
  elements.push(`<text x="${paddingLeft + 6}" y="${volTop + 14}" fill="#787b86" font-size="10" font-weight="bold">VOL / SMA20</text>`);

  // Tính MA20 của Volume
  const vols = candles.map((c) => c.v || 0);
  const volMa20: (number | null)[] = [];
  for (let i = 0; i < displayCount; i++) {
    if (i < 4) {
      volMa20.push(null);
    } else {
      const slice = vols.slice(Math.max(0, i - 19), i + 1);
      volMa20.push(slice.reduce((s, x) => s + x, 0) / slice.length);
    }
  }

  // VẼ TỪNG CÂY NẾN NHẬT (CANDLESTICKS VỚI ĐẦY ĐỦ THÂN VÀ RÂU NÉT CĂNG)
  for (let i = 0; i < displayCount; i++) {
    const c = candles[i];
    const x = paddingLeft + i * step + step / 2;
    const isBull = c.c >= c.o;
    const color = isBull ? "#089981" : "#f23645";

    const yH = yPrice(c.h);
    const yL = yPrice(c.l);
    const yO = yPrice(c.o);
    const yC = yPrice(c.c);

    // 1. Râu trên và râu dưới
    elements.push(`<line x1="${x}" y1="${yH}" x2="${x}" y2="${yL}" stroke="${color}" stroke-width="1.4"/>`);

    // 2. Thân nến Nhật (Candle Body)
    const topY = Math.min(yO, yC);
    const botY = Math.max(yO, yC);
    const bHeight = Math.max(2, botY - topY);

    elements.push(`<rect x="${x - candleBodyWidth / 2}" y="${topY}" width="${candleBodyWidth}" height="${bHeight}" fill="${color}" stroke="${color}" stroke-width="1" rx="0.5"/>`);

    // 3. Cột Volume ở sub-panel: làm nổi bật các cột Volume đột biến
    const v = c.v || 0;
    const vHeight = Math.max(2, (v / maxVol) * (volHeight - 6));
    const maV = volMa20[i] || 1;
    const isHighVol = v >= 1.5 * maV;
    const volOpacity = isHighVol ? "0.95" : "0.50";
    const volStroke = isHighVol ? (isBull ? "#00ffcc" : "#ff5252") : "none";

    elements.push(`<rect x="${x - candleBodyWidth / 2}" y="${volBottom - vHeight}" width="${candleBodyWidth}" height="${vHeight}" fill="${color}" opacity="${volOpacity}" stroke="${volStroke}" stroke-width="1"/>`);
  }

  // Đường MA20 Volume (Màu cam sáng)
  const volMaPoints: string[] = [];
  for (let i = 0; i < displayCount; i++) {
    const m = volMa20[i];
    if (m !== null) {
      const x = paddingLeft + i * step + step / 2;
      const y = volBottom - (m / maxVol) * (volHeight - 6);
      volMaPoints.push(`${x},${y}`);
    }
  }
  if (volMaPoints.length > 1) {
    elements.push(`<polyline points="${volMaPoints.join(" ")}" fill="none" stroke="#ff9800" stroke-width="1.3"/>`);
  }

  // Khung Sub-panel RSI(14)
  elements.push(`<rect x="${paddingLeft}" y="${rsiTop}" width="${chartWidth}" height="${rsiHeight}" fill="#171b26" stroke="#252934"/>`);
  const rsi70 = yRsi(70);
  const rsi30 = yRsi(30);
  elements.push(`<line x1="${paddingLeft}" y1="${rsi70}" x2="${width - paddingRight}" y2="${rsi70}" stroke="#50535e" stroke-dasharray="2 3"/>`);
  elements.push(`<line x1="${paddingLeft}" y1="${rsi30}" x2="${width - paddingRight}" y2="${rsi30}" stroke="#50535e" stroke-dasharray="2 3"/>`);
  elements.push(`<text x="${width - paddingRight + 8}" y="${rsi70 + 4}" fill="#787b86" font-size="10">70</text>`);
  elements.push(`<text x="${width - paddingRight + 8}" y="${rsi30 + 4}" fill="#787b86" font-size="10">30</text>`);

  const rsiPoints: string[] = [];
  for (let i = 0; i < displayCount; i++) {
    const x = paddingLeft + i * step + step / 2;
    const r = sliceInd.rsi14[i];
    if (r !== null) rsiPoints.push(`${x},${yRsi(r)}`);
  }
  if (rsiPoints.length > 1) {
    elements.push(`<polyline points="${rsiPoints.join(" ")}" fill="none" stroke="#7e57c2" stroke-width="1.6"/>`);
  }
  const curRsi = sliceInd.rsi14.at(-1) ?? 50;
  elements.push(`<text x="${paddingLeft + 6}" y="${rsiTop + 14}" fill="#d1d4dc" font-size="11">RSI(14): <tspan fill="#ab47bc" font-weight="bold">${curRsi.toFixed(1)}</tspan></text>`);

  // Tiêu đề & Header
  const lastC = candles.at(-1)?.c ?? 0;
  const isUp = candles.at(-1)!.c >= candles.at(-1)!.o;
  elements.push(`<text x="${paddingLeft}" y="25" fill="#ffffff" font-size="18" font-weight="bold">${symbol} <tspan fill="#787b86" font-size="14">${timeframe}</tspan></text>`);
  elements.push(`<text x="${paddingLeft + 180}" y="25" fill="${isUp ? "#089981" : "#f23645"}" font-size="18" font-weight="bold">${lastC.toFixed(lastC > 100 ? 1 : 4)}</text>`);

  if (statusText) {
    elements.push(`<text x="${width - paddingRight}" y="25" text-anchor="end" fill="#f7a600" font-size="13" font-weight="bold">${statusText}</text>`);
  }

  // Legend các đường chỉ báo ở trên cùng
  const curMa5 = sliceInd.ma5.at(-1)?.toFixed(lastC > 100 ? 1 : 4) ?? "—";
  const curMa10 = sliceInd.ma10.at(-1)?.toFixed(lastC > 100 ? 1 : 4) ?? "—";
  const curMa20 = sliceInd.ma20.at(-1)?.toFixed(lastC > 100 ? 1 : 4) ?? "—";
  const curUb = sliceInd.bollUB.at(-1)?.toFixed(lastC > 100 ? 1 : 4) ?? "—";
  const curLb = sliceInd.bollLB.at(-1)?.toFixed(lastC > 100 ? 1 : 4) ?? "—";

  elements.push(
    `<text x="${paddingLeft}" y="46" font-size="11" font-family="sans-serif">` +
    `<tspan fill="#ffeb3b" font-weight="bold">MA5: ${curMa5}</tspan>  ` +
    `<tspan fill="#00e5ff" font-weight="bold">MA10: ${curMa10}</tspan>  ` +
    `<tspan fill="#ab47bc" font-weight="bold">MA20: ${curMa20}</tspan>  ` +
    `<tspan fill="#2962ff">BOLL: [${curLb} - ${curUb}]</tspan>` +
    `</text>`
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${elements.join("\n    ")}
  </svg>`;

  try {
    const resvg = new Resvg(svg);
    const pngData = resvg.render().asPng();
    return Buffer.from(pngData);
  } catch (e) {
    console.error("[RESVG_ERR]", e);
    return null;
  }
}
