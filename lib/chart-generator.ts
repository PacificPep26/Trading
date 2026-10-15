import type { Candle } from "./okx";

export type ChartIndicators = {
  ma5: number[];
  ma10: number[];
  ma20: number[];
  bollUB: number[];
  bollLB: number[];
  supertrend: number[];
  support: number;
  resistance: number;
};

/**
 * Tính toán các chỉ báo kỹ thuật cơ bản từ chuỗi nến
 */
export function calculateSeriesIndicators(candles: Candle[]): ChartIndicators {
  const n = candles.length;
  const closes = candles.map((c) => c.c);

  const ma5 = closes.map((_, i) => (i < 4 ? null : candles.slice(i - 4, i + 1).reduce((s, x) => s + x.c, 0) / 5)) as number[];
  const ma10 = closes.map((_, i) => (i < 9 ? null : candles.slice(i - 9, i + 1).reduce((s, x) => s + x.c, 0) / 10)) as number[];
  const ma20 = closes.map((_, i) => (i < 19 ? null : candles.slice(i - 19, i + 1).reduce((s, x) => s + x.c, 0) / 20)) as number[];

  // Bollinger Bands 20, 2
  const bollUB: number[] = [];
  const bollLB: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < 19 || !ma20[i]) {
      bollUB.push(null as unknown as number);
      bollLB.push(null as unknown as number);
      continue;
    }
    const slice = closes.slice(i - 19, i + 1);
    const m = ma20[i];
    const variance = slice.reduce((s, x) => s + Math.pow(x - m, 2), 0) / 20;
    const std = Math.sqrt(variance);
    bollUB.push(m + 2 * std);
    bollLB.push(m - 2 * std);
  }

  // Supertrend ATR 10, Multiplier 3
  const supertrend: number[] = [];
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

  const support = Math.min(...candles.slice(-20).map((c) => c.l));
  const resistance = Math.max(...candles.slice(-20).map((c) => c.h));

  return { ma5, ma10, ma20, bollUB, bollLB, supertrend, support, resistance };
}

/**
 * Sinh ảnh PNG biểu đồ nến + toàn bộ các đường chỉ báo theo phong cách chuyên nghiệp (Dark Theme OKX)
 * Dùng QuickChart API (miễn phí, không phụ thuộc C++ native addons)
 */
export async function generateCandleChartPng(params: {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  statusText?: string;
  side?: number;
}): Promise<Buffer | null> {
  const { symbol, timeframe, candles: rawCandles, statusText } = params;
  const candles = rawCandles.filter((c) => c.closed !== false).slice(-30);
  if (candles.length < 15) return null;

  try {
    const labels = candles.map((c) =>
      new Date(c.t).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })
    );
    const closes = candles.map((c) => c.c);
    const ind = calculateSeriesIndicators(candles);

    const lastPrice = closes.at(-1) ?? 0;
    const titleText = `${symbol} [${timeframe}] · ${lastPrice.toFixed(lastPrice > 100 ? 1 : 4)} · ${statusText ?? ""}`;

    const chartConfig = {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Giá đóng",
            data: closes,
            borderColor: "#089981",
            borderWidth: 2.5,
            fill: false,
            pointRadius: 0,
            tension: 0.1,
          },
          {
            label: "MA5",
            data: ind.ma5,
            borderColor: "#ffeb3b",
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
          },
          {
            label: "MA10",
            data: ind.ma10,
            borderColor: "#00e5ff",
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
          },
          {
            label: "MA20",
            data: ind.ma20,
            borderColor: "#e040fb",
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
          },
          {
            label: "Bollinger UB",
            data: ind.bollUB,
            borderColor: "#2962ff",
            borderWidth: 1.2,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0,
          },
          {
            label: "Bollinger LB",
            data: ind.bollLB,
            borderColor: "#2962ff",
            borderWidth: 1.2,
            borderDash: [4, 4],
            fill: false,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: false,
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: { color: "#d1d4dc", boxWidth: 12, font: { size: 11 } },
          },
          title: {
            display: true,
            text: titleText,
            color: "#ffffff",
            font: { size: 15, weight: "bold" },
            padding: { top: 10, bottom: 12 },
          },
        },
        scales: {
          x: {
            ticks: { color: "#787b86", font: { size: 10 }, maxRotation: 0 },
            grid: { color: "#242832" },
          },
          y: {
            position: "right",
            ticks: { color: "#d1d4dc", font: { size: 11 } },
            grid: { color: "#242832" },
          },
        },
      },
    };

    const res = await fetch("https://quickchart.io/chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backgroundColor: "#131722",
        width: 800,
        height: 440,
        format: "png",
        chart: chartConfig,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.error("[QUICKCHART] Response not ok:", res.status);
      return null;
    }

    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch (e) {
    console.error("[CHART_GEN] Error generating chart:", e);
    return null;
  }
}
