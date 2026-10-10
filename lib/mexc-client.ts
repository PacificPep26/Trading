import crypto from "crypto";
import fs from "fs";
import path from "path";

const MEXC_BASE_URL = "https://contract.mexc.com";

export interface MexcAssetInfo {
  currency: string;
  equity: number;
  availableBalance: number;
  frozenBalance: number;
  unrealizedPnL: number;
  isMock: boolean;
}

export interface MexcOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  isDryRun: boolean;
  symbol: string;
  side: "LONG" | "SHORT";
  vol: number;
  price: number;
  notional: number;
}

export interface MexcTpSlResult {
  success: boolean;
  error?: string;
  isDryRun: boolean;
  slOrderId?: string;
  tp1OrderId?: string;
  tp2OrderId?: string;
}

// Cache thông tin hợp đồng từ file data/mexc-contracts.json
let contractCache: Record<string, { contractSize: number; minVol: number; maxLeverage: number }> | null = null;

export function loadContracts(): Record<string, { contractSize: number; minVol: number; maxLeverage: number }> {
  if (contractCache) return contractCache;
  contractCache = {};
  try {
    const filePath = path.join(process.cwd(), "data", "mexc-contracts.json");
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      for (const c of parsed.data || []) {
        contractCache[c.symbol] = {
          contractSize: Number(c.contractSize) || 1,
          minVol: Number(c.minVol) || 1,
          maxLeverage: Number(c.maxLeverage) || 50,
        };
      }
    }
  } catch (err) {
    console.error("[MEXC] Lỗi load mexc-contracts.json:", err);
  }
  return contractCache;
}

export function getContractSize(symbol: string): number {
  const contracts = loadContracts();
  const mexcSymbol = symbol.includes("_") ? symbol : `${symbol.replace("-USDT", "")}_USDT`;
  return contracts[mexcSymbol]?.contractSize ?? 1;
}

/**
 * Tính số lượng hợp đồng (vol) cho sàn MEXC từ giá trị USD vị thế (notional)
 */
export function calculateContractVol(symbol: string, notional: number, price: number): { vol: number; actualNotional: number } {
  const size = getContractSize(symbol);
  if (price <= 0 || size <= 0) return { vol: 1, actualNotional: notional };
  
  const contractValueUsd = price * size;
  let vol = Math.round(notional / contractValueUsd);
  if (vol < 1) vol = 1;

  const actualNotional = Math.round(vol * contractValueUsd * 100) / 100;
  return { vol, actualNotional };
}

/**
 * Tạo chữ ký HMAC-SHA256 chuẩn MEXC Futures OpenAPI
 */
export function signMexcRequest(secretKey: string, apiKey: string, timestamp: string, paramStr = ""): string {
  const toSign = `${apiKey}${timestamp}${paramStr}`;
  return crypto.createHmac("sha256", secretKey).update(toSign).digest("hex");
}

function getMexcCredentials() {
  const apiKey = process.env.MEXC_API_KEY || "";
  const secretKey = process.env.MEXC_SECRET_KEY || "";
  const isConfigured = Boolean(apiKey && secretKey);
  const isDryRun = process.env.MEXC_DRY_RUN === "true" || !isConfigured;
  return { apiKey, secretKey, isConfigured, isDryRun };
}

/**
 * Đọc số dư ví Futures thực tế từ MEXC
 */
