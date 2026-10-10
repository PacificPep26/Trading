import { getMexcAccountAsset, getMexcOpenPositions, type MexcPosition } from "@/lib/mexc-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Lộ số dư và vị thế thật → bắt buộc ?secret=CRON_SECRET, không có secret thì đóng hẳn
  const secret = process.env.CRON_SECRET;
  if (!secret || new URL(request.url).searchParams.get("secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let asset;
  let positions: MexcPosition[] = [];
  let error: string | undefined;
  try {
    [asset, positions] = await Promise.all([
      getMexcAccountAsset(40),
      getMexcOpenPositions(),
    ]);
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  return Response.json({
    asset,
    positions,
    error,
    env: {
      hasKey: Boolean(process.env.MEXC_API_KEY),
      hasSecret: Boolean(process.env.MEXC_SECRET_KEY),
      liveTrading: process.env.MEXC_LIVE_TRADING === "true",
      dryRun: process.env.MEXC_DRY_RUN !== "false",
    }
  });
}

