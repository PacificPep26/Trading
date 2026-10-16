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

export type MexcAsset = {
  currency: string;
  equity: number;
  availableBalance: number;
  cashBalance: number;
  positionMargin: number;
  unrealized: number;
};

export type MexcHistoryOrder = {
  orderId: string;
  symbol: string;
  coin: string;
  side: number;
  price: number;
  vol: number;
  dealAvgPrice: number;
  profit: number;
  fee: number;
  pnlRate: number;
  createTime: number;
  updateTime: number;
};

/**
 * Lấy số dư ví Futures MEXC (USDT).
 */
export async function getMexcAccountAsset(): Promise<MexcAsset | null> {
  const apiKey = process.env.MEXC_API_KEY;
  const secret = process.env.MEXC_SECRET_KEY;
  if (!apiKey || !secret) return null;

  try {
    const ts = Date.now().toString();
    const sign = crypto.createHmac("sha256", secret).update(apiKey + ts).digest("hex");
    const res = await fetch("https://contract.mexc.com/api/v1/private/account/assets", {
      headers: {
        ApiKey: apiKey,
        "Request-Time": ts,
        Signature: sign,
      },
      cache: "no-store",
    });

    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: any[] };
    if (!json.success || !Array.isArray(json.data)) return null;

    const usdt = json.data.find((a: any) => a.currency === "USDT");
    if (!usdt) return null;

    return {
      currency: "USDT",
      equity: Number(usdt.equity || 0),
      availableBalance: Number(usdt.availableBalance || 0),
      cashBalance: Number(usdt.cashBalance || 0),
      positionMargin: Number(usdt.positionMargin || 0),
      unrealized: Number(usdt.unrealized || 0),
    };
  } catch (err) {
    console.error("[MEXC] Fetch account asset error:", err);
    return null;
  }
}

/**
 * Lấy lịch sử lệnh đã đóng trong ngày hôm nay trên MEXC để tính tổng PnL.
 */