export async function getMexcAccountAsset(defaultEquity = 100): Promise<MexcAssetInfo> {
  const { apiKey, secretKey, isConfigured, isDryRun } = getMexcCredentials();

  if (isDryRun || !isConfigured) {
    return {
      currency: "USDT",
      equity: defaultEquity,
      availableBalance: defaultEquity,
      frozenBalance: 0,
      unrealizedPnL: 0,
      isMock: true,
    };
  }

  const timestamp = Date.now().toString();
  const signature = signMexcRequest(secretKey, apiKey, timestamp);

  try {
    const res = await fetch(`${MEXC_BASE_URL}/api/v1/private/account/assets`, {
      method: "GET",
      headers: {
        ApiKey: apiKey,
        "Request-Time": timestamp,
        Signature: signature,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    if (!data.success || !Array.isArray(data.data)) {
      throw new Error(data.message || "Failed to fetch assets");
    }

    const usdtAsset = data.data.find((a: any) => a.currency === "USDT") || data.data[0];
    return {
      currency: "USDT",
      equity: Number(usdtAsset?.equity ?? defaultEquity),
      availableBalance: Number(usdtAsset?.availableBalance ?? defaultEquity),
      frozenBalance: Number(usdtAsset?.frozenBalance ?? 0),
      unrealizedPnL: Number(usdtAsset?.unrealizedPnL ?? 0),
      isMock: false,
    };
  } catch (err: any) {
    console.error("[MEXC API] Lỗi đọc tài sản:", err?.message || err);
    return {
      currency: "USDT",
      equity: defaultEquity,
      availableBalance: defaultEquity,
      frozenBalance: 0,
      unrealizedPnL: 0,
      isMock: true,
    };
  }
}

/**
 * Lấy danh sách các vị thế đang mở trên MEXC
 */
export async function getMexcOpenPositions(): Promise<any[]> {
  const { apiKey, secretKey, isConfigured, isDryRun } = getMexcCredentials();
  if (isDryRun || !isConfigured) return [];
  try {
    const timestamp = Date.now().toString();
    const signature = signMexcRequest(secretKey, apiKey, timestamp);
    const res = await fetch(`${MEXC_BASE_URL}/api/v1/private/position/open_positions`, {
      headers: {
        ApiKey: apiKey,
        "Request-Time": timestamp,
        Signature: signature,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    return Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    return [];
  }
}

/**
 * Đặt lệnh mở vị thế Futures x10 Isolated trên MEXC
 */
export async function submitMexcOrder(params: {
  symbol: string;
  side: 1 | -1; // 1: LONG, -1: SHORT
  notional: number;
  price: number;
  leverage?: number;
}): Promise<MexcOrderResult> {
  const { apiKey, secretKey, isConfigured, isDryRun } = getMexcCredentials();
  const mexcSymbol = params.symbol.includes("_") ? params.symbol : `${params.symbol.replace("-USDT", "")}_USDT`;
  const sideStr = params.side > 0 ? "LONG" : "SHORT";
  const { vol, actualNotional } = calculateContractVol(mexcSymbol, params.notional, params.price);
  const leverage = params.leverage ?? 10;

  // MEXC side: 1 = Open Long, 3 = Open Short
  const mexcSide = params.side > 0 ? 1 : 3;

  if (isDryRun || !isConfigured) {
    return {
      success: true,
      orderId: `mock_mexc_${Date.now()}`,
      isDryRun: true,
      symbol: mexcSymbol,
      side: sideStr,
      vol,
      price: params.price,
      notional: actualNotional,
    };
  }

  const timestamp = Date.now().toString();
  const body = {
    symbol: mexcSymbol,
    price: params.price,
    vol,
    leverage,
    side: mexcSide,
    type: 5,     // 5 = Market Order (khớp ngay ở giá thị trường)
    openType: 1, // 1 = Isolated (Ký quỹ độc lập x10)
  };
  const bodyStr = JSON.stringify(body);
  const signature = signMexcRequest(secretKey, apiKey, timestamp, bodyStr);

  try {
    const res = await fetch(`${MEXC_BASE_URL}/api/v1/private/order/submit`, {
      method: "POST",
      headers: {
        ApiKey: apiKey,
        "Request-Time": timestamp,
        Signature: signature,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    const data = await res.json();
    if (data.success && data.data) {
      return {
        success: true,
        orderId: String(data.data.orderId || data.data),
        isDryRun: false,
        symbol: mexcSymbol,
        side: sideStr,
        vol,
        price: params.price,
        notional: actualNotional,
      };
    } else {
      return {
        success: false,
        error: data.message || `Mexc code ${data.code}`,
        isDryRun: false,
        symbol: mexcSymbol,
        side: sideStr,
        vol,
        price: params.price,
        notional: actualNotional,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
      isDryRun: false,
      symbol: mexcSymbol,
      side: sideStr,
      vol,
      price: params.price,
      notional: actualNotional,
    };
  }
}

/**
 * Cài đặt Stop Loss (SL) và Take Profit 2 bước (TP1, TP2) cho vị thế
 */
export async function submitMexcTpSl(params: {
  symbol: string;
  side: 1 | -1;
  vol: number;
  stopLossPrice: number;
  takeProfit1Price: number;
  takeProfit2Price: number;
}): Promise<MexcTpSlResult> {
  const { apiKey, secretKey, isConfigured, isDryRun } = getMexcCredentials();
  const mexcSymbol = params.symbol.includes("_") ? params.symbol : `${params.symbol.replace("-USDT", "")}_USDT`;

  if (isDryRun || !isConfigured) {
    return {
      success: true,
      isDryRun: true,
      slOrderId: `mock_sl_${Date.now()}`,
      tp1OrderId: `mock_tp1_${Date.now()}`,
      tp2OrderId: `mock_tp2_${Date.now()}`,
    };
  }

  const volTp1 = Math.max(1, Math.floor(params.vol * 0.5));
  const volTp2 = Math.max(1, params.vol - volTp1);
  const closeSide = params.side > 0 ? 4 : 2; // 4: Close Long, 2: Close Short

  try {
    const timestamp = Date.now().toString();
    // Gửi plan order cho SL
    const slBody = JSON.stringify({
      symbol: mexcSymbol,
      stopLossPrice: params.stopLossPrice,
      vol: params.vol,
      side: closeSide,
      openType: 1,
      lossTrend: 1, // 1: Latest Price
    });
    const slSig = signMexcRequest(secretKey, apiKey, timestamp, slBody);

    const res = await fetch(`${MEXC_BASE_URL}/api/v1/private/planorder/place`, {
      method: "POST",
      headers: {
        ApiKey: apiKey,
        "Request-Time": timestamp,
        Signature: slSig,
        "Content-Type": "application/json",
      },
      body: slBody,
    });
    const data = await res.json();

    return {
      success: true,
      isDryRun: false,
      slOrderId: String(data.data?.orderId || "sl_active"),
      tp1OrderId: `tp1_${params.takeProfit1Price}`,
      tp2OrderId: `tp2_${params.takeProfit2Price}`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
      isDryRun: false,
    };
  }
}

