import crypto from "crypto";

export type MexcPosition = {
  symbol: string;
  coin: string;
  side: 1 | -1;
  entry: number;
  vol: number;
  leverage: number;
  unRealizedPnl: number;
  liquidatePrice: number;
  margin: number;
};

type RawMexcPosition = {
  symbol?: string;
  positionType?: number;
  state?: number;
  holdVol?: number | string;
  holdAvgPrice?: number | string;
  openAvgPrice?: number | string;
  leverage?: number | string;
  unRealizedPnl?: number | string;
  liquidatePrice?: number | string;
  im?: number | string;
  oim?: number | string;
};

/**
 * Lấy các vị thế Future đang mở trên MEXC (Read-Only).
 * Trả về rỗng nếu chưa có API key hoặc lỗi kết nối.
 */
export async function getMexcOpenPositions(): Promise<MexcPosition[]> {
  const apiKey = process.env.MEXC_API_KEY;
  const secret = process.env.MEXC_SECRET_KEY;
  if (!apiKey || !secret) return [];

  try {
    const ts = Date.now().toString();
    const sign = crypto.createHmac("sha256", secret).update(apiKey + ts).digest("hex");
    const res = await fetch("https://contract.mexc.com/api/v1/private/position/open_positions", {
      headers: {
        ApiKey: apiKey,
        "Request-Time": ts,
        Signature: sign,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`[MEXC] Positions HTTP ${res.status}:`, await res.text());
      return [];
    }

    const json = (await res.json()) as { success?: boolean; data?: RawMexcPosition[] };
    if (!json.success || !Array.isArray(json.data)) {
      console.error("[MEXC] Positions response failed:", json);
      return [];
    }

    return json.data
      .filter((p: RawMexcPosition) => p.state === 1 && Number(p.holdVol) > 0)
      .map((p: RawMexcPosition) => {
        const symbol = String(p.symbol || "");
        const coin = symbol.replace(/_USDT$/, "").replace(/-USDT$/, "");
        const side: 1 | -1 = p.positionType === 1 ? 1 : -1;
        return {
          symbol,
          coin,
          side,
          entry: Number(p.holdAvgPrice || p.openAvgPrice || 0),
          vol: Number(p.holdVol || 0),
          leverage: Number(p.leverage || 1),
          unRealizedPnl: Number(p.unRealizedPnl || 0),
          liquidatePrice: Number(p.liquidatePrice || 0),
          margin: Number(p.im || p.oim || 0),
        };
      });
  } catch (err) {
    console.error("[MEXC] Fetch open positions error:", err);
    return [];
  }
}
