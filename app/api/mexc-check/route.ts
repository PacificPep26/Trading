import { getMexcAccountAsset, signMexcRequest } from "@/lib/mexc-client";

export const runtime = "nodejs";

export async function GET() {
  const asset = await getMexcAccountAsset(40);
  
  let positions = [];
  try {
    const apiKey = process.env.MEXC_API_KEY || "";
    const secretKey = process.env.MEXC_SECRET_KEY || "";
    if (apiKey && secretKey) {
      const timestamp = Date.now().toString();
      const signature = signMexcRequest(secretKey, apiKey, timestamp);
      const res = await fetch("https://contract.mexc.com/api/v1/private/position/open_positions", {
        headers: {
          ApiKey: apiKey,
          "Request-Time": timestamp,
          Signature: signature,
          "Content-Type": "application/json"
        }
      });
      const data = await res.json();
      positions = data.data || [];
    }
  } catch (e: any) {
    positions = [{ error: e?.message }];
  }

  return Response.json({
    asset,
    positions,
    env: {
      hasKey: Boolean(process.env.MEXC_API_KEY),
      hasSecret: Boolean(process.env.MEXC_SECRET_KEY),
      dryRun: process.env.MEXC_DRY_RUN,
    }
  });
}

