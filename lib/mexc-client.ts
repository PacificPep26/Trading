import crypto from "crypto";
import fs from "fs";
import path from "path";

// MEXC retired contract.mexc.com in January 2026.
const MEXC_BASE_URL = "https://api.mexc.com";

interface MexcApiResponse<T> {
  success: boolean;
  code?: number;
  message?: string;
  data?: T;
}

export interface MexcPosition {
  positionId: string | number;
  symbol: string;
  holdVol: number;
  positionType: 1 | 2;
  state?: number;
  openAvgPrice?: number;
}

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
  slConfirmed?: boolean; // false = vị thế có thể đang không có SL → caller phải đóng
  slOrderId?: string;
  tp1OrderId?: string;
  tp2OrderId?: string;
}

import { MEXC_CONTRACT_SPECS } from "./mexc-contracts-data.ts";

// Cache thông tin hợp đồng từ file data/mexc-contracts.json (fallback vào MEXC_CONTRACT_SPECS)
let contractCache: Record<string, { contractSize: number; minVol: number; maxLeverage: number }> | null = null;

export function loadContracts(): Record<string, { contractSize: number; minVol: number; maxLeverage: number }> {
  if (contractCache) return contractCache;
  contractCache = { ...MEXC_CONTRACT_SPECS };
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
  const liveTradingEnabled = process.env.MEXC_LIVE_TRADING === "true";
  const isDryRun = process.env.MEXC_DRY_RUN !== "false" || !liveTradingEnabled || !isConfigured;
  return { apiKey, secretKey, isConfigured, isDryRun };
}

function apiError(data: MexcApiResponse<unknown>, fallback: string): Error {
  return new Error(data.message || (data.code !== undefined ? `MEXC code ${data.code}` : fallback));
}

/**
 * Đọc số dư ví Futures thực tế từ MEXC
 */
