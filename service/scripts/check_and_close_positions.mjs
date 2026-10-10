import fs from "fs";
import path from "path";
import crypto from "crypto";

const envContent = fs.readFileSync(".env", "utf-8");
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const apiKey = process.env.MEXC_API_KEY;
const secretKey = process.env.MEXC_SECRET_KEY;
const BASE_URL = "https://api.mexc.com";

function sign(secretKey, apiKey, timestamp, paramStr = "") {
  return crypto.createHmac("sha256", secretKey).update(`${apiKey}${timestamp}${paramStr}`).digest("hex");
}

async function getPositions() {
  const ts = Date.now().toString();
  const sig = sign(secretKey, apiKey, ts);
  const res = await fetch(`${BASE_URL}/api/v1/private/position/open_positions`, {
    headers: {
      ApiKey: apiKey,
      "Request-Time": ts,
      Signature: sig,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  return data.data || [];
}

async function closePosition(symbol, side, vol) {
  const ts = Date.now().toString();
  // side 4 = close long, side 2 = close short
  const closeSide = side > 0 ? 4 : 2;
  const body = JSON.stringify({
    symbol,
    vol,
    side: closeSide,
    type: 5,     // market order
    openType: 1, // isolated
  });
  const sig = sign(secretKey, apiKey, ts, body);
  const res = await fetch(`${BASE_URL}/api/v1/private/order/create`, {
    method: "POST",
    headers: {
      ApiKey: apiKey,
      "Request-Time": ts,
      Signature: sig,
      "Content-Type": "application/json",
    },
    body,
  });
  return await res.json();
}

async function cancelAllStopOrders(symbol) {
  const ts = Date.now().toString();
  const body = JSON.stringify({ symbol });
  const sig = sign(secretKey, apiKey, ts, body);
  const res = await fetch(`${BASE_URL}/api/v1/private/stoporder/cancel_all`, {
    method: "POST",
    headers: {
      ApiKey: apiKey,
      "Request-Time": ts,
      Signature: sig,
      "Content-Type": "application/json",
    },
    body,
  });
  return await res.json();
}

async function main() {
  console.log("Đang kiểm tra các vị thế mở trên MEXC...");
  const positions = await getPositions();
  console.log("Danh sách vị thế hiện tại:", JSON.stringify(positions, null, 2));

  for (const pos of positions) {
    if (pos.holdVol > 0) {
      console.log(`Đang đóng vị thế ${pos.symbol} (${pos.holdVol} HĐ)...`);
      // Hủy mọi lệnh stoporder/plan order cũ của coin này trước
      try {
        const cancelRes = await cancelAllStopOrders(pos.symbol);
        console.log(`Hủy plan orders của ${pos.symbol}:`, cancelRes);
      } catch (e) {
        console.warn(`Lỗi hủy plan order ${pos.symbol}:`, e.message);
      }

      // Đóng market vị thế
      const closeRes = await closePosition(pos.symbol, pos.positionType === 1 ? 1 : -1, pos.holdVol);
      console.log(`Kết quả đóng ${pos.symbol}:`, closeRes);
    }
  }

  // Đọc lại sau khi đóng
  await new Promise((r) => setTimeout(r, 1000));
  const remaining = await getPositions();
  console.log("Các vị thế còn lại sau khi đóng:", JSON.stringify(remaining, null, 2));
}

main().catch(console.error);

