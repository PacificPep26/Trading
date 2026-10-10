import { getMexcAccountAsset, getMexcOpenPositions, closeMexcPosition, type MexcPosition } from "@/lib/mexc-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Lộ số dư và vị thế thật → bắt buộc ?secret=CRON_SECRET, không có secret thì đóng hẳn
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  if (!secret || url.searchParams.get("secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const action = url.searchParams.get("action");
  const closedLogs: string[] = [];

  let asset;
  let positions: MexcPosition[] = [];
  let error: string | undefined;

  try {
    positions = await getMexcOpenPositions();

    if (action === "close_all") {
      for (const pos of positions) {
        if (pos.holdVol > 0) {
          const side = pos.positionType === 1 ? 1 : -1;
          await closeMexcPosition({ symbol: pos.symbol, side, vol: pos.holdVol });
          closedLogs.push(`Closed ${pos.symbol}: ${pos.holdVol} contracts (${side > 0 ? "LONG" : "SHORT"})`);
        }
      }
      await new Promise((r) => setTimeout(r, 1200));
      positions = await getMexcOpenPositions();
    }

    asset = await getMexcAccountAsset(40);
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return Response.json({
    asset,
    positions,
    closedLogs,
    error,
    env: {
      hasKey: Boolean(process.env.MEXC_API_KEY),
      hasSecret: Boolean(process.env.MEXC_SECRET_KEY),
      liveTrading: process.env.MEXC_LIVE_TRADING === "true",
      dryRun: process.env.MEXC_DRY_RUN !== "false",
    }
  });
}