export async function getMexcAccountAsset(defaultEquity = 100): Promise<MexcAssetInfo> {
  const { apiKey, secretKey, isConfigured } = getMexcCredentials();

  if (!isConfigured) {
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

    const data = await res.json() as MexcApiResponse<Array<Record<string, unknown>>>;
    if (!res.ok || !data.success || !Array.isArray(data.data)) {
      throw apiError(data, `Failed to fetch assets (${res.status})`);
    }

    const usdtAsset = data.data.find((asset) => asset.currency === "USDT") || data.data[0];
    return {
      currency: "USDT",
      equity: Number(usdtAsset?.equity ?? defaultEquity),
      availableBalance: Number(usdtAsset?.availableBalance ?? defaultEquity),
      frozenBalance: Number(usdtAsset?.frozenBalance ?? 0),
      unrealizedPnL: Number(usdtAsset?.unrealized ?? 0),
      isMock: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[MEXC API] Không đọc được tài sản:", message);
    throw new Error(`MEXC_ACCOUNT_UNAVAILABLE: ${message}`);
  }
}

/**
 * Lấy danh sách các vị thế đang mở trên MEXC
 */
export async function getMexcOpenPositions(): Promise<MexcPosition[]> {
  const { apiKey, secretKey, isConfigured } = getMexcCredentials();
  if (!isConfigured) return [];
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
    const data = await res.json() as MexcApiResponse<Array<Record<string, unknown>>>;
    if (!res.ok || !data.success || !Array.isArray(data.data)) {
      throw apiError(data, `Failed to fetch open positions (${res.status})`);
    }
    return data.data.map((position) => ({
      positionId: String(position.positionId ?? ""),
      symbol: String(position.symbol ?? ""),
      holdVol: Number(position.holdVol ?? 0),
      positionType: Number(position.positionType) === 2 ? 2 : 1,
      state: Number(position.state ?? 0),
      openAvgPrice: Number(position.openAvgPrice ?? 0),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`MEXC_POSITIONS_UNAVAILABLE: ${message}`);
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
  stopLossPrice?: number;
  dryRunOverride?: boolean;
}): Promise<MexcOrderResult> {
  const { apiKey, secretKey, isConfigured, isDryRun: defaultDryRun } = getMexcCredentials();
  // KHÓA AN TOÀN TUYỆT ĐỐI:
  // Nếu hệ thống đang ở chế độ Dry-Run (hoặc chưa cấu hình Live), isDryRun LUÔN LUÔN là true.
  // params.dryRunOverride chỉ có tác dụng ép một lệnh cụ thể về Dry-Run (nếu dryRunOverride === true),
  // tuyệt đối KHÔNG cho phép biến một lệnh từ Dry-Run thành Live.
  const isDryRun = defaultDryRun || params.dryRunOverride === true;
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
    ...(params.stopLossPrice && params.stopLossPrice > 0
      ? { stopLossPrice: params.stopLossPrice, lossTrend: 1 }
      : {}),
  };
  const bodyStr = JSON.stringify(body);
  const signature = signMexcRequest(secretKey, apiKey, timestamp, bodyStr);

  try {
    const res = await fetch(`${MEXC_BASE_URL}/api/v1/private/order/create`, {
      method: "POST",
      headers: {
        ApiKey: apiKey,
        "Request-Time": timestamp,
        Signature: signature,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    const data = await res.json() as MexcApiResponse<{ orderId?: string | number }>;
    if (res.ok && data.success && data.data?.orderId) {
      return {
        success: true,
        orderId: String(data.data.orderId),
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
        error: data.message || `MEXC code ${data.code ?? res.status}`,
        isDryRun: false,
        symbol: mexcSymbol,
        side: sideStr,
        vol,
        price: params.price,
        notional: actualNotional,
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
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
  dryRunOverride?: boolean;
}): Promise<MexcTpSlResult> {
  const { apiKey, secretKey, isConfigured, isDryRun: defaultDryRun } = getMexcCredentials();
  const isDryRun = defaultDryRun || params.dryRunOverride === true;
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

  let slConfirmed = false;
  try {
    let position: MexcPosition | undefined;
    for (let attempt = 0; attempt < 5 && !position; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 300));
      const positions = await getMexcOpenPositions();
      position = positions.find((candidate) =>
        candidate.symbol === mexcSymbol &&
        candidate.positionType === (params.side > 0 ? 1 : 2) &&
        candidate.holdVol > 0
      );
    }
    if (!position?.positionId) {
      return { success: false, isDryRun: false, error: `No open ${mexcSymbol} position found for TP placement` };
    }

    const protectedVol = Math.min(params.vol, position.holdVol);
    const volTp1 = protectedVol >= 2 ? Math.floor(protectedVol * 0.5) : 0;
    const volTp2 = protectedVol - volTp1;
    const positionId = String(position.positionId);

    const openOrdersTimestamp = Date.now().toString();
    const openOrdersSignature = signMexcRequest(secretKey, apiKey, openOrdersTimestamp);
    const openOrdersResponse = await fetch(`${MEXC_BASE_URL}/api/v1/private/stoporder/open_orders`, {
      headers: {
        ApiKey: apiKey,
        "Request-Time": openOrdersTimestamp,
        Signature: openOrdersSignature,
        "Content-Type": "application/json",
      },
    });
    const openOrdersData = await openOrdersResponse.json() as MexcApiResponse<Array<Record<string, unknown>>>;
    if (!openOrdersResponse.ok || !openOrdersData.success || !Array.isArray(openOrdersData.data)) {
      throw apiError(openOrdersData, "Could not verify entry stop-loss");
    }

    const existingStop = openOrdersData.data.find((order) =>
      String(order.positionId ?? "") === positionId &&
      Number(order.stopLossPrice ?? 0) > 0 &&
      Number(order.isFinished ?? 0) === 0
    );

    const placeProtectionOrder = async (bodyObject: Record<string, unknown>) => {
      const timestamp = Date.now().toString();
      const body = JSON.stringify(bodyObject);
      const signature = signMexcRequest(secretKey, apiKey, timestamp, body);
      const res = await fetch(`${MEXC_BASE_URL}/api/v1/private/stoporder/place`, {
        method: "POST",
        headers: {
          ApiKey: apiKey,
          "Request-Time": timestamp,
          Signature: signature,
          "Content-Type": "application/json",
        },
        body,
      });
      const data = await res.json() as MexcApiResponse<string | number>;
      if (!res.ok || !data.success || data.data === undefined || data.data === null) {
        throw apiError(data, "Failed to place protection order");
      }
      return String(data.data);
    };

    const slOrderId = existingStop
      ? String(existingStop.id ?? "attached_to_entry")
      : await placeProtectionOrder({
          positionId,
          vol: protectedVol,
          stopLossPrice: params.stopLossPrice,
          lossTrend: 1,
          profitTrend: 1,
          stopLossType: 0,
          volType: 1,
        });
    slConfirmed = true;

    const placeTakeProfit = async (vol: number, takeProfitPrice: number) => {
      // TP = 0 nghĩa là không chốt cố định (1D Donchian gồng lãi theo đáy 10D)
      if (vol <= 0 || !(takeProfitPrice > 0)) return undefined;
      return placeProtectionOrder({
        positionId,
        vol,
        takeProfitPrice,
        profitTrend: 1,
        lossTrend: 1,
        takeProfitType: 0,
        volType: 1,
      });
    };

    const tp1OrderId = await placeTakeProfit(volTp1, params.takeProfit1Price);
    const tp2OrderId = await placeTakeProfit(volTp2, params.takeProfit2Price);

    return {
      success: true,
      isDryRun: false,
      slConfirmed,
      slOrderId,
      tp1OrderId,
      tp2OrderId,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      isDryRun: false,
      slConfirmed,
    };
  }
}

async function mexcPrivate<T>(apiPath: string, bodyObject?: Record<string, unknown>): Promise<T> {
  const { apiKey, secretKey } = getMexcCredentials();
  const timestamp = Date.now().toString();
  const body = bodyObject ? JSON.stringify(bodyObject) : "";
  const res = await fetch(`${MEXC_BASE_URL}${apiPath}`, {
    method: bodyObject ? "POST" : "GET",
    headers: {
      ApiKey: apiKey,
      "Request-Time": timestamp,
      Signature: signMexcRequest(secretKey, apiKey, timestamp, body),
      "Content-Type": "application/json",
    },
    ...(bodyObject ? { body } : {}),
  });
  const data = await res.json() as MexcApiResponse<T>;
  if (!res.ok || !data.success) throw apiError(data, `MEXC ${apiPath} failed (${res.status})`);
  return data.data as T;
}

/**
 * Đóng vị thế bằng lệnh Market (dùng khi không xác nhận được SL)
 */
export async function closeMexcPosition(params: { symbol: string; side: 1 | -1; vol: number }): Promise<void> {
  const { isConfigured, isDryRun } = getMexcCredentials();
  if (isDryRun || !isConfigured) return;
  const mexcSymbol = params.symbol.includes("_") ? params.symbol : `${params.symbol.replace("-USDT", "")}_USDT`;
  await mexcPrivate("/api/v1/private/order/create", {
    symbol: mexcSymbol,
    vol: params.vol,
    side: params.side > 0 ? 4 : 2, // 4 = Close Long, 2 = Close Short
    type: 5,
    openType: 1,
  });
}

/**
 * Sau khi TP1 khớp: dời SL về giá vào (hòa vốn), khớp với giả định của paper ledger.
 * Nhận biết TP1 đã khớp: chỉ còn 1 lệnh TP và khối lượng còn giữ <= khối lượng TP đó.
 */
export async function moveStopsToBreakeven(): Promise<string[]> {
  const { isConfigured, isDryRun } = getMexcCredentials();
  if (isDryRun || !isConfigured) return [];
  const positions = await getMexcOpenPositions();
  if (!positions.length) return [];
  const orders = await mexcPrivate<Array<Record<string, unknown>>>("/api/v1/private/stoporder/open_orders");
  const moved: string[] = [];
  for (const position of positions) {
    const entry = position.openAvgPrice ?? 0;
    if (!(entry > 0) || !(position.holdVol > 0)) continue;
    const live = orders.filter((o) => String(o.positionId ?? "") === String(position.positionId) && Number(o.isFinished ?? 0) === 0);
    const tps = live.filter((o) => Number(o.takeProfitPrice ?? 0) > 0 && !(Number(o.stopLossPrice ?? 0) > 0));
    const sl = live.find((o) => Number(o.stopLossPrice ?? 0) > 0);
    // Chỉ dời SL về BE nếu vị thế ban đầu có chia TP1 (tối thiểu 2 hợp đồng).
    // Nếu chỉ có 1 hợp đồng (chỉ có 1 lệnh TP từ đầu), tuyệt đối không dời về BE khi chưa chốt.
    if (!sl || tps.length !== 1) continue;
    // Nếu position holdVol bằng đúng vol của lệnh TP duy nhất này và chưa từng có TP1 khớp:
    // Kiểm tra xem TP duy nhất này có phải là TP2 còn lại không
    const tpOrder = tps[0];
    const tpVol = Number(tpOrder.vol ?? 0);
    // Nếu vị thế chỉ có 1 hợp đồng từ đầu (holdVol === 1 && tpVol === 1), đây không phải là đã khớp TP1!
    if (position.holdVol === 1 && tpVol === 1) continue;
    if (position.holdVol > tpVol) continue;
    const slPrice = Number(sl.stopLossPrice);
    const alreadyBe = position.positionType === 1 ? slPrice >= entry : slPrice <= entry;
    if (alreadyBe) continue;
    // Lệnh TP/SL kế hoạch → change_plan_price (change_price chỉ dành cho lệnh limit)
    await mexcPrivate("/api/v1/private/stoporder/change_plan_price", {
      stopPlanOrderId: sl.id,
      stopLossPrice: entry,
      ...(Number(sl.takeProfitPrice ?? 0) > 0 ? { takeProfitPrice: Number(sl.takeProfitPrice) } : {}),
    });
    moved.push(position.symbol);
  }
  return moved;
}

/**
 * Nâng mức Stop Loss lên giá cụ thể (dùng cho Trailing Stop khung Ngày theo đáy 10D)
 */
export async function updateMexcStopLossPrice(symbol: string, newStopPrice: number): Promise<boolean> {
  const { isConfigured, isDryRun } = getMexcCredentials();
  if (isDryRun || !isConfigured) return false;
  const mexcSymbol = symbol.includes("_") ? symbol : `${symbol.replace("-USDT", "")}_USDT`;
  try {
    const orders = await mexcPrivate<Array<Record<string, unknown>>>("/api/v1/private/stoporder/open_orders");
    const sl = orders.find((o) => o.symbol === mexcSymbol && Number(o.stopLossPrice ?? 0) > 0 && Number(o.isFinished ?? 0) === 0);
    if (!sl?.id) return false;
    const currentSl = Number(sl.stopLossPrice ?? 0);
    // BẢO VỆ RỦI RO: Chỉ được phép nâng SL lên cao hơn (bảo vệ lãi), TUYỆT ĐỐI không hạ SL xuống sâu hơn
    if (currentSl > 0 && newStopPrice <= currentSl) {
      return false;
    }
    await mexcPrivate("/api/v1/private/stoporder/change_plan_price", {
      stopPlanOrderId: sl.id,
      stopLossPrice: newStopPrice,
      ...(Number(sl.takeProfitPrice ?? 0) > 0 ? { takeProfitPrice: Number(sl.takeProfitPrice) } : {}),
    });
    return true;
  } catch (err) {
    console.warn(`[MEXC TRAIL] Không dời được SL cho ${mexcSymbol}:`, err);
    return false;
  }
}

/**
 * Lấy danh sách lệnh điều kiện (TP / SL) đang chờ kích hoạt
 */
export async function getMexcOpenStopOrders(): Promise<Array<Record<string, unknown>>> {
  const { isConfigured, isDryRun } = getMexcCredentials();
  if (isDryRun || !isConfigured) return [];
  try {
    return await mexcPrivate<Array<Record<string, unknown>>>("/api/v1/private/stoporder/open_orders");
  } catch (err) {
    console.error("[MEXC API] Không đọc được danh sách stoporder:", err);
    return [];
  }
}