export async function getMexcTodayOrders(): Promise<{
  totalProfit: number;
  totalFee: number;
  netProfit: number;
  winCount: number;
  lossCount: number;
  orders: MexcHistoryOrder[];
}> {
  const apiKey = process.env.MEXC_API_KEY;
  const secret = process.env.MEXC_SECRET_KEY;
  if (!apiKey || !secret) {
    return { totalProfit: 0, totalFee: 0, netProfit: 0, winCount: 0, lossCount: 0, orders: [] };
  }

  try {
    const ts = Date.now().toString();
    const query = "page_num=1&page_size=50";
    const sign = crypto.createHmac("sha256", secret).update(apiKey + ts + query).digest("hex");
    const res = await fetch(`https://contract.mexc.com/api/v1/private/order/list/history_orders?${query}`, {
      headers: {
        ApiKey: apiKey,
        "Request-Time": ts,
        Signature: sign,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return { totalProfit: 0, totalFee: 0, netProfit: 0, winCount: 0, lossCount: 0, orders: [] };
    }

    const json = (await res.json()) as { success?: boolean; data?: { resultList?: any[] } | any[] };
    const rawList: any[] = (json.data && !Array.isArray(json.data) ? json.data.resultList : json.data) || [];

    // Đầu ngày giờ VN (UTC+7)
    const now = new Date();
    const startOfDayVN = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 7 * 3600 * 1000;

    const todayOrders = rawList.filter((o) => {
      const t = Number(o.updateTime || o.createTime || 0);
      return t >= startOfDayVN && Number(o.state) === 3;
    });

    let totalProfit = 0;
    let totalFee = 0;
    let winCount = 0;
    let lossCount = 0;

    const orders: MexcHistoryOrder[] = todayOrders.map((o) => {
      const profit = Number(o.profit || 0);
      const fee = Math.abs(Number(o.totalFee || o.fee || o.takerFee || 0));
      totalProfit += profit;
      totalFee += fee;
      if (profit > 0) winCount++;
      else if (profit < 0) lossCount++;

      const symbol = String(o.symbol || "");
      const coin = symbol.replace(/_USDT$/, "").replace(/-USDT$/, "");
      return {
        orderId: String(o.orderId),
        symbol,
        coin,
        side: Number(o.side),
        price: Number(o.price || 0),
        vol: Number(o.vol || 0),
        dealAvgPrice: Number(o.dealAvgPrice || 0),
        profit,
        fee,
        pnlRate: Number(o.pnlRate || 0),
        createTime: Number(o.createTime || 0),
        updateTime: Number(o.updateTime || 0),
      };
    });

    const netProfit = totalProfit - totalFee;
    return { totalProfit, totalFee, netProfit, winCount, lossCount, orders };
  } catch (err) {
    console.error("[MEXC] Fetch today orders error:", err);
    return { totalProfit: 0, totalFee: 0, netProfit: 0, winCount: 0, lossCount: 0, orders: [] };
  }
}

export type SubmitMexcOrderParams = {
  symbol: string;
  side: 1 | 2 | 3 | 4; // 1: Open Long, 2: Close Short, 3: Open Short, 4: Close Long
  type: 1 | 5; // 1: Limit, 5: Market
  vol: number;
  price?: number;
  openType?: 1 | 2; // 1: Isolated, 2: Cross (mặc định 1)
  leverage?: number;
};

const contractDetailCache: Record<string, { contractSize: number; minVol: number; ts: number }> = {};

/**
 * Lấy contractSize của coin để tính toán số hợp đồng chính xác ứng với số tiền Margin mong muốn.
 */
export async function getMexcContractSize(symbol: string): Promise<number> {
  const cached = contractDetailCache[symbol];
  if (cached && Date.now() - cached.ts < 3600_000) {
    return cached.contractSize;
  }
  try {
    const res = await fetch(`https://contract.mexc.com/api/v1/contract/detail?symbol=${symbol}`);
    const data = await res.json();
    if (data.success && data.data?.contractSize) {
      const size = Number(data.data.contractSize);
      contractDetailCache[symbol] = { contractSize: size, minVol: Number(data.data.minVol || 1), ts: Date.now() };
      return size;
    }
  } catch (err) {
    console.error(`[MEXC] Lỗi lấy contract detail cho ${symbol}:`, err);
  }
  return 1;
}

/**
 * Tính số hợp đồng (vol) chuẩn xác để đảm bảo ký quỹ bằng đúng targetMargin (Mặc định 10$ USDT đòn bẩy x10).
 */
export async function calculateMexcVolForMargin(
  symbol: string,
  price: number,
  targetMarginUsdt: number = 10.0,
  leverage: number = 10
): Promise<number> {
  const contractSize = await getMexcContractSize(symbol);
  const notional = targetMarginUsdt * leverage; // 10 * 10 = 100 USDT
  const vol = Math.max(1, Math.round(notional / (price * contractSize)));
  return vol;
}

/**
 * Đặt lệnh Futures trực tiếp trên MEXC (Isolated, đòn bẩy tự cấu hình).
 */
export async function submitMexcOrder(params: SubmitMexcOrderParams): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const apiKey = process.env.MEXC_API_KEY;
  const secret = process.env.MEXC_SECRET_KEY;
  if (!apiKey || !secret) return { success: false, error: "Chưa cấu hình API Key" };

  try {
    const ts = Date.now().toString();
    const body: Record<string, any> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      vol: params.vol,
      openType: params.openType ?? 1,
    };
    if (params.price !== undefined) body.price = params.price;
    if (params.leverage !== undefined) body.leverage = params.leverage;

    const bodyStr = JSON.stringify(body);
    const sign = crypto.createHmac("sha256", secret).update(apiKey + ts + bodyStr).digest("hex");

    const res = await fetch("https://contract.mexc.com/api/v1/private/order/submit", {
      method: "POST",
      headers: {
        ApiKey: apiKey,
        "Request-Time": ts,
        Signature: sign,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    const data = await res.json();
    if (data.success && data.data) {
      return { success: true, orderId: String(data.data) };
    }
    return { success: false, error: data.message || `Mã lỗi ${data.code}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Huỷ lệnh trên sàn MEXC theo orderId.
 */
export async function cancelMexcOrder(orderId: string): Promise<boolean> {
  const apiKey = process.env.MEXC_API_KEY;
  const secret = process.env.MEXC_SECRET_KEY;
  if (!apiKey || !secret) return false;

  try {
    const ts = Date.now().toString();
    const bodyStr = JSON.stringify([orderId]);
    const sign = crypto.createHmac("sha256", secret).update(apiKey + ts + bodyStr).digest("hex");

    const res = await fetch("https://contract.mexc.com/api/v1/private/order/cancel", {
      method: "POST",
      headers: {
        ApiKey: apiKey,
        "Request-Time": ts,
        Signature: sign,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    const data = await res.json();
    return Boolean(data.success);
  } catch {
    return false;
  }
}

